import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../lib/colors';
import {
  enqueueJson, enqueueFile, getPendingCount, processQueue, retryFailed,
} from '../lib/outbox';

type NetworkCtx = {
  isOnline: boolean;
  pendingCount: number;
  isSyncing: boolean;
  enqueueJsonOp: (method: string, url: string, body: any) => Promise<void>;
  enqueueFileOp: (
    url: string, sourceUri: string, fileField: string,
    extraFields: Record<string, string>, fileName?: string, fileMime?: string,
  ) => Promise<void>;
  syncNow: () => Promise<void>;
  refreshPending: () => Promise<void>;
};

const NetworkContext = createContext<NetworkCtx>({
  isOnline: true,
  pendingCount: 0,
  isSyncing: false,
  enqueueJsonOp: async () => {},
  enqueueFileOp: async () => {},
  syncNow: async () => {},
  refreshPending: async () => {},
});

export function useNetwork() { return useContext(NetworkContext); }

export function NetworkProvider({ children }: { children: React.ReactNode }) {
  const [isOnline, setIsOnline] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const syncLock = useRef(false);

  // Refresh pending count
  const refreshPending = useCallback(async () => {
    const cnt = await getPendingCount();
    setPendingCount(cnt);
  }, []);

  // NetInfo listener
  useEffect(() => {
    const unsub = NetInfo.addEventListener(state => {
      const online = !!(state.isConnected && state.isInternetReachable !== false);
      setIsOnline(online);
      if (online) {
        // Auto-sync when reconnecting
        syncNow();
      }
    });
    refreshPending();
    return () => unsub();
  }, []);

  // Sync worker
  const syncNow = useCallback(async () => {
    if (syncLock.current) return;
    syncLock.current = true;
    setIsSyncing(true);
    try {
      await processQueue();
    } catch {}
    await refreshPending();
    setIsSyncing(false);
    syncLock.current = false;
  }, [refreshPending]);

  // Enqueue JSON
  const enqueueJsonOp = useCallback(async (method: string, url: string, body: any) => {
    await enqueueJson(method, url, body);
    await refreshPending();
  }, [refreshPending]);

  // Enqueue file
  const enqueueFileOp = useCallback(async (
    url: string, sourceUri: string, fileField: string,
    extraFields: Record<string, string>, fileName?: string, fileMime?: string,
  ) => {
    await enqueueFile(url, sourceUri, fileField, extraFields, fileName, fileMime);
    await refreshPending();
  }, [refreshPending]);

  return (
    <NetworkContext.Provider value={{
      isOnline, pendingCount, isSyncing,
      enqueueJsonOp, enqueueFileOp, syncNow, refreshPending,
    }}>
      {children}
    </NetworkContext.Provider>
  );
}

/* --- Offline Banner --- */
export function OfflineBanner() {
  const { isOnline, pendingCount, isSyncing, syncNow } = useNetwork();
  if (isOnline && pendingCount === 0) return null;

  return (
    <View style={[styles.banner, !isOnline ? styles.bannerOffline : styles.bannerPending]} testID="offline-banner">
      <Ionicons
        name={!isOnline ? 'cloud-offline' : isSyncing ? 'sync' : 'cloud-upload'}
        size={16}
        color={!isOnline ? '#92400E' : '#1E40AF'}
      />
      <Text style={[styles.bannerText, !isOnline ? styles.bannerTextOffline : styles.bannerTextPending]}>
        {!isOnline
          ? 'Offline — changes queued locally'
          : isSyncing
            ? `Syncing ${pendingCount} item${pendingCount !== 1 ? 's' : ''}...`
            : `${pendingCount} pending sync item${pendingCount !== 1 ? 's' : ''}`}
      </Text>
      {isOnline && pendingCount > 0 && !isSyncing && (
        <TouchableOpacity testID="sync-now-btn" onPress={syncNow} style={styles.syncBtn}>
          <Text style={styles.syncBtnText}>Sync now</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

/* --- Sync status icon for headers --- */
export function SyncStatusIcon() {
  const { isOnline, pendingCount, isSyncing } = useNetwork();
  if (!isOnline) return <Ionicons name="cloud-offline" size={20} color="#DC2626" />;
  if (isSyncing) return <Ionicons name="sync" size={20} color={Colors.steelBlue} />;
  if (pendingCount > 0) {
    return (
      <View style={styles.syncIconWrap}>
        <Ionicons name="cloud-upload" size={20} color={Colors.steelBlue} />
        <View style={styles.syncBadge}>
          <Text style={styles.syncBadgeText}>{pendingCount > 9 ? '9+' : pendingCount}</Text>
        </View>
      </View>
    );
  }
  return <Ionicons name="cloud-done" size={20} color="#16A34A" />;
}

const styles = StyleSheet.create({
  banner: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8, gap: 8 },
  bannerOffline: { backgroundColor: '#FEF3C7' },
  bannerPending: { backgroundColor: '#DBEAFE' },
  bannerText: { flex: 1, fontSize: 12, fontWeight: '600' },
  bannerTextOffline: { color: '#92400E' },
  bannerTextPending: { color: '#1E40AF' },
  syncBtn: { paddingHorizontal: 10, paddingVertical: 4, backgroundColor: '#1E40AF', borderRadius: 4 },
  syncBtnText: { color: '#FFF', fontSize: 11, fontWeight: '700' },
  syncIconWrap: { position: 'relative' },
  syncBadge: {
    position: 'absolute', top: -4, right: -8,
    backgroundColor: '#DC2626', borderRadius: 8, minWidth: 16, height: 16,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3,
  },
  syncBadgeText: { color: '#FFF', fontSize: 9, fontWeight: '800' },
});
