import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { api } from '../../src/lib/api';
import { formatDateTime } from '../../src/lib/format';
import { Colors } from '../../src/lib/colors';
import ErrorBanner from '../../src/components/ErrorBanner';

export default function CustomerDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [customer, setCustomer] = useState<any>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const data = await api(`/customers/${id}`);
        setCustomer(data);
      } catch (e: any) {
        setError(e.message);
      }
    })();
  }, [id]);

  if (error) return <View style={styles.center}><ErrorBanner message={error} /></View>;
  if (!customer) return <View style={styles.center}><ActivityIndicator size="large" color={Colors.steelBlue} /></View>;

  const addr = customer.billing_address || {};

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} testID="customer-detail-page">
      <View style={styles.headerCard}>
        <Text style={styles.companyName}>{customer.company_name}</Text>
        <View style={styles.statusRow}>
          <View style={[styles.statusDot, { backgroundColor: customer.active ? Colors.success : Colors.textMuted }]} />
          <Text style={styles.statusText}>{customer.active ? 'Active' : 'Inactive'}</Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>CONTACT</Text>
        <InfoRow label="Name" value={customer.contact_name} />
        <InfoRow label="Email" value={customer.contact_email} />
        <InfoRow label="Phone" value={customer.contact_phone} />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>BUSINESS</Text>
        <InfoRow label="ABN" value={customer.abn} />
        <InfoRow label="Payment terms" value={customer.payment_terms} />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>BILLING ADDRESS</Text>
        <InfoRow label="Street" value={addr.street} />
        <InfoRow label="City" value={addr.city} />
        <InfoRow label="State" value={addr.state} />
        <InfoRow label="Postcode" value={addr.postcode} />
      </View>

      {customer.site_address && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>SITE ADDRESS</Text>
          <InfoRow label="Street" value={customer.site_address?.street} />
          <InfoRow label="City" value={customer.site_address?.city} />
          <InfoRow label="State" value={customer.site_address?.state} />
          <InfoRow label="Postcode" value={customer.site_address?.postcode} />
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>RECORD</Text>
        <InfoRow label="Created" value={formatDateTime(customer.created_at)} />
        <InfoRow label="Updated" value={formatDateTime(customer.updated_at)} />
      </View>
    </ScrollView>
  );
}

function InfoRow({ label, value }: { label: string; value: string | undefined | null }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value || '\u2014'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, backgroundColor: Colors.background },
  headerCard: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
  },
  companyName: { fontSize: 22, fontWeight: '900', color: Colors.charcoal, marginBottom: 8 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: 12, fontWeight: '600', color: Colors.textSecondary },
  section: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    padding: 16,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.5,
    color: Colors.steelBlue,
    marginBottom: 12,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  infoLabel: { fontSize: 13, color: Colors.textMuted },
  infoValue: { fontSize: 13, fontWeight: '600', color: Colors.charcoal, maxWidth: '60%', textAlign: 'right' },
});
