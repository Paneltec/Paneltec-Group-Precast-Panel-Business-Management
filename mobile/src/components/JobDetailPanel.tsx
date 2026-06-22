import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { api } from '../lib/api';
import { formatAUD, formatDateTime } from '../lib/format';
import { Colors } from '../lib/colors';
import StatusBadge from './StatusBadge';
import ErrorBanner from './ErrorBanner';

export default function JobDetailPanel({ itemId }: { itemId: string }) {
  const [job, setJob] = useState<any>(null);
  const [customerName, setCustomerName] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const data = await api(`/jobs/${itemId}`);
        setJob(data);
        if (data.customer_id) {
          try { const c = await api(`/customers/${data.customer_id}`); setCustomerName(c.company_name || ''); } catch {}
        }
      } catch (e: any) { setError(e.message); }
    })();
  }, [itemId]);

  if (error) return <View style={s.center}><ErrorBanner message={error} /></View>;
  if (!job) return <View style={s.center}><ActivityIndicator size="large" color={Colors.steelBlue} /></View>;

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content} testID="job-detail-panel">
      <View style={s.headerCard}>
        <View style={s.headerRow}><Text style={s.number}>{job.job_number}</Text><StatusBadge status={job.status} testID="job-status-badge" /></View>
        {customerName ? <Text style={s.customer}>{customerName}</Text> : null}
        <Text style={s.meta}>Quote: {job.quote_number}</Text>
        <View style={s.metaRow}><Meta label="Created" value={formatDateTime(job.created_from_quote_at)} /><Meta label="Total" value={formatAUD(job.total)} /></View>
      </View>
      <View style={s.section}>
        <Text style={s.sectionTitle}>STATUS HISTORY</Text>
        {(job.status_history ?? []).map((h: any, i: number) => (
          <View key={i} style={s.historyItem}><StatusBadge status={h.to} /><View style={s.historyMeta}><Text style={s.historyDate}>{formatDateTime(h.changed_at)}</Text><Text style={s.historyUser}>{h.by_user?.name || 'System'}</Text></View></View>
        ))}
      </View>
      <View style={s.section}>
        <Text style={s.sectionTitle}>LINE ITEMS</Text>
        {(job.line_items ?? []).map((line: any, i: number) => (
          <View key={i} style={s.lineItem}><View style={s.lineHeader}><Text style={s.lineLabel}>{line.panel_type_label || line.panel_type_key}</Text><Text style={s.lineTotal}>{formatAUD(line.total_aud)}</Text></View><Text style={s.lineDetail}>{line.length_m}m x {line.height_m}m {'\u00B7'} {line.thickness_mm}mm {'\u00B7'} Qty {line.quantity}</Text></View>
        ))}
      </View>
      {(job.assigned_vehicle || (job.assigned_employees ?? []).length > 0) && (
        <View style={s.section}><Text style={s.sectionTitle}>ASSIGNMENTS</Text>
          {job.assigned_vehicle && <Text style={s.assign}>Vehicle: {job.assigned_vehicle.name || job.assigned_vehicle_id}</Text>}
          {(job.assigned_employees ?? []).map((e: any, i: number) => <Text key={i} style={s.assign}>Employee: {e.name || e}</Text>)}
        </View>
      )}
    </ScrollView>
  );
}
function Meta({ label, value }: any) { return <View><Text style={s.metaLabel}>{label}</Text><Text style={s.metaValue}>{value}</Text></View>; }
const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background }, content: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, backgroundColor: Colors.background },
  headerCard: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: 8, padding: 16, marginBottom: 16 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  number: { fontSize: 22, fontWeight: '900', color: Colors.charcoal, fontVariant: ['tabular-nums'] as any },
  customer: { fontSize: 15, fontWeight: '600', color: Colors.textSecondary, marginBottom: 4 },
  meta: { fontSize: 12, color: Colors.textMuted, fontVariant: ['tabular-nums'] as any },
  metaRow: { flexDirection: 'row', gap: 24, marginTop: 8 },
  metaLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1, color: Colors.textMuted, textTransform: 'uppercase' },
  metaValue: { fontSize: 13, fontWeight: '600', color: Colors.charcoal, marginTop: 2 },
  section: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: 8, padding: 16, marginBottom: 16 },
  sectionTitle: { fontSize: 10, fontWeight: '700', letterSpacing: 1.5, color: Colors.steelBlue, marginBottom: 12 },
  historyItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  historyMeta: { flex: 1 }, historyDate: { fontSize: 12, color: Colors.textSecondary }, historyUser: { fontSize: 11, color: Colors.textMuted },
  lineItem: { borderBottomWidth: 1, borderBottomColor: Colors.borderLight, paddingVertical: 12 },
  lineHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  lineLabel: { fontSize: 14, fontWeight: '700', color: Colors.charcoal }, lineTotal: { fontSize: 14, fontWeight: '800', color: Colors.charcoal, fontVariant: ['tabular-nums'] as any },
  lineDetail: { fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  assign: { fontSize: 13, color: Colors.textSecondary, paddingVertical: 4 },
});
