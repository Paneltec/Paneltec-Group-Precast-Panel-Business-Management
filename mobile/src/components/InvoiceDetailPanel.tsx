import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { api } from '../lib/api';
import { formatAUD, formatDateTime } from '../lib/format';
import { Colors } from '../lib/colors';
import StatusBadge from './StatusBadge';
import ErrorBanner from './ErrorBanner';

export default function InvoiceDetailPanel({ itemId }: { itemId: string }) {
  const [inv, setInv] = useState<any>(null);
  const [customerName, setCustomerName] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const data = await api(`/invoices/${itemId}`);
        setInv(data);
        if (data.customer_id) { try { const c = await api(`/customers/${data.customer_id}`); setCustomerName(c.company_name || ''); } catch {} }
      } catch (e: any) { setError(e.message); }
    })();
  }, [itemId]);

  if (error) return <View style={s.center}><ErrorBanner message={error} /></View>;
  if (!inv) return <View style={s.center}><ActivityIndicator size="large" color={Colors.steelBlue} /></View>;

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content} testID="invoice-detail-panel">
      <View style={s.headerCard}>
        <View style={s.headerRow}><Text style={s.number}>{inv.invoice_number}</Text><StatusBadge status={inv.status} testID="invoice-status-badge" /></View>
        {customerName ? <Text style={s.customer}>{customerName}</Text> : null}
        <View style={s.metaRow}><Meta label="Issue date" value={inv.issue_date || '\u2014'} /><Meta label="Due date" value={inv.due_date || '\u2014'} /></View>
      </View>
      <View style={s.section}>
        <Text style={s.sectionTitle}>LINE ITEMS</Text>
        {(inv.line_items ?? []).map((line: any, i: number) => (
          <View key={i} style={s.lineItem}><View style={s.lineHeader}><Text style={s.lineLabel}>{line.panel_type_label || line.panel_type_key}</Text><Text style={s.lineTotal}>{formatAUD(line.total_aud)}</Text></View><Text style={s.lineDetail}>{line.length_m}m x {line.height_m}m {'\u00B7'} Qty {line.quantity}</Text></View>
        ))}
      </View>
      <View style={s.section}>
        <Text style={s.sectionTitle}>TOTALS</Text>
        <TotalRow label="Subtotal" value={formatAUD(inv.subtotal)} />
        <TotalRow label="GST" value={formatAUD(inv.gst)} />
        <View style={s.grandTotal}><Text style={s.grandLabel}>TOTAL INC. GST</Text><Text style={s.grandValue} testID="invoice-total">{formatAUD(inv.total)}</Text></View>
      </View>
      <View style={s.section}>
        <Text style={s.sectionTitle}>XERO</Text>
        <InfoRow label="Push status" value={inv.xero_push_status || 'Not pushed'} />
        {inv.xero_invoice_id && <InfoRow label="Xero ID" value={inv.xero_invoice_id} />}
      </View>
    </ScrollView>
  );
}
function Meta({ label, value }: any) { return <View><Text style={s.metaLabel}>{label}</Text><Text style={s.metaValue}>{value}</Text></View>; }
function TotalRow({ label, value }: any) { return <View style={s.totalRow}><Text style={s.totalLabel}>{label}</Text><Text style={s.totalValue}>{value}</Text></View>; }
function InfoRow({ label, value }: any) { return <View style={s.infoRow}><Text style={s.infoLabel}>{label}</Text><Text style={s.infoValue}>{value}</Text></View>; }
const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background }, content: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, backgroundColor: Colors.background },
  headerCard: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: 8, padding: 16, marginBottom: 16 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  number: { fontSize: 22, fontWeight: '900', color: Colors.charcoal, fontVariant: ['tabular-nums'] as any },
  customer: { fontSize: 15, fontWeight: '600', color: Colors.textSecondary, marginBottom: 8 },
  metaRow: { flexDirection: 'row', gap: 24 },
  metaLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1, color: Colors.textMuted, textTransform: 'uppercase' },
  metaValue: { fontSize: 13, fontWeight: '600', color: Colors.charcoal, marginTop: 2 },
  section: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: 8, padding: 16, marginBottom: 16 },
  sectionTitle: { fontSize: 10, fontWeight: '700', letterSpacing: 1.5, color: Colors.steelBlue, marginBottom: 12 },
  lineItem: { borderBottomWidth: 1, borderBottomColor: Colors.borderLight, paddingVertical: 12 },
  lineHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  lineLabel: { fontSize: 14, fontWeight: '700', color: Colors.charcoal }, lineTotal: { fontSize: 14, fontWeight: '800', color: Colors.charcoal, fontVariant: ['tabular-nums'] as any },
  lineDetail: { fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  totalLabel: { fontSize: 14, color: Colors.textSecondary }, totalValue: { fontSize: 14, fontWeight: '600', color: Colors.charcoal, fontVariant: ['tabular-nums'] as any },
  grandTotal: { backgroundColor: Colors.safetyYellow, borderRadius: 6, padding: 16, marginTop: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  grandLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 2, color: 'rgba(31,42,51,0.6)' }, grandValue: { fontSize: 24, fontWeight: '900', color: Colors.charcoal, fontVariant: ['tabular-nums'] as any },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  infoLabel: { fontSize: 13, color: Colors.textMuted }, infoValue: { fontSize: 13, fontWeight: '600', color: Colors.charcoal },
});
