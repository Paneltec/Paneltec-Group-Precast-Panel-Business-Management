import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, TextInput, StyleSheet,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import { api } from '../../src/lib/api';
import { formatDateTime } from '../../src/lib/format';
import { Colors } from '../../src/lib/colors';

export default function CustomersScreen() {
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const params: any = { page, page_size: 25, status: 'active', active: 'true' };
      if (search) params.search = search;
      const d = await api('/customers', { params });
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
      onPress={() => router.push(`/customers/${item.id}`)}
      testID={`customer-row-${item.id}`}
      activeOpacity={0.7}
    >
      <Text style={styles.company}>{item.company_name}</Text>
      <Text style={styles.contact}>{item.contact_name}</Text>
      <View style={styles.rowBottom}>
        <Text style={styles.state}>{item.billing_address?.state || '\u2014'}</Text>
        <Text style={styles.abn}>ABN: {item.abn || '\u2014'}</Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={styles.screen} testID="customers-page">
      <View style={styles.searchBar}>
        <TextInput
          testID="customers-search-input"
          style={styles.searchInput}
          placeholder="Search company, contact, ABN..."
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
            <Text style={styles.emptyText} testID="customers-empty">No customers found.</Text>
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
  company: { fontSize: 15, fontWeight: '700', color: Colors.charcoal, marginBottom: 2 },
  contact: { fontSize: 13, color: Colors.textSecondary, marginBottom: 8 },
  rowBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  state: { fontSize: 12, fontWeight: '600', color: Colors.steelBlue },
  abn: { fontSize: 11, color: Colors.textMuted, fontVariant: ['tabular-nums'] },
  emptyText: { fontSize: 13, color: Colors.textMuted, textAlign: 'center', marginTop: 40 },
});
