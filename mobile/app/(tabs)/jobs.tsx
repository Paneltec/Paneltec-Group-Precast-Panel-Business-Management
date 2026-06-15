import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, TextInput, StyleSheet,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import { api } from '../../src/lib/api';
import { formatAUD, formatDateTime } from '../../src/lib/format';
import { Colors } from '../../src/lib/colors';
import StatusBadge from '../../src/components/StatusBadge';

const STATUS_FILTERS = ['all', 'scheduled', 'in_production', 'ready_for_delivery', 'delivered', 'installed', 'completed', 'cancelled'];

export default function JobsScreen() {
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const params: any = { page, page_size: 25, lifecycle: 'active' };
      if (search) params.search = search;
      if (statusFilter !== 'all') params.status = statusFilter;
      const d = await api('/jobs', { params });
      setData(d);
    } catch {}
  }, [page, statusFilter, search]);

  useEffect(() => { load(); }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const renderItem = ({ item }: { item: any }) => (
    <TouchableOpacity
      style={styles.row}
      onPress={() => router.push(`/jobs/${item.id}`)}
      testID={`job-row-${item.id}`}
      activeOpacity={0.7}
    >
      <View style={styles.rowTop}>
        <Text style={styles.rowId}>{item.job_number}</Text>
        <StatusBadge status={item.status} />
      </View>
      <Text style={styles.rowCustomer}>{item.customer_company_name}</Text>
      <View style={styles.rowBottom}>
        <Text style={styles.rowMeta}>Quote: {item.quote_number}</Text>
        <Text style={styles.rowTotal}>{formatAUD(item.total)}</Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={styles.screen} testID="jobs-page">
      <View style={styles.searchBar}>
        <TextInput
          testID="jobs-search-input"
          style={styles.searchInput}
          placeholder="Search J-2026-..."
          placeholderTextColor={Colors.textMuted}
          value={search}
          onChangeText={setSearch}
          onSubmitEditing={() => { setPage(1); load(); }}
          returnKeyType="search"
        />
      </View>

      <FlatList
        horizontal
        data={STATUS_FILTERS}
        keyExtractor={(i) => i}
        showsHorizontalScrollIndicator={false}
        style={styles.filterList}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[styles.filterChip, statusFilter === item && styles.filterChipActive]}
            onPress={() => { setStatusFilter(item); setPage(1); }}
            testID={`jobs-filter-${item}`}
          >
            <Text style={[styles.filterText, statusFilter === item && styles.filterTextActive]}>
              {item === 'all' ? 'All' : item.replace(/_/g, ' ')}
            </Text>
          </TouchableOpacity>
        )}
      />

      {!data ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={Colors.steelBlue} />
        </View>
      ) : (
        <FlatList
          data={data.items}
          keyExtractor={(i) => i.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.steelBlue} />}
          ListEmptyComponent={
            <Text style={styles.emptyText} testID="jobs-empty">No jobs match this filter.</Text>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  searchBar: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
  searchInput: {
    height: 44,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    paddingHorizontal: 14,
    fontSize: 14,
    color: Colors.charcoal,
  },
  filterList: { paddingHorizontal: 16, marginBottom: 8, maxHeight: 44 },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 6,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    marginRight: 8,
    minHeight: 36,
    justifyContent: 'center',
  },
  filterChipActive: { backgroundColor: Colors.charcoal, borderColor: Colors.charcoal },
  filterText: { fontSize: 12, fontWeight: '600', color: Colors.textSecondary, textTransform: 'capitalize' },
  filterTextActive: { color: Colors.safetyYellow },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  list: { paddingHorizontal: 16, paddingBottom: 24 },
  row: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    padding: 14,
    marginBottom: 10,
  },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  rowId: { fontSize: 15, fontWeight: '700', color: Colors.charcoal, fontVariant: ['tabular-nums'] },
  rowCustomer: { fontSize: 13, color: Colors.textSecondary, marginBottom: 8 },
  rowBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowMeta: { fontSize: 11, color: Colors.textMuted, fontVariant: ['tabular-nums'] },
  rowTotal: { fontSize: 15, fontWeight: '800', color: Colors.charcoal, fontVariant: ['tabular-nums'] },
  emptyText: { fontSize: 13, color: Colors.textMuted, textAlign: 'center', marginTop: 40 },
});
