import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, Image, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as WebBrowser from 'expo-web-browser';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api, apiUpload, tokenStore, API_BASE } from '../lib/api';
import { Colors } from '../lib/colors';
import { useAuth } from '../contexts/AuthContext';
import StatusBadge from './StatusBadge';
import SignatureModal from './SignatureModal';
import { useNetwork, OfflineBanner } from '../contexts/NetworkContext';

const TYPE_LABEL: Record<string, string> = {
  pre_pour: 'Pre-Pour Checklist (9.1.2)',
  post_pour: 'Post-Pour Checklist (9.1.3)',
  compliance_cert: "Manufacturer's Certificate (9.1.4)",
};

type Props = {
  formId: string;
  onFormSaved?: () => void;
};

export default function FormDetailPanel({ formId, onFormSaved }: Props) {
  const { hasPerm, user } = useAuth();
  const { isOnline, enqueue } = useNetwork();
  const [form, setForm] = useState<any>(null);
  const [schema, setSchema] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [showSignature, setShowSignature] = useState(false);
  const [sigDataUrl, setSigDataUrl] = useState<string | null>(null);

  const CACHE_KEY = `paneltec_form_${formId}`;

  /* ---- Load ---- */
  const load = useCallback(async () => {
    try {
      const [f, s, u] = await Promise.all([
        api(`/compliance-forms/${formId}`),
        api('/compliance-forms/schemas'),
        api('/users', { params: { status: 'active' } }).catch(() => ({ items: [] })),
      ]);
      setForm(f);
      setSchema(s[f.form_type]);
      setUsers(u.items || []);
      setDirty(false);
      setError('');
      AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ form: f, schema: s[f.form_type] })).catch(() => {});
    } catch (e: any) {
      if (!isOnline) {
        try {
          const cached = await AsyncStorage.getItem(CACHE_KEY);
          if (cached) {
            const { form: cf, schema: cs } = JSON.parse(cached);
            setForm(cf);
            setSchema(cs);
            setError('');
            return;
          }
        } catch {}
      }
      setError(e.message);
    }
  }, [formId, isOnline]);

  useEffect(() => { load(); }, [load]);

  /* ---- Load signature image as base64 for display ---- */
  useEffect(() => {
    if (form?.signature_url) {
      (async () => {
        try {
          const token = await tokenStore.get();
          const url = `${API_BASE}${form.signature_url.replace(/^\/api/, '')}`;
          const res = await fetch(url, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          });
          if (res.ok) {
            const blob = await res.blob();
            const reader = new FileReader();
            reader.onloadend = () => setSigDataUrl(reader.result as string);
            reader.readAsDataURL(blob);
          }
        } catch {}
      })();
    } else {
      setSigDataUrl(null);
    }
  }, [form?.signature_url]);

  /* ---- Loading / Error states ---- */
  if (error) return (
    <View style={styles.center} testID="form-detail-error">
      <Ionicons name="alert-circle-outline" size={32} color="#DC2626" />
      <Text style={styles.errorText}>{error}</Text>
      <TouchableOpacity testID="retry-btn" style={styles.retryBtn} onPress={load}>
        <Text style={styles.retryText}>Retry</Text>
      </TouchableOpacity>
    </View>
  );
  if (!form || !schema) return (
    <View style={styles.center}><ActivityIndicator color={Colors.steelBlue} /></View>
  );

  /* ---- Helpers ---- */
  const locked = form.status === 'signed';

  const update = (patch: any) => {
    setForm((p: any) => ({ ...p, ...patch }));
    setDirty(true);
  };

  const updateSection = (sKey: string, cKey: string, field: string, value: any) => {
    const sections = { ...form.sections };
    sections[sKey] = { ...sections[sKey] };
    sections[sKey][cKey] = { ...(sections[sKey][cKey] || {}), [field]: value };
    update({ sections });
  };

  const bulkRecord = (sKey: string, record: string, criteria: any[]) => {
    const sections = { ...form.sections };
    sections[sKey] = { ...sections[sKey] };
    for (const c of criteria) {
      sections[sKey][c.key] = { ...(sections[sKey][c.key] || {}), record };
    }
    update({ sections });
  };

  const buildSaveBody = () => ({
    panel_id: form.panel_id, client_name: form.client_name, project_name: form.project_name,
    grade_of_concrete: form.grade_of_concrete, date_of_inspection: form.date_of_inspection,
    date_of_casting: form.date_of_casting, sections: form.sections,
    ncr_flag: form.ncr_flag, ncr_reference: form.ncr_reference,
    checked_by_user_id: form.checked_by_user_id, checked_by_qa_user_id: form.checked_by_qa_user_id,
  });

  /* ---- Save (with offline queue) ---- */
  const save = async () => {
    setSaving(true);
    try {
      if (!isOnline) {
        await enqueue({ type: 'PATCH', endpoint: `/compliance-forms/${formId}`, body: buildSaveBody() });
        AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ form, schema })).catch(() => {});
        setDirty(false);
        Alert.alert('Saved locally', 'Changes will sync when you reconnect.');
      } else {
        await api(`/compliance-forms/${formId}`, { method: 'PATCH', body: buildSaveBody() });
        setDirty(false);
        await load();
        onFormSaved?.();
      }
    } catch (e: any) { Alert.alert('Error', e.message); }
    finally { setSaving(false); }
  };

  /* ---- Transition ---- */
  const transition = async (to: string) => {
    if (dirty) await save();
    if (!isOnline) {
      Alert.alert('Offline', 'Status transitions require an internet connection.');
      return;
    }
    try {
      await api(`/compliance-forms/${formId}/transition`, { method: 'POST', body: { to } });
      await load();
      onFormSaved?.();
    } catch (e: any) { Alert.alert('Error', e.message); }
  };

  /* ---- Signature flow ---- */
  const handleSign = () => {
    if (!isOnline) {
      Alert.alert('Offline', 'Signing requires an internet connection to upload the signature.');
      return;
    }
    setShowSignature(true);
  };

  const handleSignatureConfirm = async (base64Png: string) => {
    try {
      if (dirty) await save();
      const fd = new FormData();
      if (Platform.OS === 'web') {
        const res = await fetch(base64Png);
        const blob = await res.blob();
        fd.append('file', blob, 'signature.png');
      } else {
        fd.append('file', { uri: base64Png, name: 'signature.png', type: 'image/png' } as any);
      }
      await apiUpload(`/compliance-forms/${formId}/signature`, fd);
      try {
        await api(`/compliance-forms/${formId}/transition`, { method: 'POST', body: { to: 'signed' } });
      } catch {}
      setShowSignature(false);
      await load();
      onFormSaved?.();
    } catch (e: any) {
      Alert.alert('Signature failed', e.message);
    }
  };

  /* ---- PDF ---- */
  const openPdf = async () => {
    const token = await tokenStore.get();
    const url = `${API_BASE}/compliance-forms/${formId}/pdf?token=${token}`;
    await WebBrowser.openBrowserAsync(url);
  };

  /* ---- Photos ---- */
  const pickPhoto = async () => {
    if (!isOnline) { Alert.alert('Offline', 'Photo uploads require an internet connection.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (result.canceled) return;
    await uploadPhoto(result.assets[0]);
  };

  const takePhoto = async () => {
    if (!isOnline) { Alert.alert('Offline', 'Photo uploads require an internet connection.'); return; }
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Camera access is required to take photos.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (result.canceled) return;
    await uploadPhoto(result.assets[0]);
  };

  const uploadPhoto = async (asset: ImagePicker.ImagePickerAsset) => {
    const fd = new FormData();
    fd.append('file', { uri: asset.uri, name: asset.fileName || 'photo.jpg', type: asset.mimeType || 'image/jpeg' } as any);
    fd.append('caption', '');
    try {
      await apiUpload(`/compliance-forms/${formId}/photos`, fd);
      await load();
    } catch (e: any) { Alert.alert('Upload failed', e.message); }
  };

  /* ---- Progress ---- */
  let totalCriteria = 0, completedCriteria = 0;
  if (form.form_type !== 'compliance_cert' && schema.sections) {
    for (const sec of schema.sections) {
      for (const c of (sec.criteria || [])) {
        totalCriteria++;
        if (form.sections?.[sec.key]?.[c.key]?.record) completedCriteria++;
      }
    }
  }

  /* ---- Render ---- */
  return (
    <View style={styles.panel} testID="form-detail-panel">
      <OfflineBanner />
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

          {totalCriteria > 0 && (
            <View style={styles.progressWrap} testID="progress-bar">
              <View style={styles.progressBg}>
                <View style={[styles.progressFill, { width: `${(completedCriteria / totalCriteria) * 100}%` }]} />
              </View>
              <Text style={styles.progressText}>{completedCriteria}/{totalCriteria}</Text>
            </View>
          )}

          <View style={styles.metaGrid}>
            <MetaField label="Panel ID" value={form.panel_id} onChange={(v: string) => update({ panel_id: v })} locked={locked} testID="panel-id-input" />
            <MetaField label="Client" value={form.client_name} onChange={(v: string) => update({ client_name: v })} locked={locked} testID="client-input" />
            <MetaField label="Date of Inspection" value={form.date_of_inspection || ''} onChange={(v: string) => update({ date_of_inspection: v })} locked={locked} testID="inspection-date-input" />
            <MetaField label="Grade of Concrete" value={form.grade_of_concrete} onChange={(v: string) => update({ grade_of_concrete: v })} locked={locked} testID="grade-input" />
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
        <PhotoZone
          photos={form.photos || []}
          locked={locked}
          onPick={pickPhoto}
          onTakePhoto={takePhoto}
          formId={formId}
          onReload={load}
        />

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

          {/* Captured signature display */}
          {sigDataUrl && (
            <View style={styles.signatureDisplay} testID="signature-display">
              <Text style={styles.signatureLabel}>CAPTURED SIGNATURE</Text>
              <Image source={{ uri: sigDataUrl }} style={styles.signatureImage} resizeMode="contain" />
            </View>
          )}

          {form.signed_at && (
            <View style={styles.signedBanner} testID="signed-banner">
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
          <TouchableOpacity testID="sign-btn" style={styles.signBtn} onPress={handleSign}>
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

      {/* Signature Modal */}
      <SignatureModal
        visible={showSignature}
        onClose={() => setShowSignature(false)}
        onConfirm={handleSignatureConfirm}
        signerName={user?.name || user?.email}
      />
    </View>
  );
}

/* ========== Sub-components ========== */

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
  const criteria = section.criteria || [];
  const allRecords = criteria.map((c: any) => values[c.key]?.record).filter(Boolean);
  const bulkStatus = allRecords.length === criteria.length && new Set(allRecords).size === 1 ? allRecords[0] : null;

  return (
    <View style={styles.sectionCard} testID={`section-${section.key}`}>
      <Text style={styles.sectionTitle}>{section.label}</Text>
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
      {criteria.map((c: any) => {
        const v = values[c.key] || {};
        return (
          <View key={c.key} style={styles.criterionRow} testID={`criterion-${c.key}`}>
            <View style={styles.criterionTop}>
              <Text style={styles.criterionLabel}>{c.label}</Text>
              <View style={styles.recordBtns}>
                {[{ key: 'ok', label: '✓', active: styles.recOkActive },
                  { key: 'rectify', label: '✗', active: styles.recFailActive },
                  { key: 'na', label: 'N/A', active: styles.recNaActive }].map(r => (
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
          {!locked && <TouchableOpacity onPress={() => rm(i)} testID={`rm-defect-${i}`}><Ionicons name="trash-outline" size={18} color="#DC2626" /></TouchableOpacity>}
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

function PhotoZone({ photos, locked, onPick, onTakePhoto, formId, onReload }: any) {
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
        <View style={styles.photoActions}>
          <TouchableOpacity testID="photo-upload-btn" style={styles.photoUploadBtn} onPress={onPick}>
            <Ionicons name="images" size={20} color={Colors.steelBlue} />
            <Text style={styles.photoUploadText}>From library</Text>
          </TouchableOpacity>
          <TouchableOpacity testID="camera-capture-btn" style={styles.cameraBtn} onPress={onTakePhoto}>
            <Ionicons name="camera" size={20} color="#FFF" />
            <Text style={styles.cameraBtnText}>Take photo</Text>
          </TouchableOpacity>
        </View>
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

/* ========== Styles ========== */
const styles = StyleSheet.create({
  panel: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20, gap: 12 },
  errorText: { color: '#DC2626', fontSize: 14, textAlign: 'center' },
  retryBtn: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 6, backgroundColor: Colors.steelBlue },
  retryText: { color: '#FFF', fontSize: 14, fontWeight: '700' },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 120 },

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

  sectionCard: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: 10, padding: 16, marginBottom: 12 },
  sectionTitle: { fontSize: 11, fontWeight: '800', letterSpacing: 1.5, color: Colors.steelBlue, textTransform: 'uppercase', marginBottom: 12 },

  segmentRow: { flexDirection: 'row', gap: 0, marginBottom: 16, borderWidth: 1, borderColor: Colors.border, borderRadius: 8, overflow: 'hidden' },
  segmentBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 12, backgroundColor: Colors.background },
  segmentText: { fontSize: 12, fontWeight: '800', letterSpacing: 1, color: Colors.textSecondary },
  segPassActive: { backgroundColor: '#166534' },
  segFailActive: { backgroundColor: '#991B1B' },
  segNaActive: { backgroundColor: '#374151' },

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

  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  checkLabel: { fontSize: 14, fontWeight: '600', color: Colors.charcoal },

  signatureDisplay: { marginTop: 16, borderWidth: 1, borderColor: Colors.border, borderRadius: 8, padding: 12, backgroundColor: '#FAFAFA' },
  signatureLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1.2, color: Colors.steelBlue, textTransform: 'uppercase', marginBottom: 8 },
  signatureImage: { width: '100%', height: 120, borderRadius: 4, backgroundColor: '#FFF' },

  signedBanner: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#DCFCE7', borderRadius: 6, padding: 10, marginTop: 8 },
  signedText: { fontSize: 12, color: '#166534', fontWeight: '600' },

  defectsHelp: { fontSize: 12, color: Colors.textMuted, fontStyle: 'italic', marginBottom: 8 },
  defectRow: { flexDirection: 'row', gap: 6, marginBottom: 8, alignItems: 'center' },
  defectInput: { flex: 1, height: 36, borderWidth: 1, borderColor: Colors.border, borderRadius: 4, paddingHorizontal: 8, fontSize: 12, color: Colors.charcoal, backgroundColor: Colors.background },
  addDefectBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 8 },
  addDefectText: { fontSize: 13, fontWeight: '600', color: Colors.steelBlue },

  declBanner: { backgroundColor: '#FFFBEB', borderLeftWidth: 4, borderLeftColor: Colors.safetyYellow, padding: 12, borderRadius: 4, marginTop: 12 },
  declText: { fontSize: 12, color: Colors.textSecondary, fontStyle: 'italic', lineHeight: 18 },
  stdRef: { fontSize: 10, color: Colors.textMuted, marginTop: 6 },

  photoActions: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  photoUploadBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 2, borderStyle: 'dashed', borderColor: Colors.border, borderRadius: 8, padding: 14, justifyContent: 'center' },
  photoUploadText: { fontSize: 13, color: Colors.textSecondary },
  cameraBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Colors.steelBlue, borderRadius: 8, padding: 14, justifyContent: 'center' },
  cameraBtnText: { fontSize: 13, fontWeight: '700', color: '#FFF' },
  noPhotos: { fontSize: 12, color: Colors.textMuted, fontStyle: 'italic' },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  photoThumb: { width: 120, borderWidth: 1, borderColor: Colors.border, borderRadius: 6, overflow: 'hidden' },
  photoImg: { width: 120, height: 80, backgroundColor: Colors.border },
  photoFilename: { fontSize: 9, color: Colors.textMuted, paddingHorizontal: 6, paddingTop: 4, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  photoGps: { fontSize: 9, color: Colors.steelBlue, paddingHorizontal: 6 },
  photoDelete: { fontSize: 10, color: '#DC2626', fontWeight: '600', paddingHorizontal: 6, paddingBottom: 4, paddingTop: 2 },

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
