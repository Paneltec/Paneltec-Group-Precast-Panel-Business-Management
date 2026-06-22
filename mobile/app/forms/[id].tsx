import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, Image, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as WebBrowser from 'expo-web-browser';
import { api, apiUpload, tokenStore, API_BASE } from '../../src/lib/api';
import { Colors } from '../../src/lib/colors';
import { useAuth } from '../../src/contexts/AuthContext';
import StatusBadge from '../../src/components/StatusBadge';

const TYPE_LABEL: Record<string, string> = {
  pre_pour: 'Pre-Pour Checklist (9.1.2)',
  post_pour: 'Post-Pour Checklist (9.1.3)',
  compliance_cert: "Manufacturer's Certificate (9.1.4)",
};

export default function FormDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { hasPerm } = useAuth();
  const [form, setForm] = useState<any>(null);
  const [schema, setSchema] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [f, s, u] = await Promise.all([
        api(`/compliance-forms/${id}`),
        api('/compliance-forms/schemas'),
        api('/users', { params: { status: 'active' } }).catch(() => ({ items: [] })),
      ]);
      setForm(f);
      setSchema(s[f.form_type]);
      setUsers(u.items || []);
      setDirty(false);
    } catch (e: any) { setError(e.message); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (error) return (
    <SafeAreaView style={styles.safe}><View style={styles.center}><Text style={styles.errorText}>{error}</Text></View></SafeAreaView>
  );
  if (!form || !schema) return (
    <SafeAreaView style={styles.safe}><View style={styles.center}><ActivityIndicator color={Colors.steelBlue} /></View></SafeAreaView>
  );

  const locked = form.status === 'signed';
  const update = (patch: any) => { setForm((p: any) => ({ ...p, ...patch })); setDirty(true); };
  const updateSection = (sKey: string, cKey: string, field: string, value: any) => {
    const sections = { ...form.sections };
    sections[sKey] = { ...sections[sKey] };
    sections[sKey][cKey] = { ...(sections[sKey][cKey] || {}), [field]: value };
    update({ sections });
  };

  // Bulk set all criteria in a section to the same record
  const bulkRecord = (sKey: string, record: string, criteria: any[]) => {
    const sections = { ...form.sections };
    sections[sKey] = { ...sections[sKey] };
    for (const c of criteria) {
      sections[sKey][c.key] = { ...(sections[sKey][c.key] || {}), record };
    }
    update({ sections });
  };

  const save = async () => {
    setSaving(true);
    try {
      await api(`/compliance-forms/${id}`, {
        method: 'PATCH',
        body: {
          panel_id: form.panel_id, client_name: form.client_name, project_name: form.project_name,
          grade_of_concrete: form.grade_of_concrete, date_of_inspection: form.date_of_inspection,
          date_of_casting: form.date_of_casting, sections: form.sections,
          ncr_flag: form.ncr_flag, ncr_reference: form.ncr_reference,
          checked_by_user_id: form.checked_by_user_id, checked_by_qa_user_id: form.checked_by_qa_user_id,
        },
      });
      setDirty(false);
      await load();
    } catch (e: any) { Alert.alert('Error', e.message); }
    finally { setSaving(false); }
  };

  const transition = async (to: string) => {
    if (dirty) await save();
    try {
      await api(`/compliance-forms/${id}/transition`, { method: 'POST', body: { to } });
      await load();
    } catch (e: any) { Alert.alert('Error', e.message); }
  };

  const openPdf = async () => {
    const token = await tokenStore.get();
    const url = `${API_BASE}/compliance-forms/${id}/pdf?token=${token}`;
    await WebBrowser.openBrowserAsync(url);
  };

  const pickPhoto = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (result.canceled) return;
    const asset = result.assets[0];
    const fd = new FormData();
    fd.append('file', { uri: asset.uri, name: asset.fileName || 'photo.jpg', type: asset.mimeType || 'image/jpeg' } as any);
    fd.append('caption', '');
    try {
      await apiUpload(`/compliance-forms/${id}/photos`, fd);
      await load();
    } catch (e: any) { Alert.alert('Upload failed', e.message); }
  };

  /* Progress bar calculation */
  let totalCriteria = 0, completedCriteria = 0;
  if (form.form_type !== 'compliance_cert' && schema.sections) {
    for (const sec of schema.sections) {
      for (const c of (sec.criteria || [])) {
        totalCriteria++;
        const v = form.sections?.[sec.key]?.[c.key];
        if (v?.record) completedCriteria++;
      }
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {/* Header card */}
        <View style={styles.headerCard}>
          <View style={styles.headerTop}>
            <View style={{ flex: 1 }}>
              <Text style={styles.schemaTitle}>{schema.title || TYPE_LABEL[form.form_type]}</Text>
              <Text style={styles.formNumber} testID="form-number">{form.form_number}</Text>
              <View style={styles.statusRow}>
                <StatusBadge status={form.status} testID="form-status" />
                {form.project_name ? <Text style={styles.projectName}>{form.project_name}</Text> : null}
              </View>
            </View>
            <TouchableOpacity testID="qa-report-btn" style={styles.pdfBtn} onPress={openPdf}>
              <Ionicons name="document-text-outline" size={16} color={Colors.charcoal} />
              <Text style={styles.pdfBtnText}>QA Report</Text>
            </TouchableOpacity>
          </View>

          {/* Progress bar */}
          {totalCriteria > 0 && (
            <View style={styles.progressWrap} testID="progress-bar">
              <View style={styles.progressBg}>
                <View style={[styles.progressFill, { width: `${(completedCriteria / totalCriteria) * 100}%` }]} />
              </View>
              <Text style={styles.progressText}>{completedCriteria}/{totalCriteria}</Text>
            </View>
          )}

          {/* Meta fields */}
          <View style={styles.metaGrid}>
            <MetaField label="Panel ID" value={form.panel_id} onChange={(v: string) => update({ panel_id: v })} locked={locked} testID="panel-id-input" />
            <MetaField label="Client" value={form.client_name} onChange={(v: string) => update({ client_name: v })} locked={locked} />
            <MetaField label="Date of Inspection" value={form.date_of_inspection || ''} onChange={(v: string) => update({ date_of_inspection: v })} locked={locked} />
            <MetaField label="Grade of Concrete" value={form.grade_of_concrete} onChange={(v: string) => update({ grade_of_concrete: v })} locked={locked} />
          </View>
        </View>

        {/* Sections — Pre-Pour & Post-Pour */}
        {form.form_type !== 'compliance_cert' && (schema.sections || []).map((section: any) => (
          <SectionCard
            key={section.key}
            section={section}
            values={form.sections?.[section.key] || {}}
            locked={locked}
            onRecord={(cKey: string, record: string) => updateSection(section.key, cKey, 'record', record)}
            onNotes={(cKey: string, notes: string) => updateSection(section.key, cKey, 'notes', notes)}
            onValue={(cKey: string, value: string) => updateSection(section.key, cKey, 'value', value)}
            onBulk={(record: string) => bulkRecord(section.key, record, section.criteria || [])}
            onDefectsChange={(arr: any[]) => {
              const sections = { ...form.sections };
              sections[section.key] = { ...sections[section.key], _defects: arr };
              update({ sections });
            }}
            defects={form.sections?.[section.key]?._defects}
          />
        ))}

        {/* Compliance Cert editor */}
        {form.form_type === 'compliance_cert' && (
          <CertEditor schema={schema} form={form} update={update} locked={locked} />
        )}

        {/* Photos */}
        <PhotoZone photos={form.photos || []} locked={locked} onPick={pickPhoto} formId={id!} onReload={load} />

        {/* NCR & Sign-off */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>NCR & SIGN-OFF</Text>
          <TouchableOpacity
            testID="ncr-flag"
            style={styles.checkRow}
            onPress={() => !locked && update({ ncr_flag: !form.ncr_flag })}
            disabled={locked}
          >
            <Ionicons name={form.ncr_flag ? 'checkbox' : 'square-outline'} size={22} color={form.ncr_flag ? '#DC2626' : Colors.textMuted} />
            <Text style={styles.checkLabel}>NCR raised</Text>
          </TouchableOpacity>
          {form.ncr_flag && (
            <TextInput
              testID="ncr-ref"
              style={styles.metaInput}
              value={form.ncr_reference || ''}
              onChangeText={(v) => update({ ncr_reference: v })}
              placeholder="NCR reference"
              placeholderTextColor={Colors.textMuted}
              editable={!locked}
            />
          )}
          {form.signed_at && (
            <View style={styles.signedBanner}>
              <Ionicons name="checkmark-circle" size={16} color="#166534" />
              <Text style={styles.signedText}>Signed at {form.signed_at?.slice(0, 16).replace('T', ' ')}</Text>
            </View>
          )}
        </View>
      </ScrollView>

      {/* Sticky bottom actions */}
      <View style={styles.bottomBar}>
        {!locked && dirty && (
          <TouchableOpacity testID="save-draft-btn" style={styles.saveDraftBtn} onPress={save} disabled={saving}>
            {saving ? <ActivityIndicator color={Colors.charcoal} size="small" /> : (
              <><Ionicons name="save-outline" size={16} color={Colors.charcoal} /><Text style={styles.saveDraftText}>Save Draft</Text></>
            )}
          </TouchableOpacity>
        )}
        {form.status === 'draft' && (
          <TouchableOpacity testID="mark-complete-btn" style={styles.completeBtn} onPress={() => transition('completed')}>
            <Ionicons name="checkmark-done" size={16} color="#FFF" />
            <Text style={styles.completeBtnText}>Mark Complete</Text>
          </TouchableOpacity>
        )}
        {form.status === 'completed' && hasPerm('forms.sign') && (
          <TouchableOpacity testID="sign-btn" style={styles.signBtn} onPress={() => transition('signed')}>
            <Ionicons name="create" size={16} color="#FFF" />
            <Text style={styles.signBtnText}>Sign</Text>
          </TouchableOpacity>
        )}
        {form.status !== 'draft' && hasPerm('forms.edit') && (
          <TouchableOpacity testID="revert-btn" style={styles.revertBtn} onPress={() => transition('draft')}>
            <Ionicons name="arrow-undo" size={16} color={Colors.textSecondary} />
            <Text style={styles.revertBtnText}>Revert</Text>
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  );
}

/* ---------- Sub-components ---------- */

function MetaField({ label, value, onChange, locked, testID }: any) {
  return (
    <View style={styles.metaField}>
      <Text style={styles.metaLabel}>{label}</Text>
      <TextInput
        testID={testID}
        style={[styles.metaInput, locked && styles.metaInputLocked]}
        value={value || ''}
        onChangeText={onChange}
        editable={!locked}
        placeholderTextColor={Colors.textMuted}
      />
    </View>
  );
}

function SectionCard({ section, values, locked, onRecord, onNotes, onValue, onBulk, onDefectsChange, defects }: any) {
  // Determine bulk status
  const criteria = section.criteria || [];
  const allRecords = criteria.map((c: any) => values[c.key]?.record).filter(Boolean);
  const bulkStatus = allRecords.length === criteria.length && new Set(allRecords).size === 1 ? allRecords[0] : null;

  return (
    <View style={styles.sectionCard} testID={`section-${section.key}`}>
      <Text style={styles.sectionTitle}>{section.label}</Text>

      {/* PASS/FAIL/N/A segmented control */}
      {criteria.length > 0 && (
        <View style={styles.segmentRow} testID={`bulk-${section.key}`}>
          {[{ key: 'ok', label: 'PASS', icon: 'checkmark' }, { key: 'rectify', label: 'FAIL', icon: 'close' }, { key: 'na', label: 'N/A', icon: 'remove' }].map(opt => (
            <TouchableOpacity
              key={opt.key}
              testID={`bulk-${section.key}-${opt.key}`}
              style={[
                styles.segmentBtn,
                bulkStatus === opt.key && (opt.key === 'ok' ? styles.segPassActive : opt.key === 'rectify' ? styles.segFailActive : styles.segNaActive),
              ]}
              onPress={() => !locked && onBulk(opt.key)}
              disabled={locked}
            >
              <Ionicons name={opt.icon as any} size={16} color={bulkStatus === opt.key ? '#FFF' : Colors.textSecondary} />
              <Text style={[styles.segmentText, bulkStatus === opt.key && { color: '#FFF' }]}>{opt.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Per criterion */}
      {criteria.map((c: any) => {
        const v = values[c.key] || {};
        return (
          <View key={c.key} style={styles.criterionRow} testID={`criterion-${c.key}`}>
            <View style={styles.criterionTop}>
              <Text style={styles.criterionLabel}>{c.label}</Text>
              <View style={styles.recordBtns}>
                {[{ key: 'ok', label: '✓', style: styles.recOk, active: styles.recOkActive },
                  { key: 'rectify', label: '✗', style: styles.recFail, active: styles.recFailActive },
                  { key: 'na', label: 'N/A', style: styles.recNa, active: styles.recNaActive }].map(r => (
                  <TouchableOpacity
                    key={r.key}
                    testID={`record-${c.key}-${r.key}`}
                    style={[styles.recBtn, v.record === r.key && r.active]}
                    onPress={() => !locked && onRecord(c.key, r.key)}
                    disabled={locked}
                  >
                    <Text style={[styles.recBtnText, v.record === r.key && { color: '#FFF' }]}>{r.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            {c.value_unit && (
              <TextInput
                style={styles.valueInput}
                placeholder={c.value_unit}
                placeholderTextColor={Colors.textMuted}
                value={v.value || ''}
                onChangeText={(t) => onValue(c.key, t)}
                editable={!locked}
              />
            )}
            <TextInput
              style={styles.notesInput}
              placeholder="Notes..."
              placeholderTextColor={Colors.textMuted}
              value={v.notes || ''}
              onChangeText={(t) => onNotes(c.key, t)}
              multiline
              numberOfLines={2}
              editable={!locked}
            />
          </View>
        );
      })}

      {/* Defects list (post_pour) */}
      {section.defects_list && (
        <DefectsEditor defects={defects || []} onChange={onDefectsChange} locked={locked} />
      )}
    </View>
  );
}

function DefectsEditor({ defects, onChange, locked }: any) {
  const add = () => onChange([...(defects || []), { location: '', description: '', remedy: '' }]);
  const upd = (i: number, field: string, v: string) => {
    const arr = [...defects]; arr[i] = { ...arr[i], [field]: v }; onChange(arr);
  };
  const rm = (i: number) => { const arr = [...defects]; arr.splice(i, 1); onChange(arr); };
  return (
    <View testID="defects-editor">
      <Text style={styles.defectsHelp}>List any visual defects with location and remedy.</Text>
      {(defects || []).map((d: any, i: number) => (
        <View key={i} style={styles.defectRow}>
          <TextInput style={styles.defectInput} placeholder="Location" value={d.location} onChangeText={(v) => upd(i, 'location', v)} editable={!locked} placeholderTextColor={Colors.textMuted} />
          <TextInput style={[styles.defectInput, { flex: 2 }]} placeholder="Description" value={d.description} onChangeText={(v) => upd(i, 'description', v)} editable={!locked} placeholderTextColor={Colors.textMuted} />
          <TextInput style={styles.defectInput} placeholder="Remedy" value={d.remedy} onChangeText={(v) => upd(i, 'remedy', v)} editable={!locked} placeholderTextColor={Colors.textMuted} />
          {!locked && <TouchableOpacity onPress={() => rm(i)}><Ionicons name="trash-outline" size={18} color="#DC2626" /></TouchableOpacity>}
        </View>
      ))}
      {!locked && (
        <TouchableOpacity testID="add-defect" style={styles.addDefectBtn} onPress={add}>
          <Ionicons name="add" size={16} color={Colors.steelBlue} /><Text style={styles.addDefectText}>Add defect</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

function CertEditor({ schema, form, update, locked }: any) {
  const header = form.sections?.header || {};
  const schedule = form.sections?.schedule_of_elements || [];
  const sig = form.sections?.signature || {};
  const setHeader = (k: string, v: string) => {
    const sections = { ...form.sections, header: { ...header, [k]: v } }; update({ sections });
  };
  const setSchedule = (arr: any[]) => {
    const sections = { ...form.sections, schedule_of_elements: arr }; update({ sections });
  };
  const setSig = (k: string, v: string) => {
    const sections = { ...form.sections, signature: { ...sig, [k]: v } }; update({ sections });
  };
  return (
    <>
      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>HEADER</Text>
        {(schema.header_fields || []).map((f: any) => (
          <MetaField key={f.key} label={f.label} value={header[f.key] || ''} onChange={(v: string) => setHeader(f.key, v)} locked={locked} />
        ))}
      </View>
      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>{schema.schedule_of_elements_label}</Text>
        {schedule.map((row: any, i: number) => (
          <View key={i} style={styles.defectRow}>
            <TextInput style={[styles.defectInput, { flex: 2 }]} placeholder="Identification Number" value={row.identification_number || ''} onChangeText={(v) => { const arr = [...schedule]; arr[i] = { ...arr[i], identification_number: v }; setSchedule(arr); }} editable={!locked} placeholderTextColor={Colors.textMuted} />
            <TextInput style={styles.defectInput} placeholder="Casting Date" value={row.casting_date || ''} onChangeText={(v) => { const arr = [...schedule]; arr[i] = { ...arr[i], casting_date: v }; setSchedule(arr); }} editable={!locked} placeholderTextColor={Colors.textMuted} />
            {!locked && <TouchableOpacity onPress={() => { const arr = [...schedule]; arr.splice(i, 1); setSchedule(arr); }}><Ionicons name="trash-outline" size={18} color="#DC2626" /></TouchableOpacity>}
          </View>
        ))}
        {!locked && (
          <TouchableOpacity style={styles.addDefectBtn} onPress={() => setSchedule([...schedule, { identification_number: '', casting_date: '' }])}>
            <Ionicons name="add" size={16} color={Colors.steelBlue} /><Text style={styles.addDefectText}>Add element</Text>
          </TouchableOpacity>
        )}
        <View style={styles.declBanner}>
          <Text style={styles.declText}>{schema.declaration_text}</Text>
          <Text style={styles.stdRef}>Standards: {(schema.standards_referenced || []).join(' · ')}</Text>
        </View>
      </View>
      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>SIGNATORY</Text>
        <MetaField label="Name" value={sig.name} onChange={(v: string) => setSig('name', v)} locked={locked} />
        <MetaField label="Signature (typed)" value={sig.signature} onChange={(v: string) => setSig('signature', v)} locked={locked} />
        <MetaField label="Date" value={sig.date} onChange={(v: string) => setSig('date', v)} locked={locked} />
      </View>
    </>
  );
}

function PhotoZone({ photos, locked, onPick, formId, onReload }: any) {
  const deletePhoto = async (pid: string) => {
    Alert.alert('Delete photo?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          try { await api(`/compliance-forms/${formId}/photos/${pid}`, { method: 'DELETE' }); onReload(); }
          catch (e: any) { Alert.alert('Error', e.message); }
        },
      },
    ]);
  };

  return (
    <View style={styles.sectionCard} testID="photo-zone">
      <Text style={styles.sectionTitle}>PHOTOS</Text>
      {!locked && (
        <TouchableOpacity testID="photo-upload-btn" style={styles.photoUploadBtn} onPress={onPick}>
          <Ionicons name="camera" size={20} color={Colors.steelBlue} />
          <Text style={styles.photoUploadText}>Add photo from library</Text>
        </TouchableOpacity>
      )}
      {photos.length === 0 ? (
        <Text style={styles.noPhotos}>No photos uploaded yet.</Text>
      ) : (
        <View style={styles.photoGrid}>
          {photos.map((p: any) => (
            <View key={p.id} style={styles.photoThumb} testID={`photo-${p.id}`}>
              <Image source={{ uri: `${API_BASE}/compliance-forms/${formId}/photos/${p.id}` }} style={styles.photoImg} />
              <Text style={styles.photoFilename} numberOfLines={1}>{p.filename}</Text>
              {p.gps_lat != null && <Text style={styles.photoGps}>{p.gps_lat}, {p.gps_lng}</Text>}
              {!locked && (
                <TouchableOpacity testID={`delete-photo-${p.id}`} onPress={() => deletePhoto(p.id)}>
                  <Text style={styles.photoDelete}>Delete</Text>
                </TouchableOpacity>
              )}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  errorText: { color: '#DC2626', fontSize: 14 },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 120 },

  // Header card
  headerCard: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: 10, padding: 16, marginBottom: 12 },
  headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  schemaTitle: { fontSize: 10, fontWeight: '700', letterSpacing: 1.5, color: Colors.steelBlue, textTransform: 'uppercase' },
  formNumber: { fontSize: 22, fontWeight: '900', color: Colors.charcoal, fontVariant: ['tabular-nums'] as any, marginTop: 2 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  projectName: { fontSize: 12, color: Colors.textSecondary },
  pdfBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.safetyYellow, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 6 },
  pdfBtnText: { fontSize: 12, fontWeight: '700', color: Colors.charcoal },
  progressWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  progressBg: { flex: 1, height: 6, backgroundColor: Colors.border, borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: 6, backgroundColor: Colors.steelBlue, borderRadius: 3 },
  progressText: { fontSize: 12, fontWeight: '700', color: Colors.steelBlue, minWidth: 30 },
  metaGrid: { marginTop: 12, gap: 10 },
  metaField: { gap: 4 },
  metaLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1.2, color: Colors.steelBlue, textTransform: 'uppercase' },
  metaInput: { height: 40, borderWidth: 1, borderColor: Colors.border, borderRadius: 6, paddingHorizontal: 12, fontSize: 14, color: Colors.charcoal, backgroundColor: Colors.background },
  metaInputLocked: { backgroundColor: '#F3F4F6', color: Colors.textMuted },

  // Section card
  sectionCard: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: 10, padding: 16, marginBottom: 12 },
  sectionTitle: { fontSize: 11, fontWeight: '800', letterSpacing: 1.5, color: Colors.steelBlue, textTransform: 'uppercase', marginBottom: 12 },

  // Segment control
  segmentRow: { flexDirection: 'row', gap: 0, marginBottom: 16, borderWidth: 1, borderColor: Colors.border, borderRadius: 8, overflow: 'hidden' },
  segmentBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 12, backgroundColor: Colors.background },
  segmentText: { fontSize: 12, fontWeight: '800', letterSpacing: 1, color: Colors.textSecondary },
  segPassActive: { backgroundColor: '#166534' },
  segFailActive: { backgroundColor: '#991B1B' },
  segNaActive: { backgroundColor: '#374151' },

  // Criterion row
  criterionRow: { borderBottomWidth: 1, borderBottomColor: Colors.border, paddingBottom: 12, marginBottom: 12 },
  criterionTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  criterionLabel: { fontSize: 14, fontWeight: '600', color: Colors.charcoal, flex: 1 },
  recordBtns: { flexDirection: 'row', gap: 4 },
  recBtn: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4, borderWidth: 1, borderColor: Colors.border, minWidth: 32, alignItems: 'center' },
  recBtnText: { fontSize: 10, fontWeight: '700', color: Colors.textSecondary },
  recOkActive: { backgroundColor: '#166534', borderColor: '#166534' },
  recFailActive: { backgroundColor: '#991B1B', borderColor: '#991B1B' },
  recNaActive: { backgroundColor: '#374151', borderColor: '#374151' },
  valueInput: { height: 36, borderWidth: 1, borderColor: Colors.border, borderRadius: 4, paddingHorizontal: 10, fontSize: 13, color: Colors.charcoal, marginTop: 6, maxWidth: 200, backgroundColor: Colors.background },
  notesInput: { borderWidth: 1, borderColor: Colors.border, borderRadius: 4, paddingHorizontal: 10, paddingVertical: 6, fontSize: 12, color: Colors.charcoal, marginTop: 6, backgroundColor: Colors.background, minHeight: 36, textAlignVertical: 'top' },

  // Check row
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  checkLabel: { fontSize: 14, fontWeight: '600', color: Colors.charcoal },

  // Signed banner
  signedBanner: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#DCFCE7', borderRadius: 6, padding: 10, marginTop: 8 },
  signedText: { fontSize: 12, color: '#166534', fontWeight: '600' },

  // Defects
  defectsHelp: { fontSize: 12, color: Colors.textMuted, fontStyle: 'italic', marginBottom: 8 },
  defectRow: { flexDirection: 'row', gap: 6, marginBottom: 8, alignItems: 'center' },
  defectInput: { flex: 1, height: 36, borderWidth: 1, borderColor: Colors.border, borderRadius: 4, paddingHorizontal: 8, fontSize: 12, color: Colors.charcoal, backgroundColor: Colors.background },
  addDefectBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 8 },
  addDefectText: { fontSize: 13, fontWeight: '600', color: Colors.steelBlue },

  // Cert
  declBanner: { backgroundColor: '#FFFBEB', borderLeftWidth: 4, borderLeftColor: Colors.safetyYellow, padding: 12, borderRadius: 4, marginTop: 12 },
  declText: { fontSize: 12, color: Colors.textSecondary, fontStyle: 'italic', lineHeight: 18 },
  stdRef: { fontSize: 10, color: Colors.textMuted, marginTop: 6 },

  // Photos
  photoUploadBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 2, borderStyle: 'dashed', borderColor: Colors.border, borderRadius: 8, padding: 14, justifyContent: 'center', marginBottom: 12 },
  photoUploadText: { fontSize: 13, color: Colors.textSecondary },
  noPhotos: { fontSize: 12, color: Colors.textMuted, fontStyle: 'italic' },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  photoThumb: { width: 120, borderWidth: 1, borderColor: Colors.border, borderRadius: 6, overflow: 'hidden' },
  photoImg: { width: 120, height: 80, backgroundColor: Colors.border },
  photoFilename: { fontSize: 9, color: Colors.textMuted, paddingHorizontal: 6, paddingTop: 4, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  photoGps: { fontSize: 9, color: Colors.steelBlue, paddingHorizontal: 6 },
  photoDelete: { fontSize: 10, color: '#DC2626', fontWeight: '600', paddingHorizontal: 6, paddingBottom: 4, paddingTop: 2 },

  // Bottom bar
  bottomBar: { flexDirection: 'row', gap: 8, padding: 16, borderTopWidth: 1, borderTopColor: Colors.border, backgroundColor: Colors.surface },
  saveDraftBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: Colors.safetyYellow, paddingVertical: 14, borderRadius: 8 },
  saveDraftText: { fontSize: 14, fontWeight: '700', color: Colors.charcoal },
  completeBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#B45309', paddingVertical: 14, borderRadius: 8 },
  completeBtnText: { fontSize: 14, fontWeight: '700', color: '#FFF' },
  signBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#166534', paddingVertical: 14, borderRadius: 8 },
  signBtnText: { fontSize: 14, fontWeight: '700', color: '#FFF' },
  revertBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, borderWidth: 1, borderColor: Colors.border, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 8 },
  revertBtnText: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
});
