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

export default function InvoicesScreen() {
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const params: any = { page, page_size: 25, lifecycle: 'active' };
      if (search) params.search = search;
      const d = await api('/invoices', { params });
      setData(d);
    } catch {}
  }, [page, search]);

  useEffect(() => { load(); }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const renderItem = ({ item }: { item: any }) => (
    <TouchableOpacity
      style={styles.row}
      onPress={() => router.push(`/invoices/${item.id}`)}
      testID={`invoice-row-${item.id}`}
      activeOpacity={0.7}
    >
      <View style={styles.rowTop}>
        <Text style={styles.rowId}>{item.invoice_number}</Text>
        <StatusBadge status={item.status} />
      </View>
      <Text style={styles.rowCustomer}>{item.customer_company_name}</Text>
      <View style={styles.rowBottom}>
        <Text style={styles.rowDate}>Due: {item.due_date || '\u2014'}</Text>
        <Text style={styles.rowTotal}>{formatAUD(item.total)}</Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={styles.screen} testID="invoices-page">
      <View style={styles.searchBar}>
        <TextInput
          testID="invoices-search-input"
          style={styles.searchInput}
          placeholder="Search INV-2026-..."
          placeholderTextColor={Colors.textMuted}
          value={search}
          onChangeText={setSearch}
          onSubmitEditing={() => { setPage(1); load(); }}
          returnKeyType="search"
        />
      </View>

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
            <Text style={styles.emptyText} testID="invoices-empty">No invoices found.</Text>
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
  rowDate: { fontSize: 11, color: Colors.textMuted },
  rowTotal: { fontSize: 15, fontWeight: '800', color: Colors.charcoal, fontVariant: ['tabular-nums'] },
  emptyText: { fontSize: 13, color: Colors.textMuted, textAlign: 'center', marginTop: 40 },
});
