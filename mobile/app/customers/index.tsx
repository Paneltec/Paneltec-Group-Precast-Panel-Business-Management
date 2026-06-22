import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, TextInput, StyleSheet,
  ActivityIndicator, RefreshControl, useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../src/lib/api';
import { formatDateTime } from '../../src/lib/format';
import { Colors } from '../../src/lib/colors';
import CustomerDetailPanel from '../../src/components/CustomerDetailPanel';

export default function CustomersScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;
  const [data, setData] = useState<any>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

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

  const handlePress = (id: string) => {
    if (isTablet) {
      setSelectedId(id);
    } else {
      router.push(`/customers/${id}`);
    }
  };

  const renderItem = ({ item }: { item: any }) => (
    <TouchableOpacity
      style={[styles.row, isTablet && selectedId === item.id && styles.rowSelected]}
      onPress={() => handlePress(item.id)}
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

  const listUI = (
    <View style={{ flex: 1 }}>
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

  if (isTablet) {
    return (
      <SafeAreaView style={styles.safe} edges={['left', 'right']}>
        <View style={styles.splitContainer} testID="customers-page">
          <View style={styles.splitLeft}>{listUI}</View>
          <View style={styles.splitRight}>
            {selectedId ? (
              <CustomerDetailPanel key={selectedId} itemId={selectedId} />
            ) : (
              <View style={styles.splitPlaceholder} testID="customers-detail-placeholder">
                <Ionicons name="people-outline" size={48} color={Colors.textMuted} />
                <Text style={styles.splitPlaceholderText}>Select a customer to view details</Text>
              </View>
            )}
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.screen} testID="customers-page">
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
  company: { fontSize: 15, fontWeight: '700', color: Colors.charcoal, marginBottom: 2 },
  contact: { fontSize: 13, color: Colors.textSecondary, marginBottom: 8 },
  rowBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  state: { fontSize: 12, fontWeight: '600', color: Colors.steelBlue },
  abn: { fontSize: 11, color: Colors.textMuted, fontVariant: ['tabular-nums'] },
  emptyText: { fontSize: 13, color: Colors.textMuted, textAlign: 'center', marginTop: 40 },
  splitContainer: { flex: 1, flexDirection: 'row' },
  splitLeft: { width: '40%', borderRightWidth: 1, borderRightColor: Colors.border },
  splitRight: { flex: 1 },
  splitPlaceholder: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  splitPlaceholderText: { fontSize: 15, color: Colors.textMuted, fontWeight: '600' },
});
