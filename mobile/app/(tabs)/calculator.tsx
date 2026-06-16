import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, KeyboardAvoidingView, Platform, Keyboard,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../src/lib/api';
import { formatAUD, formatNumber } from '../../src/lib/format';
import { Colors } from '../../src/lib/colors';
import ErrorBanner from '../../src/components/ErrorBanner';

const REINFORCEMENT_OPTIONS = [
  { value: 'light', label: 'Light (mesh)' },
  { value: 'standard', label: 'Standard (mesh + bars)' },
  { value: 'heavy', label: 'Heavy (rebar cage)' },
  { value: 'prestressed', label: 'Prestressed tendons' },
];

export default function CalculatorScreen() {
  const [options, setOptions] = useState<any>(null);
  const [form, setForm] = useState({
    panel_type_key: 'wall_standard',
    length_m: '6',
    height_m: '3',
    thickness_mm: '150',
    concrete_grade: 'C32/40',
    quantity: '1',
    reinforcement_type: 'standard',
    openings_m2: '0',
    finish_key: 'smooth',
  });
  const [result, setResult] = useState<any>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const data = await api('/calculator/options');
        setOptions(data);
        setForm((f) => ({
          ...f,
          panel_type_key: data.panel_types[0]?.key || f.panel_type_key,
          thickness_mm: String(data.panel_types[0]?.thickness_mm || data.thickness_options_mm[0]),
          concrete_grade: data.concrete_grades[0],
          finish_key: data.finishes[0]?.key || f.finish_key,
        }));
      } catch (e: any) {
        setLoadError(e.message);
      }
    })();
  }, []);

  const onCalculate = async () => {
    Keyboard.dismiss();
    setError('');
    setSubmitting(true);
    try {
      const payload = {
        panel_type_key: form.panel_type_key,
        length_m: parseFloat(form.length_m),
        height_m: parseFloat(form.height_m),
        thickness_mm: parseInt(form.thickness_mm, 10),
        concrete_grade: form.concrete_grade,
        quantity: parseInt(form.quantity, 10),
        reinforcement_type: form.reinforcement_type,
        openings_m2: parseFloat(form.openings_m2),
        finish_key: form.finish_key,
      };
      const data = await api('/calculator/calculate', { method: 'POST', body: payload });
      setResult(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loadError) {
    return (
      <View style={styles.center}>
        <ErrorBanner message={`Could not load options: ${loadError}`} />
      </View>
    );
  }

  if (!options) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={Colors.steelBlue} />
        <Text style={styles.loadText}>Loading options...</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.flex}
    >
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        testID="calculator-page"
      >
        {/* Panel Type Picker */}
        <Text style={styles.fieldLabel}>PANEL TYPE</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
          {options.panel_types.map((p: any) => (
            <TouchableOpacity
              key={p.key}
              style={[styles.chip, form.panel_type_key === p.key && styles.chipActive]}
              onPress={() => {
                setForm((f) => ({ ...f, panel_type_key: p.key, thickness_mm: String(p.thickness_mm) }));
              }}
              testID={`calc-panel-type-${p.key}`}
            >
              <Text style={[styles.chipText, form.panel_type_key === p.key && styles.chipTextActive]}>
                {p.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Number inputs */}
        <View style={styles.row}>
          <View style={styles.halfField}>
            <Text style={styles.fieldLabel}>LENGTH (m)</Text>
            <TextInput
              testID="calc-length-input"
              style={styles.input}
              keyboardType="decimal-pad"
              value={form.length_m}
              onChangeText={(v) => setForm((f) => ({ ...f, length_m: v }))}
            />
          </View>
          <View style={styles.halfField}>
            <Text style={styles.fieldLabel}>HEIGHT (m)</Text>
            <TextInput
              testID="calc-height-input"
              style={styles.input}
              keyboardType="decimal-pad"
              value={form.height_m}
              onChangeText={(v) => setForm((f) => ({ ...f, height_m: v }))}
            />
          </View>
        </View>

        <View style={styles.row}>
          <View style={styles.halfField}>
            <Text style={styles.fieldLabel}>QUANTITY</Text>
            <TextInput
              testID="calc-qty-input"
              style={styles.input}
              keyboardType="number-pad"
              value={form.quantity}
              onChangeText={(v) => setForm((f) => ({ ...f, quantity: v }))}
            />
          </View>
          <View style={styles.halfField}>
            <Text style={styles.fieldLabel}>OPENINGS (m{'\u00B2'})</Text>
            <TextInput
              testID="calc-openings-input"
              style={styles.input}
              keyboardType="decimal-pad"
              value={form.openings_m2}
              onChangeText={(v) => setForm((f) => ({ ...f, openings_m2: v }))}
            />
          </View>
        </View>

        {/* Thickness Chips */}
        <Text style={styles.fieldLabel}>THICKNESS (mm)</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
          {options.thickness_options_mm.map((t: number) => (
            <TouchableOpacity
              key={t}
              style={[styles.chip, form.thickness_mm === String(t) && styles.chipActive]}
              onPress={() => setForm((f) => ({ ...f, thickness_mm: String(t) }))}
              testID={`calc-thickness-${t}`}
            >
              <Text style={[styles.chipText, form.thickness_mm === String(t) && styles.chipTextActive]}>
                {t}mm
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Concrete Grade Chips */}
        <Text style={styles.fieldLabel}>CONCRETE GRADE</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
          {options.concrete_grades.map((g: string) => (
            <TouchableOpacity
              key={g}
              style={[styles.chip, form.concrete_grade === g && styles.chipActive]}
              onPress={() => setForm((f) => ({ ...f, concrete_grade: g }))}
              testID={`calc-grade-${g}`}
            >
              <Text style={[styles.chipText, form.concrete_grade === g && styles.chipTextActive]}>{g}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Reinforcement Chips */}
        <Text style={styles.fieldLabel}>REINFORCEMENT</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
          {REINFORCEMENT_OPTIONS.map((r) => (
            <TouchableOpacity
              key={r.value}
              style={[styles.chip, form.reinforcement_type === r.value && styles.chipActive]}
              onPress={() => setForm((f) => ({ ...f, reinforcement_type: r.value }))}
              testID={`calc-rein-${r.value}`}
            >
              <Text style={[styles.chipText, form.reinforcement_type === r.value && styles.chipTextActive]}>
                {r.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Finish Chips */}
        <Text style={styles.fieldLabel}>SURFACE FINISH</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
          {options.finishes.map((f: any) => (
            <TouchableOpacity
              key={f.key}
              style={[styles.chip, form.finish_key === f.key && styles.chipActive]}
              onPress={() => setForm((prev) => ({ ...prev, finish_key: f.key }))}
              testID={`calc-finish-${f.key}`}
            >
              <Text style={[styles.chipText, form.finish_key === f.key && styles.chipTextActive]}>
                {f.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {error ? <ErrorBanner message={error} testID="calc-server-error" /> : null}

        {/* Calculate Button */}
        <TouchableOpacity
          testID="calc-calculate-btn"
          style={[styles.calcBtn, submitting && styles.btnDisabled]}
          onPress={onCalculate}
          disabled={submitting}
          activeOpacity={0.8}
        >
          {submitting ? (
            <ActivityIndicator color={Colors.charcoal} />
          ) : (
            <Text style={styles.calcBtnText}>Calculate</Text>
          )}
        </TouchableOpacity>

        {/* Results */}
        {result && <ResultsPanel result={result} />}
        {result?.internal_cost_breakdown && (
          <InternalCostPanel icb={result.internal_cost_breakdown} />
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function ResultsPanel({ result }: { result: any }) {
  const { per_panel, totals, cost_breakdown, panel_type, finish, inputs } = result;
  return (
    <View style={styles.resultsContainer}>
      {/* Per Panel Stats */}
      <View style={styles.resultCard} testID="results-card">
        <Text style={styles.resultOverline}>
          RESULTS {'\u00B7'} PER PANEL
        </Text>
        <Text style={styles.resultSubtitle}>
          {panel_type.label} {'\u00B7'} {inputs.thickness_mm}mm {'\u00B7'} {finish.label}
        </Text>
        <View style={styles.statGrid}>
          <StatItem label="Face area" value={`${formatNumber(per_panel.face_area_m2)} m\u00B2`} testID="stat-face-area" />
          <StatItem label="Net area" value={`${formatNumber(per_panel.net_area_m2)} m\u00B2`} testID="stat-net-area" />
          <StatItem label="Volume" value={`${formatNumber(per_panel.volume_m3, 3)} m\u00B3`} testID="stat-volume" />
          <StatItem label="Weight" value={`${formatNumber(per_panel.total_weight_kg)} kg`} testID="stat-total-weight" />
        </View>
      </View>

      {/* Cost Breakdown */}
      <View style={styles.resultCard}>
        <Text style={styles.resultOverline}>
          PROJECT TOTALS {'\u00B7'} {totals.quantity} PANEL(S)
        </Text>
        <CostRow label="Material" value={cost_breakdown.material} testID="row-material" />
        <CostRow label="Manufacturing" value={cost_breakdown.manufacturing} testID="row-manufacturing" />
        <CostRow label="Transport + Install" value={cost_breakdown.transport_install} testID="row-transport-install" />
        <CostRow label={`Finish (${finish.label})`} value={cost_breakdown.finish_premium} testID="row-finish-premium" />
        <View style={styles.costSeparator} />
        <CostRow label="Subtotal" value={cost_breakdown.subtotal} testID="row-subtotal" bold />
        <CostRow label={`GST (${cost_breakdown.gst_rate_pct}%)`} value={cost_breakdown.gst} testID="row-gst" />
      </View>

      {/* Big Total */}
      <View style={styles.totalCard} testID="calc-total-card">
        <Text style={styles.totalLabel}>TOTAL INC. GST</Text>
        <Text style={styles.totalValue} testID="calc-total-aud">
          {formatAUD(cost_breakdown.total_inc_gst)}
        </Text>
        <Text style={styles.totalNote}>
          AUD {'\u00B7'} {totals.quantity} panel(s) {'\u00B7'} GST 10% included
        </Text>
      </View>
    </View>
  );
}

function StatItem({ label, value, testID }: { label: string; value: string; testID: string }) {
  return (
    <View style={styles.statItem}>
      <Text style={styles.statItemLabel}>{label}</Text>
      <Text style={styles.statItemValue} testID={testID}>{value}</Text>
    </View>
  );
}

function CostRow({ label, value, testID, bold }: { label: string; value: number; testID: string; bold?: boolean }) {
  return (
    <View style={styles.costRow}>
      <Text style={[styles.costLabel, bold && styles.costBold]}>{label}</Text>
      <Text style={[styles.costValue, bold && styles.costBold]} testID={testID}>{formatAUD(value)}</Text>
    </View>
  );
}

function InternalCostPanel({ icb }: { icb: any }) {
  const marginPct = icb.margin_pct ?? 0;
  const marginColor = marginPct >= 30 ? '#166534' : marginPct >= 15 ? '#92400E' : '#991B1B';
  const marginBg = marginPct >= 30 ? '#DCFCE7' : marginPct >= 15 ? '#FEF3C7' : '#FEE2E2';

  return (
    <View style={styles.icbCard} testID="calc-internal-cost-panel">
      <View style={styles.icbHeader}>
        <Ionicons name="lock-closed" size={14} color={Colors.charcoal} />
        <Text style={styles.icbTitle}>Internal — Cost & Margin</Text>
      </View>
      <Text style={styles.icbSubtitle}>Not shown to customers</Text>

      <ICBRow label="Concrete" value={icb.concrete_cost_aud ?? 0} testID="cost-row-concrete" />
      <ICBRow label="Steel" value={icb.steel_cost_aud ?? 0} testID="cost-row-steel" />
      <ICBRow label="Mfg labour" value={icb.manufacturing_labour_aud ?? 0} testID="cost-row-mfg-labour" />
      <ICBRow label="Finishing labour" value={icb.finishing_labour_aud ?? 0} testID="cost-row-fin-labour" />
      <ICBRow label="Transport" value={icb.transport_cost_aud ?? 0} testID="cost-row-transport" />
      <View style={styles.costSeparator} />
      <ICBRow label="Subtotal cost" value={icb.subtotal_cost_aud ?? 0} testID="cost-row-subtotal" bold />
      <ICBRow label={`Overhead (${icb.overhead_pct ?? 0}%)`} value={icb.overhead_aud ?? 0} testID="cost-row-overhead" />
      <View style={[styles.costSeparator, { height: 2, backgroundColor: Colors.charcoal }]} />
      <ICBRow label="Total cost" value={icb.total_cost_aud ?? 0} testID="cost-row-total" bold />

      <View style={[styles.marginPill, { backgroundColor: marginBg }]} testID="margin-pill">
        <Text style={[styles.marginLabel, { color: marginColor }]}>MARGIN</Text>
        <View style={styles.marginValues}>
          <Text style={[styles.marginAud, { color: marginColor }]} testID="margin-aud">
            {formatAUD(icb.margin_aud ?? 0)}
          </Text>
          <Text style={[styles.marginPct, { color: marginColor }]} testID="margin-pct">
            ({(icb.margin_pct ?? 0).toFixed(1)}%)
          </Text>
        </View>
      </View>
    </View>
  );
}

function ICBRow({ label, value, testID, bold }: { label: string; value: number; testID: string; bold?: boolean }) {
  return (
    <View style={styles.costRow}>
      <Text style={[styles.costLabel, bold && styles.costBold]}>{label}</Text>
      <Text style={[styles.costValue, bold && styles.costBold]} testID={testID}>{formatAUD(value)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screen: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16, paddingBottom: 60 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, backgroundColor: Colors.background },
  loadText: { marginTop: 12, color: Colors.textMuted, fontSize: 14 },
  fieldLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.5,
    color: Colors.steelBlue,
    marginTop: 16,
    marginBottom: 8,
  },
  chipScroll: { marginBottom: 4 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 6,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    marginRight: 8,
    minHeight: 44,
    justifyContent: 'center',
  },
  chipActive: { backgroundColor: Colors.charcoal, borderColor: Colors.charcoal },
  chipText: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  chipTextActive: { color: Colors.safetyYellow },
  row: { flexDirection: 'row', gap: 12 },
  halfField: { flex: 1 },
  input: {
    height: 48,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 6,
    paddingHorizontal: 14,
    fontSize: 16,
    color: Colors.charcoal,
    backgroundColor: Colors.surface,
  },
  calcBtn: {
    marginTop: 20,
    height: 52,
    backgroundColor: Colors.safetyYellow,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnDisabled: { opacity: 0.6 },
  calcBtnText: { fontSize: 16, fontWeight: '800', color: Colors.charcoal },
  resultsContainer: { marginTop: 24 },
  resultCard: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    padding: 16,
    marginBottom: 12,
  },
  resultOverline: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.5,
    color: Colors.steelBlue,
    marginBottom: 4,
  },
  resultSubtitle: { fontSize: 13, fontWeight: '600', color: Colors.charcoal, marginBottom: 12 },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statItem: {
    width: '47%',
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
    paddingBottom: 8,
    marginBottom: 4,
  },
  statItemLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 0.8, color: Colors.textMuted, textTransform: 'uppercase' },
  statItemValue: { fontSize: 15, fontWeight: '700', color: Colors.charcoal, marginTop: 2, fontVariant: ['tabular-nums'] },
  costRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8 },
  costLabel: { fontSize: 13, color: Colors.textSecondary },
  costValue: { fontSize: 13, color: Colors.charcoal, fontVariant: ['tabular-nums'] },
  costBold: { fontWeight: '700', color: Colors.charcoal },
  costSeparator: { height: 1, backgroundColor: Colors.border, marginVertical: 4 },
  totalCard: {
    backgroundColor: Colors.safetyYellow,
    borderRadius: 8,
    padding: 20,
    marginBottom: 12,
  },
  totalLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 2,
    color: 'rgba(31,42,51,0.6)',
  },
  totalValue: {
    fontSize: 36,
    fontWeight: '900',
    color: Colors.charcoal,
    marginTop: 8,
    fontVariant: ['tabular-nums'],
    letterSpacing: -1,
  },
  totalNote: { fontSize: 11, color: 'rgba(31,42,51,0.6)', marginTop: 4 },
  icbCard: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    padding: 16,
    marginTop: 12,
    marginBottom: 12,
  },
  icbHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  icbTitle: { fontSize: 10, fontWeight: '700', letterSpacing: 1.5, color: Colors.charcoal, textTransform: 'uppercase' },
  icbSubtitle: { fontSize: 10, color: Colors.textMuted, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 12 },
  marginPill: {
    marginTop: 16,
    borderRadius: 8,
    padding: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  marginLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 2 },
  marginValues: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  marginAud: { fontSize: 22, fontWeight: '900', fontVariant: ['tabular-nums'] as any },
  marginPct: { fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] as any },
});
