import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, TextInput, StyleSheet,
  ActivityIndicator, RefreshControl, useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../src/lib/api';
import { formatAUD, formatDateTime } from '../../src/lib/format';
import { Colors } from '../../src/lib/colors';
import StatusBadge from '../../src/components/StatusBadge';
import QuoteDetailPanel from '../../src/components/QuoteDetailPanel';

const STATUS_FILTERS = ['all', 'draft', 'sent', 'accepted', 'rejected', 'expired'];

export default function QuotesScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;
  const [data, setData] = useState<any>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const params: any = { page, page_size: 25, lifecycle: 'active' };
      if (search) params.search = search;
      if (statusFilter !== 'all') params.status = statusFilter;
      const d = await api('/quotes', { params });
      setData(d);
    } catch {}
  }, [page, statusFilter, search]);

  useEffect(() => { load(); }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const handlePress = (id: string) => {
    if (isTablet) {
      setSelectedId(id);
    } else {
      router.push(`/quotes/${id}`);
    }
  };

  const renderItem = ({ item }: { item: any }) => (
    <TouchableOpacity
      style={[styles.row, isTablet && selectedId === item.id && styles.rowSelected]}
      onPress={() => handlePress(item.id)}
      testID={`quote-row-${item.id}`}
      activeOpacity={0.7}
    >
      <View style={styles.rowTop}>
        <Text style={styles.rowId}>{item.quote_number}</Text>
        <StatusBadge status={item.status} />
      </View>
      <Text style={styles.rowCustomer}>{item.customer_company_name}</Text>
      <View style={styles.rowBottom}>
        <Text style={styles.rowDate}>{formatDateTime(item.created_at)}</Text>
        <Text style={styles.rowTotal}>{formatAUD(item.total)}</Text>
      </View>
    </TouchableOpacity>
  );

  const listUI = (
    <View style={{ flex: 1 }}>
      <View style={styles.searchBar}>
        <TextInput
          testID="quotes-search-input"
          style={styles.searchInput}
          placeholder="Search Q-2026-..."
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
            testID={`quotes-filter-${item}`}
          >
            <Text style={[styles.filterText, statusFilter === item && styles.filterTextActive]}>
              {item === 'all' ? 'All' : item.charAt(0).toUpperCase() + item.slice(1)}
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
            <Text style={styles.emptyText} testID="quotes-empty">No quotes match your filter.</Text>
          }
        />
      )}
    </View>
  );

  if (isTablet) {
    return (
      <SafeAreaView style={styles.safe} edges={['left', 'right']}>
        <View style={styles.splitContainer} testID="quotes-page">
          <View style={styles.splitLeft}>{listUI}</View>
          <View style={styles.splitRight}>
            {selectedId ? (
              <QuoteDetailPanel key={selectedId} itemId={selectedId} />
            ) : (
              <View style={styles.splitPlaceholder} testID="quotes-detail-placeholder">
                <Ionicons name="document-text-outline" size={48} color={Colors.textMuted} />
                <Text style={styles.splitPlaceholderText}>Select a quote to view details</Text>
              </View>
            )}
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.screen} testID="quotes-page">
      {listUI}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
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
  filterText: { fontSize: 12, fontWeight: '600', color: Colors.textSecondary },
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
  rowSelected: { borderColor: Colors.steelBlue, borderWidth: 2, backgroundColor: 'rgba(58,107,140,0.06)' },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  rowId: { fontSize: 15, fontWeight: '700', color: Colors.charcoal, fontVariant: ['tabular-nums'] },
  rowCustomer: { fontSize: 13, color: Colors.textSecondary, marginBottom: 8 },
  rowBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowDate: { fontSize: 11, color: Colors.textMuted },
  rowTotal: { fontSize: 15, fontWeight: '800', color: Colors.charcoal, fontVariant: ['tabular-nums'] },
  emptyText: { fontSize: 13, color: Colors.textMuted, textAlign: 'center', marginTop: 40 },
  splitContainer: { flex: 1, flexDirection: 'row' },
  splitLeft: { width: '40%', borderRightWidth: 1, borderRightColor: Colors.border },
  splitRight: { flex: 1 },
  splitPlaceholder: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  splitPlaceholderText: { fontSize: 15, color: Colors.textMuted, fontWeight: '600' },
});
