import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { api } from '../../src/lib/api';
import { formatAUD, formatDateTime } from '../../src/lib/format';
import { Colors } from '../../src/lib/colors';
import StatusBadge from '../../src/components/StatusBadge';
import ErrorBanner from '../../src/components/ErrorBanner';

export default function JobDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [job, setJob] = useState<any>(null);
  const [customerName, setCustomerName] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const data = await api(`/jobs/${id}`);
        setJob(data);
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
  if (!job) return <View style={styles.center}><ActivityIndicator size="large" color={Colors.steelBlue} /></View>;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} testID="job-detail-page">
      <View style={styles.headerCard}>
        <View style={styles.headerRow}>
          <Text style={styles.jobNumber}>{job.job_number}</Text>
          <StatusBadge status={job.status} testID="job-status-badge" />
        </View>
        {customerName ? <Text style={styles.customer}>{customerName}</Text> : null}
        <Text style={styles.meta}>Quote: {job.quote_number}</Text>
        <View style={styles.metaRow}>
          <MetaItem label="Created" value={formatDateTime(job.created_from_quote_at)} />
          <MetaItem label="Total" value={formatAUD(job.total)} />
        </View>
      </View>

      {/* Status History */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>STATUS HISTORY</Text>
        {(job.status_history ?? []).map((h: any, i: number) => (
          <View key={i} style={styles.historyItem}>
            <StatusBadge status={h.to} />
            <View style={styles.historyMeta}>
              <Text style={styles.historyDate}>{formatDateTime(h.changed_at)}</Text>
              <Text style={styles.historyUser}>{h.by_user?.name || 'System'}</Text>
            </View>
          </View>
        ))}
      </View>

      {/* Line Items */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>LINE ITEMS</Text>
        {(job.line_items ?? []).map((line: any, i: number) => (
          <View key={i} style={styles.lineItem}>
            <View style={styles.lineHeader}>
              <Text style={styles.lineLabel}>{line.panel_type_label || line.panel_type_key}</Text>
              <Text style={styles.lineTotal}>{formatAUD(line.total_aud)}</Text>
            </View>
            <Text style={styles.lineDetail}>
              {line.length_m}m x {line.height_m}m {'\u00B7'} {line.thickness_mm}mm {'\u00B7'} Qty {line.quantity}
            </Text>
          </View>
        ))}
      </View>

      {/* Assignments */}
      {(job.assigned_vehicle || (job.assigned_employees ?? []).length > 0) && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>ASSIGNMENTS</Text>
          {job.assigned_vehicle && (
            <Text style={styles.assignText}>Vehicle: {job.assigned_vehicle.name || job.assigned_vehicle_id}</Text>
          )}
          {(job.assigned_employees ?? []).map((e: any, i: number) => (
            <Text key={i} style={styles.assignText}>Employee: {e.name || e}</Text>
          ))}
        </View>
      )}
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
  jobNumber: { fontSize: 22, fontWeight: '900', color: Colors.charcoal, fontVariant: ['tabular-nums'] },
  customer: { fontSize: 15, fontWeight: '600', color: Colors.textSecondary, marginBottom: 4 },
  meta: { fontSize: 12, color: Colors.textMuted, fontVariant: ['tabular-nums'] },
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
  historyItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  historyMeta: { flex: 1 },
  historyDate: { fontSize: 12, color: Colors.textSecondary },
  historyUser: { fontSize: 11, color: Colors.textMuted },
  lineItem: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
    paddingVertical: 12,
  },
  lineHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  lineLabel: { fontSize: 14, fontWeight: '700', color: Colors.charcoal },
  lineTotal: { fontSize: 14, fontWeight: '800', color: Colors.charcoal, fontVariant: ['tabular-nums'] },
  lineDetail: { fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  assignText: { fontSize: 13, color: Colors.textSecondary, paddingVertical: 4 },
});
