import * as SQLite from 'expo-sqlite';
import * as FileSystem from 'expo-file-system';
import { api, apiUpload, tokenStore, API_BASE } from './api';

const DB_NAME = 'paneltec_outbox.db';
let _db: SQLite.SQLiteDatabase | null = null;

async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (_db) return _db;
  _db = await SQLite.openDatabaseAsync(DB_NAME);
  await _db.execAsync(`
    CREATE TABLE IF NOT EXISTS outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      method TEXT NOT NULL DEFAULT 'POST',
      url TEXT NOT NULL,
      body_json TEXT,
      file_path TEXT,
      file_field TEXT DEFAULT 'file',
      file_name TEXT DEFAULT 'file',
      file_mime TEXT DEFAULT 'application/octet-stream',
      extra_fields TEXT,
      retries INTEGER DEFAULT 0,
      max_retries INTEGER DEFAULT 5,
      last_error TEXT,
      status TEXT DEFAULT 'pending'
    );
  `);
  return _db;
}

/* --- Enqueue operations --- */

export async function enqueueJson(
  method: string, url: string, body: any
): Promise<number> {
  const db = await getDb();
  const result = await db.runAsync(
    'INSERT INTO outbox (created_at, method, url, body_json, status) VALUES (?, ?, ?, ?, ?)',
    [new Date().toISOString(), method, url, JSON.stringify(body), 'pending']
  );
  return result.lastInsertRowId;
}

export async function enqueueFile(
  url: string,
  sourceUri: string,
  fileField: string,
  extraFields: Record<string, string>,
  fileName?: string,
  fileMime?: string,
): Promise<number> {
  const db = await getDb();
  // Copy file to permanent location
  const dir = `${FileSystem.documentDirectory}outbox_files/`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
  const dest = `${dir}${Date.now()}_${fileName || 'file'}`;
  await FileSystem.copyAsync({ from: sourceUri, to: dest });

  const result = await db.runAsync(
    `INSERT INTO outbox (created_at, method, url, file_path, file_field, file_name, file_mime, extra_fields, status)
     VALUES (?, 'POST', ?, ?, ?, ?, ?, ?, 'pending')`,
    [
      new Date().toISOString(), url, dest, fileField,
      fileName || 'file', fileMime || 'application/octet-stream',
      JSON.stringify(extraFields), 'pending',
    ]
  );
  return result.lastInsertRowId;
}

/* --- Query --- */

export async function getPendingCount(): Promise<number> {
  const db = await getDb();
  const row: any = await db.getFirstAsync(
    "SELECT COUNT(*) as cnt FROM outbox WHERE status IN ('pending', 'syncing')"
  );
  return row?.cnt ?? 0;
}

export async function getFailedCount(): Promise<number> {
  const db = await getDb();
  const row: any = await db.getFirstAsync(
    "SELECT COUNT(*) as cnt FROM outbox WHERE status = 'failed'"
  );
  return row?.cnt ?? 0;
}

export async function getAllPending(): Promise<any[]> {
  const db = await getDb();
  return db.getAllAsync(
    "SELECT * FROM outbox WHERE status = 'pending' ORDER BY created_at ASC"
  );
}

/* --- Sync worker --- */

export async function processQueue(): Promise<{ synced: number; failed: number }> {
  const items = await getAllPending();
  let synced = 0, failed = 0;
  const db = await getDb();

  for (const item of items) {
    await db.runAsync("UPDATE outbox SET status = 'syncing' WHERE id = ?", [item.id]);
    try {
      if (item.file_path) {
        // File upload
        const fd = new FormData();
        fd.append(item.file_field, {
          uri: item.file_path,
          name: item.file_name,
          type: item.file_mime,
        } as any);
        // Add extra fields
        if (item.extra_fields) {
          const extras = JSON.parse(item.extra_fields);
          for (const [k, v] of Object.entries(extras)) {
            if (v) fd.append(k, v as string);
          }
        }
        await apiUpload(item.url, fd);
      } else if (item.body_json) {
        // JSON operation
        await api(item.url, {
          method: item.method || 'POST',
          body: JSON.parse(item.body_json),
        });
      }
      // Success — mark done and clean up file
      await db.runAsync("UPDATE outbox SET status = 'done' WHERE id = ?", [item.id]);
      if (item.file_path) {
        FileSystem.deleteAsync(item.file_path, { idempotent: true }).catch(() => {});
      }
      synced++;
    } catch (e: any) {
      const status = e.status || 0;
      const newRetries = (item.retries || 0) + 1;
      if (status >= 400 && status < 500) {
        // Client error — mark failed, won't retry
        await db.runAsync(
          "UPDATE outbox SET status = 'failed', last_error = ?, retries = ? WHERE id = ?",
          [e.message, newRetries, item.id]
        );
        failed++;
      } else if (newRetries >= (item.max_retries || 5)) {
        // Max retries exceeded
        await db.runAsync(
          "UPDATE outbox SET status = 'failed', last_error = ?, retries = ? WHERE id = ?",
          [`Max retries (${item.max_retries}) exceeded: ${e.message}`, newRetries, item.id]
        );
        failed++;
      } else {
        // Server error — leave pending for retry
        await db.runAsync(
          "UPDATE outbox SET status = 'pending', last_error = ?, retries = ? WHERE id = ?",
          [e.message, newRetries, item.id]
        );
      }
    }
  }

  // Clean up old done items (older than 24h)
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  await db.runAsync("DELETE FROM outbox WHERE status = 'done' AND created_at < ?", [cutoff]);

  return { synced, failed };
}

/* --- Retry failed --- */
export async function retryFailed(): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE outbox SET status = 'pending', retries = 0 WHERE status = 'failed'");
}

/* --- Clear all --- */
export async function clearDone(): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM outbox WHERE status = 'done'");
}
