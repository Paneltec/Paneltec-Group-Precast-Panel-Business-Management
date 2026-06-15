import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { api } from '../../src/lib/api';
import { formatAUD, formatDateTime } from '../../src/lib/format';
import { Colors } from '../../src/lib/colors';
import StatusBadge from '../../src/components/StatusBadge';
import ErrorBanner from '../../src/components/ErrorBanner';

export default function QuoteDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [quote, setQuote] = useState<any>(null);
  const [customerName, setCustomerName] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const data = await api(`/quotes/${id}`);
        setQuote(data);
        if (data.customer_id) {
          try {
            const cust = await api(`/customers/${data.customer_id}`);
            setCustomerName(cust.company_name || '');
          } catch {}
        }
      } catch (e: any) {
        setError(e.message);
      }
    })();
  }, [id]);

  if (error) return <View style={styles.center}><ErrorBanner message={error} /></View>;
  if (!quote) return <View style={styles.center}><ActivityIndicator size="large" color={Colors.steelBlue} /></View>;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} testID="quote-detail-page">
      {/* Header */}
      <View style={styles.headerCard}>
        <View style={styles.headerRow}>
          <Text style={styles.quoteNumber}>{quote.quote_number}</Text>
          <StatusBadge status={quote.status} testID="quote-status-badge" />
        </View>
        {customerName ? <Text style={styles.customer}>{customerName}</Text> : null}
        {quote.project_name ? <Text style={styles.project}>Project: {quote.project_name}</Text> : null}
        <View style={styles.metaRow}>
          <MetaItem label="Created" value={formatDateTime(quote.created_at)} />
          <MetaItem label="Valid until" value={quote.valid_until || '\u2014'} />
        </View>
      </View>

      {/* Line Items */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>LINE ITEMS</Text>
        {(quote.line_items ?? []).length === 0 ? (
          <Text style={styles.emptyText}>No line items.</Text>
        ) : (
          (quote.line_items ?? []).map((line: any, i: number) => (
            <View key={i} style={styles.lineItem} testID={`line-item-${i}`}>
              <View style={styles.lineHeader}>
                <Text style={styles.lineLabel}>{line.panel_type_label || line.panel_type_key}</Text>
                <Text style={styles.lineTotal}>{formatAUD(line.total_aud)}</Text>
              </View>
              <Text style={styles.lineDetail}>
                {line.length_m}m x {line.height_m}m {'\u00B7'} {line.thickness_mm}mm {'\u00B7'} Qty {line.quantity}
              </Text>
              <Text style={styles.lineDetail}>
                {line.finish_label || line.finish_key} {'\u00B7'} {line.concrete_grade}
              </Text>
            </View>
          ))
        )}
      </View>

      {/* Totals */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>TOTALS</Text>
        <TotalRow label="Subtotal" value={formatAUD(quote.subtotal)} />
        <TotalRow label="GST" value={formatAUD(quote.gst)} />
        <View style={styles.grandTotalCard}>
          <Text style={styles.grandTotalLabel}>TOTAL INC. GST</Text>
          <Text style={styles.grandTotalValue} testID="quote-total">{formatAUD(quote.total)}</Text>
        </View>
      </View>

      {quote.internal_notes ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>INTERNAL NOTES</Text>
          <Text style={styles.noteText}>{quote.internal_notes}</Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metaItem}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue}>{value}</Text>
    </View>
  );
}

function TotalRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.totalRow}>
      <Text style={styles.totalLabel}>{label}</Text>
      <Text style={styles.totalValue}>{value}</Text>
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
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  quoteNumber: { fontSize: 22, fontWeight: '900', color: Colors.charcoal, fontVariant: ['tabular-nums'] },
  customer: { fontSize: 15, fontWeight: '600', color: Colors.textSecondary, marginBottom: 4 },
  project: { fontSize: 13, color: Colors.textMuted, marginBottom: 8 },
  metaRow: { flexDirection: 'row', gap: 24, marginTop: 8 },
  metaItem: {},
  metaLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1, color: Colors.textMuted, textTransform: 'uppercase' },
  metaValue: { fontSize: 13, fontWeight: '600', color: Colors.charcoal, marginTop: 2 },
  section: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.5,
    color: Colors.steelBlue,
    marginBottom: 12,
  },
  lineItem: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
    paddingVertical: 12,
  },
  lineHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  lineLabel: { fontSize: 14, fontWeight: '700', color: Colors.charcoal },
  lineTotal: { fontSize: 14, fontWeight: '800', color: Colors.charcoal, fontVariant: ['tabular-nums'] },
  lineDetail: { fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  totalLabel: { fontSize: 14, color: Colors.textSecondary },
  totalValue: { fontSize: 14, fontWeight: '600', color: Colors.charcoal, fontVariant: ['tabular-nums'] },
  grandTotalCard: {
    backgroundColor: Colors.safetyYellow,
    borderRadius: 6,
    padding: 16,
    marginTop: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  grandTotalLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 2, color: 'rgba(31,42,51,0.6)' },
  grandTotalValue: { fontSize: 24, fontWeight: '900', color: Colors.charcoal, fontVariant: ['tabular-nums'] },
  emptyText: { fontSize: 13, color: Colors.textMuted },
  noteText: { fontSize: 13, color: Colors.textSecondary, lineHeight: 20 },
});
