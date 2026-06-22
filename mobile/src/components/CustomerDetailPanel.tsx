import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { api } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { Colors } from '../lib/colors';
import ErrorBanner from './ErrorBanner';

export default function CustomerDetailPanel({ itemId }: { itemId: string }) {
  const [cust, setCust] = useState<any>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try { setCust(await api(`/customers/${itemId}`)); } catch (e: any) { setError(e.message); }
    })();
  }, [itemId]);

  if (error) return <View style={s.center}><ErrorBanner message={error} /></View>;
  if (!cust) return <View style={s.center}><ActivityIndicator size="large" color={Colors.steelBlue} /></View>;
  const addr = cust.billing_address || {};

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content} testID="customer-detail-panel">
      <View style={s.headerCard}>
        <Text style={s.company}>{cust.company_name}</Text>
        <View style={s.statusRow}><View style={[s.dot, { backgroundColor: cust.active ? Colors.success : Colors.textMuted }]} /><Text style={s.statusText}>{cust.active ? 'Active' : 'Inactive'}</Text></View>
      </View>
      <View style={s.section}><Text style={s.sectionTitle}>CONTACT</Text><InfoRow label="Name" value={cust.contact_name} /><InfoRow label="Email" value={cust.contact_email} /><InfoRow label="Phone" value={cust.contact_phone} /></View>
      <View style={s.section}><Text style={s.sectionTitle}>BUSINESS</Text><InfoRow label="ABN" value={cust.abn} /><InfoRow label="Payment terms" value={cust.payment_terms} /></View>
      <View style={s.section}><Text style={s.sectionTitle}>BILLING ADDRESS</Text><InfoRow label="Street" value={addr.street} /><InfoRow label="City" value={addr.city} /><InfoRow label="State" value={addr.state} /><InfoRow label="Postcode" value={addr.postcode} /></View>
      {cust.site_address && <View style={s.section}><Text style={s.sectionTitle}>SITE ADDRESS</Text><InfoRow label="Street" value={cust.site_address?.street} /><InfoRow label="City" value={cust.site_address?.city} /><InfoRow label="State" value={cust.site_address?.state} /><InfoRow label="Postcode" value={cust.site_address?.postcode} /></View>}
      <View style={s.section}><Text style={s.sectionTitle}>RECORD</Text><InfoRow label="Created" value={formatDateTime(cust.created_at)} /><InfoRow label="Updated" value={formatDateTime(cust.updated_at)} /></View>
    </ScrollView>
  );
}
function InfoRow({ label, value }: any) { return <View style={s.infoRow}><Text style={s.infoLabel}>{label}</Text><Text style={s.infoValue}>{value || '\u2014'}</Text></View>; }
const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background }, content: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, backgroundColor: Colors.background },
  headerCard: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: 8, padding: 16, marginBottom: 16 },
  company: { fontSize: 22, fontWeight: '900', color: Colors.charcoal, marginBottom: 8 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 }, statusText: { fontSize: 12, fontWeight: '600', color: Colors.textSecondary },
  section: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: 8, padding: 16, marginBottom: 12 },
  sectionTitle: { fontSize: 10, fontWeight: '700', letterSpacing: 1.5, color: Colors.steelBlue, marginBottom: 12 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  infoLabel: { fontSize: 13, color: Colors.textMuted }, infoValue: { fontSize: 13, fontWeight: '600', color: Colors.charcoal, maxWidth: '60%', textAlign: 'right' },
});
