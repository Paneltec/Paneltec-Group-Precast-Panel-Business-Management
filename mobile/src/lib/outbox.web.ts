/**
 * Web stub for outbox. SQLite is not available on web.
 * On web, all operations execute immediately (no queuing).
 */
import { api, apiUpload } from './api';

export async function enqueueJson(
  method: string, url: string, body: any
): Promise<number> {
  await api(url, { method, body });
  return 0;
}

export async function enqueueFile(
  url: string,
  sourceUri: string,
  fileField: string,
  extraFields: Record<string, string>,
  fileName?: string,
  fileMime?: string,
): Promise<number> {
  const fd = new FormData();
  fd.append(fileField, { uri: sourceUri, name: fileName || 'file', type: fileMime || 'application/octet-stream' } as any);
  for (const [k, v] of Object.entries(extraFields)) {
    if (v) fd.append(k, v);
  }
  await apiUpload(url, fd);
  return 0;
}

export async function getPendingCount(): Promise<number> { return 0; }
export async function getFailedCount(): Promise<number> { return 0; }
export async function getAllPending(): Promise<any[]> { return []; }
export async function processQueue(): Promise<{ synced: number; failed: number }> { return { synced: 0, failed: 0 }; }
export async function retryFailed(): Promise<void> {}
export async function clearDone(): Promise<void> {}
