import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, TextInput, StyleSheet,
  ActivityIndicator, Modal, ScrollView, RefreshControl, useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../src/lib/api';
import { Colors } from '../../src/lib/colors';
import { useAuth } from '../../src/contexts/AuthContext';
import StatusBadge from '../../src/components/StatusBadge';

const TYPE_LABEL: Record<string, string> = {
  pre_pour: 'Pre-Pour (9.1.2)',
  post_pour: 'Post-Pour (9.1.3)',
  compliance_cert: 'Cert of Compliance (9.1.4)',
};
const TYPE_CHIPS = [
  { key: 'all', label: 'All' },
  { key: 'pre_pour', label: 'Pre-Pour' },
  { key: 'post_pour', label: 'Post-Pour' },
  { key: 'compliance_cert', label: 'Cert' },
];
const STATUS_CHIPS = [
  { key: 'all', label: 'All' },
  { key: 'draft', label: 'Draft' },
  { key: 'completed', label: 'Completed' },
  { key: 'signed', label: 'Signed' },
];

export default function FormsScreen() {
  const router = useRouter();
  const { hasPerm } = useAuth();
  const { width } = useWindowDimensions();
  const [items, setItems] = useState<any[] | null>(null);
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    try {
      const params: Record<string, string> = {};
      if (typeFilter !== 'all') params.form_type = typeFilter;
      if (statusFilter !== 'all') params.status = statusFilter;
      if (search.trim()) params.q = search.trim();
      const data = await api('/compliance-forms', { params });
      setItems(data.items || []);
    } catch { setItems([]); }
  }, [typeFilter, statusFilter, search]);

  useEffect(() => { load(); }, [load]);

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const renderItem = ({ item: f }: { item: any }) => (
    <TouchableOpacity
      testID={`form-row-${f.id}`}
      style={styles.row}
      activeOpacity={0.7}
      onPress={() => router.push(`/forms/${f.id}`)}
    >
      <View style={styles.rowLeft}>
        <Text style={styles.formNumber}>{f.form_number}</Text>
        <Text style={styles.rowType}>{TYPE_LABEL[f.form_type] || f.form_type}</Text>
        <Text style={styles.rowPanel} numberOfLines={1}>Panel: {f.panel_id}</Text>
        {f.project_name ? <Text style={styles.rowProject} numberOfLines={1}>{f.project_name}</Text> : null}
      </View>
      <View style={styles.rowRight}>
        <StatusBadge status={f.status} testID={`form-status-${f.id}`} />
        <Text style={styles.rowDate}>{f.date_of_inspection || f.updated_at?.slice(0, 10) || ''}</Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right']}>
      <View style={styles.container} testID="forms-list-page">
        {/* Search */}
        <View style={styles.searchRow}>
          <View style={styles.searchBox}>
            <Ionicons name="search" size={16} color={Colors.textMuted} />
            <TextInput
              testID="forms-search"
              style={styles.searchInput}
              placeholder="Search forms..."
              placeholderTextColor={Colors.textMuted}
              value={search}
              onChangeText={setSearch}
              returnKeyType="search"
            />
          </View>
          {hasPerm('forms.create') && (
            <TouchableOpacity testID="new-form-btn" style={styles.addBtn} onPress={() => setShowCreate(true)}>
              <Ionicons name="add" size={20} color={Colors.charcoal} />
            </TouchableOpacity>
          )}
        </View>

        {/* Type filter chips */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll} contentContainerStyle={styles.chipContent}>
          {TYPE_CHIPS.map(c => (
            <TouchableOpacity
              key={c.key}
              testID={`filter-type-${c.key}`}
              style={[styles.chip, typeFilter === c.key && styles.chipActive]}
              onPress={() => setTypeFilter(c.key)}
            >
              <Text style={[styles.chipText, typeFilter === c.key && styles.chipTextActive]}>{c.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Status filter chips */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll} contentContainerStyle={styles.chipContent}>
          {STATUS_CHIPS.map(c => (
            <TouchableOpacity
              key={c.key}
              testID={`filter-status-${c.key}`}
              style={[styles.chip, statusFilter === c.key && styles.chipActive]}
              onPress={() => setStatusFilter(c.key)}
            >
              <Text style={[styles.chipText, statusFilter === c.key && styles.chipTextActive]}>{c.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* List */}
        {items === null ? (
          <ActivityIndicator style={{ marginTop: 40 }} color={Colors.steelBlue} />
        ) : (
          <FlatList
            data={items}
            keyExtractor={(f) => f.id}
            renderItem={renderItem}
            contentContainerStyle={styles.listContent}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.steelBlue} />}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Ionicons name="clipboard-outline" size={40} color={Colors.textMuted} />
                <Text style={styles.emptyText}>No forms found</Text>
              </View>
            }
          />
        )}
      </View>

      {showCreate && (
        <CreateFormModal
          visible={showCreate}
          onClose={() => setShowCreate(false)}
          onCreated={(id: string) => { setShowCreate(false); router.push(`/forms/${id}`); }}
        />
      )}
    </SafeAreaView>
  );
}

/* ------ Create Form Modal ------ */
function CreateFormModal({ visible, onClose, onCreated }: { visible: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const [formType, setFormType] = useState('pre_pour');
  const [panelId, setPanelId] = useState('');
  const [jobs, setJobs] = useState<any[]>([]);
  const [jobId, setJobId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/jobs', { params: { page_size: 200 } }).then(d => setJobs(d.items || [])).catch(() => {});
  }, []);

  const submit = async () => {
    if (!panelId.trim()) { setError('Panel ID is required'); return; }
    setError(''); setBusy(true);
    try {
      const data = await api('/compliance-forms', {
        method: 'POST',
        body: { form_type: formType, panel_id: panelId.trim(), job_id: jobId },
      });
      onCreated(data.id);
    } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>New Compliance Form</Text>
          <Text style={styles.modalSubtitle}>Pick a form type and panel ID to create a draft.</Text>

          {/* Form type */}
          <Text style={styles.fieldLabel}>FORM TYPE</Text>
          {(['pre_pour', 'post_pour', 'compliance_cert'] as const).map(t => (
            <TouchableOpacity
              key={t}
              testID={`create-type-${t}`}
              style={[styles.radioRow, formType === t && styles.radioRowActive]}
              onPress={() => setFormType(t)}
            >
              <Ionicons name={formType === t ? 'radio-button-on' : 'radio-button-off'} size={18} color={formType === t ? Colors.steelBlue : Colors.textMuted} />
              <Text style={[styles.radioLabel, formType === t && { color: Colors.charcoal }]}>{TYPE_LABEL[t]}</Text>
            </TouchableOpacity>
          ))}

          {/* Panel ID */}
          <Text style={styles.fieldLabel}>PANEL ID</Text>
          <TextInput
            testID="create-panel-id"
            style={styles.modalInput}
            value={panelId}
            onChangeText={setPanelId}
            placeholder="e.g. P-014"
            placeholderTextColor={Colors.textMuted}
            maxLength={80}
          />

          {/* Job link (optional) */}
          <Text style={styles.fieldLabel}>LINK TO JOB (OPTIONAL)</Text>
          <ScrollView style={{ maxHeight: 120 }}>
            <TouchableOpacity style={[styles.radioRow, !jobId && styles.radioRowActive]} onPress={() => setJobId(null)}>
              <Ionicons name={!jobId ? 'radio-button-on' : 'radio-button-off'} size={16} color={!jobId ? Colors.steelBlue : Colors.textMuted} />
              <Text style={styles.radioLabel}>— No job —</Text>
            </TouchableOpacity>
            {jobs.map(j => (
              <TouchableOpacity key={j.id} style={[styles.radioRow, jobId === j.id && styles.radioRowActive]} onPress={() => setJobId(j.id)}>
                <Ionicons name={jobId === j.id ? 'radio-button-on' : 'radio-button-off'} size={16} color={jobId === j.id ? Colors.steelBlue : Colors.textMuted} />
                <Text style={styles.radioLabel} numberOfLines={1}>{j.job_number} {j.project_name ? `(${j.project_name})` : ''}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <View style={styles.modalFooter}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose}><Text style={styles.cancelText}>Cancel</Text></TouchableOpacity>
            <TouchableOpacity testID="create-form-submit" style={[styles.submitBtn, busy && { opacity: 0.5 }]} onPress={submit} disabled={busy}>
              {busy ? <ActivityIndicator color={Colors.charcoal} size="small" /> : <Text style={styles.submitText}>Create draft</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  container: { flex: 1 },
  searchRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 12, gap: 8 },
  searchBox: { flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: 8, paddingHorizontal: 12, height: 44 },
  searchInput: { flex: 1, marginLeft: 8, fontSize: 15, color: Colors.charcoal },
  addBtn: { width: 44, height: 44, borderRadius: 8, backgroundColor: Colors.safetyYellow, alignItems: 'center', justifyContent: 'center' },
  chipScroll: { flexGrow: 0, marginTop: 8 },
  chipContent: { paddingHorizontal: 16, gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border },
  chipActive: { backgroundColor: Colors.steelBlue, borderColor: Colors.steelBlue },
  chipText: { fontSize: 12, fontWeight: '600', color: Colors.textSecondary },
  chipTextActive: { color: '#FFFFFF' },
  listContent: { padding: 16, paddingBottom: 80 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: 8, padding: 14, marginBottom: 10 },
  rowLeft: { flex: 1, marginRight: 12 },
  formNumber: { fontSize: 15, fontWeight: '800', color: Colors.charcoal, fontVariant: ['tabular-nums'] as any },
  rowType: { fontSize: 11, fontWeight: '600', color: Colors.steelBlue, marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.5 },
  rowPanel: { fontSize: 13, color: Colors.textSecondary, marginTop: 4 },
  rowProject: { fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  rowRight: { alignItems: 'flex-end', gap: 4 },
  rowDate: { fontSize: 11, color: Colors.textMuted, fontVariant: ['tabular-nums'] as any },
  empty: { alignItems: 'center', paddingVertical: 60, gap: 8 },
  emptyText: { fontSize: 14, color: Colors.textMuted },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 20 },
  modalCard: { backgroundColor: '#FFF', borderRadius: 12, padding: 24, maxWidth: 500, width: '100%', alignSelf: 'center' },
  modalTitle: { fontSize: 20, fontWeight: '900', color: Colors.charcoal },
  modalSubtitle: { fontSize: 13, color: Colors.textSecondary, marginBottom: 16, marginTop: 4 },
  fieldLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1.5, color: Colors.steelBlue, marginTop: 16, marginBottom: 6 },
  radioRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 6, marginBottom: 2 },
  radioRowActive: { backgroundColor: 'rgba(58,107,140,0.08)' },
  radioLabel: { fontSize: 14, color: Colors.textSecondary, flex: 1 },
  modalInput: { height: 48, borderWidth: 1, borderColor: Colors.border, borderRadius: 6, paddingHorizontal: 14, fontSize: 15, color: Colors.charcoal, backgroundColor: Colors.background },
  errorText: { fontSize: 13, color: '#DC2626', marginTop: 8 },
  modalFooter: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: 20 },
  cancelBtn: { paddingHorizontal: 20, paddingVertical: 12, borderRadius: 6, borderWidth: 1, borderColor: Colors.border },
  cancelText: { fontSize: 14, fontWeight: '600', color: Colors.textSecondary },
  submitBtn: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 6, backgroundColor: Colors.safetyYellow, minWidth: 120, alignItems: 'center' },
  submitText: { fontSize: 14, fontWeight: '800', color: Colors.charcoal },
});
