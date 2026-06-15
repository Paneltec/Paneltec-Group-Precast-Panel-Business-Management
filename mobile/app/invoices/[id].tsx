import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { api } from '../../src/lib/api';
import { formatAUD, formatDateTime } from '../../src/lib/format';
import { Colors } from '../../src/lib/colors';
import StatusBadge from '../../src/components/StatusBadge';
import ErrorBanner from '../../src/components/ErrorBanner';

export default function InvoiceDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [invoice, setInvoice] = useState<any>(null);
  const [customerName, setCustomerName] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const data = await api(`/invoices/${id}`);
        setInvoice(data);
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
  if (!invoice) return <View style={styles.center}><ActivityIndicator size="large" color={Colors.steelBlue} /></View>;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} testID="invoice-detail-page">
      <View style={styles.headerCard}>
        <View style={styles.headerRow}>
          <Text style={styles.invoiceNumber}>{invoice.invoice_number}</Text>
          <StatusBadge status={invoice.status} testID="invoice-status-badge" />
        </View>
        {customerName ? <Text style={styles.customer}>{customerName}</Text> : null}
        <View style={styles.metaRow}>
          <MetaItem label="Issue date" value={invoice.issue_date || '\u2014'} />
          <MetaItem label="Due date" value={invoice.due_date || '\u2014'} />
        </View>
      </View>

      {/* Line Items */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>LINE ITEMS</Text>
        {(invoice.line_items ?? []).map((line: any, i: number) => (
          <View key={i} style={styles.lineItem}>
            <View style={styles.lineHeader}>
              <Text style={styles.lineLabel}>{line.panel_type_label || line.panel_type_key}</Text>
              <Text style={styles.lineTotal}>{formatAUD(line.total_aud)}</Text>
            </View>
            <Text style={styles.lineDetail}>
              {line.length_m}m x {line.height_m}m {'\u00B7'} Qty {line.quantity}
            </Text>
          </View>
        ))}
      </View>

      {/* Totals */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>TOTALS</Text>
        <TotalRow label="Subtotal" value={formatAUD(invoice.subtotal)} />
        <TotalRow label="GST" value={formatAUD(invoice.gst)} />
        <View style={styles.grandTotalCard}>
          <Text style={styles.grandTotalLabel}>TOTAL INC. GST</Text>
          <Text style={styles.grandTotalValue} testID="invoice-total">{formatAUD(invoice.total)}</Text>
        </View>
      </View>

      {/* Xero Status */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>XERO</Text>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Push status</Text>
          <Text style={styles.infoValue}>{invoice.xero_push_status || 'Not pushed'}</Text>
        </View>
        {invoice.xero_invoice_id && (
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Xero ID</Text>
            <Text style={styles.infoValue}>{invoice.xero_invoice_id}</Text>
          </View>
        )}
      </View>
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
  invoiceNumber: { fontSize: 22, fontWeight: '900', color: Colors.charcoal, fontVariant: ['tabular-nums'] },
  customer: { fontSize: 15, fontWeight: '600', color: Colors.textSecondary, marginBottom: 8 },
  metaRow: { flexDirection: 'row', gap: 24 },
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
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  infoLabel: { fontSize: 13, color: Colors.textMuted },
  infoValue: { fontSize: 13, fontWeight: '600', color: Colors.charcoal },
});
