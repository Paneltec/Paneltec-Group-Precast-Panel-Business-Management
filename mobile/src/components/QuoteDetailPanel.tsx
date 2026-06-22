import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { api } from '../lib/api';
import { formatAUD, formatDateTime } from '../lib/format';
import { Colors } from '../lib/colors';
import StatusBadge from './StatusBadge';
import ErrorBanner from './ErrorBanner';

export default function QuoteDetailPanel({ itemId }: { itemId: string }) {
  const [quote, setQuote] = useState<any>(null);
  const [customerName, setCustomerName] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const data = await api(`/quotes/${itemId}`);
        setQuote(data);
        if (data.customer_id) {
          try { const c = await api(`/customers/${data.customer_id}`); setCustomerName(c.company_name || ''); } catch {}
        }
      } catch (e: any) { setError(e.message); }
    })();
  }, [itemId]);

  if (error) return <View style={s.center}><ErrorBanner message={error} /></View>;
  if (!quote) return <View style={s.center}><ActivityIndicator size="large" color={Colors.steelBlue} /></View>;

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content} testID="quote-detail-panel">
      <View style={s.headerCard}>
        <View style={s.headerRow}>
          <Text style={s.number}>{quote.quote_number}</Text>
          <StatusBadge status={quote.status} testID="quote-status-badge" />
        </View>
        {customerName ? <Text style={s.customer}>{customerName}</Text> : null}
        {quote.project_name ? <Text style={s.project}>Project: {quote.project_name}</Text> : null}
        <View style={s.metaRow}>
          <Meta label="Created" value={formatDateTime(quote.created_at)} />
          <Meta label="Valid until" value={quote.valid_until || '\u2014'} />
        </View>
      </View>
      <View style={s.section}>
        <Text style={s.sectionTitle}>LINE ITEMS</Text>
        {(quote.line_items ?? []).length === 0 ? <Text style={s.empty}>No line items.</Text> : (quote.line_items ?? []).map((line: any, i: number) => (
          <View key={i} style={s.lineItem} testID={`line-item-${i}`}>
            <View style={s.lineHeader}><Text style={s.lineLabel}>{line.panel_type_label || line.panel_type_key}</Text><Text style={s.lineTotal}>{formatAUD(line.total_aud)}</Text></View>
            <Text style={s.lineDetail}>{line.length_m}m x {line.height_m}m {'\u00B7'} {line.thickness_mm}mm {'\u00B7'} Qty {line.quantity}</Text>
            <Text style={s.lineDetail}>{line.finish_label || line.finish_key} {'\u00B7'} {line.concrete_grade}</Text>
          </View>
        ))}
      </View>
      <View style={s.section}>
        <Text style={s.sectionTitle}>TOTALS</Text>
        <TotalRow label="Subtotal" value={formatAUD(quote.subtotal)} />
        <TotalRow label="GST" value={formatAUD(quote.gst)} />
        <View style={s.grandTotal}><Text style={s.grandLabel}>TOTAL INC. GST</Text><Text style={s.grandValue} testID="quote-total">{formatAUD(quote.total)}</Text></View>
      </View>
      {quote.internal_notes ? <View style={s.section}><Text style={s.sectionTitle}>INTERNAL NOTES</Text><Text style={s.noteText}>{quote.internal_notes}</Text></View> : null}
    </ScrollView>
  );
}
function Meta({ label, value }: any) { return <View><Text style={s.metaLabel}>{label}</Text><Text style={s.metaValue}>{value}</Text></View>; }
function TotalRow({ label, value }: any) { return <View style={s.totalRow}><Text style={s.totalLabel}>{label}</Text><Text style={s.totalValue}>{value}</Text></View>; }
const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background }, content: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, backgroundColor: Colors.background },
  headerCard: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: 8, padding: 16, marginBottom: 16 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  number: { fontSize: 22, fontWeight: '900', color: Colors.charcoal, fontVariant: ['tabular-nums'] as any },
  customer: { fontSize: 15, fontWeight: '600', color: Colors.textSecondary, marginBottom: 4 },
  project: { fontSize: 13, color: Colors.textMuted, marginBottom: 8 },
  metaRow: { flexDirection: 'row', gap: 24, marginTop: 8 },
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
  empty: { fontSize: 13, color: Colors.textMuted }, noteText: { fontSize: 13, color: Colors.textSecondary, lineHeight: 20 },
});
