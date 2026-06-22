import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api, apiUpload } from '../lib/api';

/* ---- Types ---- */
type QueueItem = {
  id: string;
  type: 'PATCH' | 'POST' | 'UPLOAD';
  endpoint: string;
  body?: any;
  formDataFields?: any; // For photo uploads
  createdAt: string;
  retries: number;
};

type NetworkCtx = {
  isOnline: boolean;
  pendingCount: number;
  syncNow: () => Promise<void>;
  enqueue: (item: Omit<QueueItem, 'id' | 'createdAt' | 'retries'>) => Promise<void>;
};

const QUEUE_KEY = 'paneltec_offline_queue';
const NetworkContext = createContext<NetworkCtx>({
  isOnline: true,
  pendingCount: 0,
  syncNow: async () => {},
  enqueue: async () => {},
});

export function NetworkProvider({ children }: { children: React.ReactNode }) {
  const [isOnline, setIsOnline] = useState(true);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [syncing, setSyncing] = useState(false);

  // Load queue from storage on mount
  useEffect(() => {
    AsyncStorage.getItem(QUEUE_KEY).then(raw => {
      if (raw) setQueue(JSON.parse(raw));
    }).catch(() => {});
  }, []);

  // Persist queue changes
  const persistQueue = async (q: QueueItem[]) => {
    setQueue(q);
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(q)).catch(() => {});
  };

  // Network listener
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
      const online = !!(state.isConnected && state.isInternetReachable !== false);
      setIsOnline(online);
    });
    // Initial check
    NetInfo.fetch().then(state => {
      setIsOnline(!!(state.isConnected && state.isInternetReachable !== false));
    });
    return () => unsubscribe();
  }, []);

  // Auto-sync when reconnecting
  useEffect(() => {
    if (isOnline && queue.length > 0 && !syncing) {
      processQueue(queue);
    }
  }, [isOnline]);

  const processQueue = async (currentQueue: QueueItem[]) => {
    if (syncing || currentQueue.length === 0) return;
    setSyncing(true);
    const remaining: QueueItem[] = [];

    for (const item of currentQueue) {
      try {
        if (item.type === 'UPLOAD' && item.formDataFields) {
          const fd = new FormData();
          for (const [k, v] of Object.entries(item.formDataFields)) {
            fd.append(k, v as any);
          }
          await apiUpload(item.endpoint, fd);
        } else {
          await api(item.endpoint, { method: item.type === 'PATCH' ? 'PATCH' : 'POST', body: item.body });
        }
        // Success — drop from queue
      } catch (e: any) {
        if (e.status && e.status >= 400 && e.status < 500) {
          // Client error (4xx) — drop from queue, can't recover
          console.warn(`Dropping queued item ${item.id}: ${e.message}`);
        } else {
          // Network/server error — retry later
          remaining.push({ ...item, retries: item.retries + 1 });
        }
      }
    }

    await persistQueue(remaining);
    setSyncing(false);
  };

  const syncNow = async () => {
    if (!isOnline || queue.length === 0) return;
    await processQueue(queue);
  };

  const enqueue = async (item: Omit<QueueItem, 'id' | 'createdAt' | 'retries'>) => {
    const newItem: QueueItem = {
      ...item,
      id: `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
      retries: 0,
    };
    const newQueue = [...queue, newItem];
    await persistQueue(newQueue);

    // Try immediately if online
    if (isOnline) {
      setTimeout(() => processQueue(newQueue), 200);
    }
  };

  return (
    <NetworkContext.Provider value={{ isOnline, pendingCount: queue.length, syncNow, enqueue }}>
      {children}
    </NetworkContext.Provider>
  );
}

export const useNetwork = () => useContext(NetworkContext);

/** Offline banner — shown at top of screen when offline or pending sync items */
export function OfflineBanner() {
  const { isOnline, pendingCount, syncNow } = useNetwork();

  if (isOnline && pendingCount === 0) return null;

  return (
    <View style={[bannerStyles.container, !isOnline ? bannerStyles.offline : bannerStyles.pending]} testID="offline-banner">
      <View style={bannerStyles.left}>
        <Ionicons
          name={!isOnline ? 'cloud-offline' : 'cloud-upload'}
          size={16}
          color={!isOnline ? '#FFF' : '#92400E'}
        />
        <Text style={[bannerStyles.text, !isOnline && { color: '#FFF' }]}>
          {!isOnline
            ? 'No internet connection — changes queued'
            : `${pendingCount} pending sync${pendingCount !== 1 ? 's' : ''}`}
        </Text>
      </View>
      {isOnline && pendingCount > 0 && (
        <TouchableOpacity onPress={syncNow} testID="sync-now-btn" style={bannerStyles.syncBtn}>
          <Ionicons name="sync" size={14} color="#92400E" />
          <Text style={bannerStyles.syncText}>Sync</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const bannerStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  offline: { backgroundColor: '#991B1B' },
  pending: { backgroundColor: '#FEF3C7' },
  left: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  text: { fontSize: 12, fontWeight: '600', color: '#92400E' },
  syncBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 4, backgroundColor: 'rgba(146,64,14,0.1)' },
  syncText: { fontSize: 11, fontWeight: '700', color: '#92400E' },
});
