import { useEffect, useMemo, useState } from "react";
import { Printer, Loader2, AlertCircle, RefreshCw, Lock } from "lucide-react";
import { api, formatApiErrorDetail } from "../lib/api";
import { formatAUD, formatNumber } from "../lib/format";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";

function marginColor(pct) {
  if (pct >= 30) return { bg: "bg-green-100", text: "text-green-800", border: "border-green-300" };
  if (pct >= 15) return { bg: "bg-amber-100", text: "text-amber-800", border: "border-amber-300" };
  return { bg: "bg-red-100", text: "text-red-800", border: "border-red-300" };
}

const REINFORCEMENT_OPTIONS = [
  { value: "light", label: "Light (mesh)" },
  { value: "standard", label: "Standard (mesh + bars)" },
  { value: "heavy", label: "Heavy (rebar cage)" },
  { value: "prestressed", label: "Prestressed tendons" },
];

const DEFAULTS = {
  panel_type_key: "wall_standard",
  length_m: "6",
  height_m: "3",
  thickness_mm: "150",
  concrete_grade: "C32/40",
  quantity: "1",
  reinforcement_type: "standard",
  openings_m2: "0",
  finish_key: "smooth",
};

export default function CalculatorPage() {
  const [options, setOptions] = useState(null);
  const [pricingError, setPricingError] = useState("");
  const [form, setForm] = useState(DEFAULTS);
  const [errors, setErrors] = useState({});
  const [result, setResult] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get("/calculator/options");
        setOptions(data);
        setForm((f) => ({
          ...f,
          panel_type_key: data.panel_types[0]?.key || f.panel_type_key,
          thickness_mm: String(data.panel_types[0]?.thickness_mm || data.thickness_options_mm[0]),
          concrete_grade: data.concrete_grades[0],
          finish_key: data.finishes[0]?.key || f.finish_key,
        }));
      } catch (e) {
        setPricingError(formatApiErrorDetail(e.response?.data?.detail) || e.message);
      }
    })();
  }, []);

  const selectedPanel = useMemo(
    () => options?.panel_types.find((p) => p.key === form.panel_type_key),
    [options, form.panel_type_key],
  );

  // Auto-adjust thickness when panel changes
  useEffect(() => {
    if (selectedPanel && options?.thickness_options_mm?.includes(selectedPanel.thickness_mm)) {
      setForm((f) => ({ ...f, thickness_mm: String(selectedPanel.thickness_mm) }));
    }
  }, [selectedPanel, options]);

  const validate = () => {
    const e = {};
    const length = parseFloat(form.length_m);
    const height = parseFloat(form.height_m);
    const qty = parseInt(form.quantity, 10);
    const openings = parseFloat(form.openings_m2);
    if (!(length > 0)) e.length_m = "Length must be greater than 0";
    if (!(height > 0)) e.height_m = "Height must be greater than 0";
    if (!Number.isFinite(qty) || qty < 1) e.quantity = "Quantity must be at least 1";
    if (!Number.isFinite(openings) || openings < 0) e.openings_m2 = "Openings must be 0 or greater";
    if (Number.isFinite(length) && Number.isFinite(height) && Number.isFinite(openings)) {
      if (openings >= length * height) e.openings_m2 = "Openings must be less than length × height";
    }
    return e;
  };

  const onCalculate = async (ev) => {
    ev?.preventDefault();
    const e = validate();
    setErrors(e);
    setServerError("");
    if (Object.keys(e).length > 0) return;
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
      const { data } = await api.post("/calculator/calculate", payload);
      setResult(data);
    } catch (err) {
      setServerError(formatApiErrorDetail(err.response?.data?.detail) || err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const onReset = () => {
    if (!options) return;
    setForm({
      ...DEFAULTS,
      panel_type_key: options.panel_types[0].key,
      thickness_mm: String(options.panel_types[0].thickness_mm),
      concrete_grade: options.concrete_grades[0],
      finish_key: options.finishes[0].key,
    });
    setResult(null);
    setErrors({});
    setServerError("");
  };

  if (pricingError) {
    return (
      <div className="bg-white border border-red-200 rounded p-6 max-w-xl">
        <div className="flex items-center gap-2 text-red-700 font-semibold">
          <AlertCircle className="w-4 h-4" /> Could not load calculator options
        </div>
        <p className="text-sm text-gray-600 mt-2">{pricingError}</p>
      </div>
    );
  }
  if (!options) {
    return (
      <div className="flex items-center gap-2 text-gray-500 text-sm">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading options…
      </div>
    );
  }

  return (
    <div className="max-w-[1400px]" data-testid="calculator-page">
      <div className="mb-6 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2 no-print">
        <div>
          <div className="overline mb-1">Tools</div>
          <h1 className="text-3xl md:text-4xl font-black tracking-tighter text-[#1F2A33]">Precast Panel Calculator</h1>
          <p className="text-sm text-gray-500 mt-1">
            Compute volume, weight and AUD cost (inc. GST) for any panel run.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={onReset}
          data-testid="calc-reset-btn"
          className="border-[#1F2A33] text-[#1F2A33] hover:bg-gray-50 font-semibold"
        >
          <RefreshCw className="w-4 h-4 mr-2" /> Reset
        </Button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 print-container">
        {/* Inputs */}
        <form
          onSubmit={onCalculate}
          className="xl:col-span-7 bg-white border border-gray-200 rounded p-6 no-print"
          data-testid="calc-form"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <Field label="Panel Type" htmlFor="panel-type">
              <Select
                value={form.panel_type_key}
                onValueChange={(v) => setForm((f) => ({ ...f, panel_type_key: v }))}
              >
                <SelectTrigger id="panel-type" data-testid="calc-panel-type-select" className="h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {options.panel_types.map((p) => (
                    <SelectItem key={p.key} value={p.key} data-testid={`opt-panel-${p.key}`}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Number of Panels" htmlFor="qty" error={errors.quantity}>
              <Input
                id="qty"
                type="number"
                min={1}
                step={1}
                value={form.quantity}
                onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))}
                data-testid="calc-qty-input"
                className="h-11"
              />
            </Field>

            <Field label="Panel Length (m)" htmlFor="len" error={errors.length_m}>
              <Input
                id="len"
                type="number"
                min={0}
                step="0.01"
                value={form.length_m}
                onChange={(e) => setForm((f) => ({ ...f, length_m: e.target.value }))}
                data-testid="calc-length-input"
                className="h-11"
              />
            </Field>

            <Field label="Panel Height (m)" htmlFor="hgt" error={errors.height_m}>
              <Input
                id="hgt"
                type="number"
                min={0}
                step="0.01"
                value={form.height_m}
                onChange={(e) => setForm((f) => ({ ...f, height_m: e.target.value }))}
                data-testid="calc-height-input"
                className="h-11"
              />
            </Field>

            <Field label="Thickness (mm)" htmlFor="thk">
              <Select
                value={form.thickness_mm}
                onValueChange={(v) => setForm((f) => ({ ...f, thickness_mm: v }))}
              >
                <SelectTrigger id="thk" data-testid="calc-thickness-select" className="h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {options.thickness_options_mm.map((t) => (
                    <SelectItem key={t} value={String(t)} data-testid={`opt-thk-${t}`}>
                      {t} mm
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Concrete Grade" htmlFor="grade">
              <Select
                value={form.concrete_grade}
                onValueChange={(v) => setForm((f) => ({ ...f, concrete_grade: v }))}
              >
                <SelectTrigger id="grade" data-testid="calc-grade-select" className="h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {options.concrete_grades.map((g) => (
                    <SelectItem key={g} value={g} data-testid={`opt-grade-${g.replace("/", "-")}`}>
                      {g}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Reinforcement Type" htmlFor="rein">
              <Select
                value={form.reinforcement_type}
                onValueChange={(v) => setForm((f) => ({ ...f, reinforcement_type: v }))}
              >
                <SelectTrigger id="rein" data-testid="calc-reinforcement-select" className="h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REINFORCEMENT_OPTIONS.map((r) => (
                    <SelectItem key={r.value} value={r.value} data-testid={`opt-rein-${r.value}`}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Surface Finish" htmlFor="finish">
              <Select
                value={form.finish_key}
                onValueChange={(v) => setForm((f) => ({ ...f, finish_key: v }))}
              >
                <SelectTrigger id="finish" data-testid="calc-finish-select" className="h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {options.finishes.map((f) => (
                    <SelectItem key={f.key} value={f.key} data-testid={`opt-finish-${f.key}`}>
                      {f.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Openings Area (m² per panel)" htmlFor="open" error={errors.openings_m2}>
              <Input
                id="open"
                type="number"
                min={0}
                step="0.01"
                value={form.openings_m2}
                onChange={(e) => setForm((f) => ({ ...f, openings_m2: e.target.value }))}
                data-testid="calc-openings-input"
                className="h-11"
              />
            </Field>
          </div>

          {serverError && (
            <div data-testid="calc-server-error" className="mt-4 text-sm text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded">
              {serverError}
            </div>
          )}

          <div className="mt-6 flex flex-wrap gap-3">
            <Button
              type="submit"
              disabled={submitting}
              data-testid="calc-calculate-btn"
              className="bg-[#F5C518] text-[#1F2A33] font-bold hover:bg-[#E0B416] h-11 px-6"
            >
              {submitting ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Calculating…</>
              ) : (
                "Calculate"
              )}
            </Button>
          </div>
        </form>

        {/* Results */}
        <div className="xl:col-span-5 space-y-4">
          {!result ? (
            <div
              className="bg-white border border-dashed border-gray-300 rounded p-8 text-center text-sm text-gray-500"
              data-testid="calc-empty-results"
            >
              <div className="overline mb-2">Awaiting input</div>
              <p>Fill in the panel details and press <span className="font-bold text-[#1F2A33]">Calculate</span> to see the breakdown.</p>
            </div>
          ) : (
            <ResultsPanel result={result} />
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, htmlFor, error, children }) {
  return (
    <div>
      <Label htmlFor={htmlFor} className="text-xs uppercase tracking-wider text-[#3A6B8C] font-bold">
        {label}
      </Label>
      <div className="mt-1">{children}</div>
      {error && (
        <div className="mt-1 text-xs text-red-600" data-testid={`err-${htmlFor}`}>{error}</div>
      )}
    </div>
  );
}

function InternalCostPanel({ icb }) {
  if (!icb) return null;
  const col = marginColor(icb.margin_pct ?? 0);
  return (
    <section className="bg-white border border-[#1F2A33]/20 rounded p-6 results-card no-print"
             data-testid="calc-internal-cost-panel">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="overline text-[#1F2A33] inline-flex items-center gap-1.5">
            <Lock className="w-3.5 h-3.5"/> Internal — Cost &amp; Margin
          </div>
          <div className="text-[10px] uppercase tracking-wider text-gray-500 mt-1">Not shown to customers</div>
        </div>
      </div>
      <table className="w-full text-sm border border-gray-200 rounded overflow-hidden">
        <thead className="bg-[#1F2A33] text-[#F5C518] uppercase text-[10px] tracking-wider">
          <tr><th className="px-3 py-2 text-left">Cost item</th><th className="px-3 py-2 text-right">AUD</th></tr>
        </thead>
        <tbody className="bg-white tabular-nums">
          <Row label="Concrete" value={icb.concrete_cost_aud ?? 0} testid="cost-row-concrete" />
          <Row label="Steel" value={icb.steel_cost_aud ?? 0} testid="cost-row-steel" />
          <Row label="Mfg labour" value={icb.manufacturing_labour_aud ?? 0} testid="cost-row-mfg-labour" />
          <Row label="Finishing labour" value={icb.finishing_labour_aud ?? 0} testid="cost-row-fin-labour" />
          <Row label="Transport" value={icb.transport_cost_aud ?? 0} testid="cost-row-transport" />
          <tr className="border-t border-gray-200 font-semibold">
            <td className="px-3 py-2.5">Subtotal cost</td>
            <td className="px-3 py-2.5 text-right" data-testid="cost-row-subtotal">{formatAUD(icb.subtotal_cost_aud ?? 0)}</td>
          </tr>
          <tr><td className="px-3 py-2 text-[#3A6B8C]">Overhead ({icb.overhead_pct ?? 0}%)</td>
              <td className="px-3 py-2 text-right" data-testid="cost-row-overhead">{formatAUD(icb.overhead_aud ?? 0)}</td></tr>
          <tr className="border-t-2 border-[#1F2A33] bg-gray-50">
            <td className="px-3 py-3 font-bold uppercase text-xs tracking-wider text-[#1F2A33]">Total cost</td>
            <td className="px-3 py-3 text-right font-black tabular-nums text-[#1F2A33] text-base" data-testid="cost-row-total">
              {formatAUD(icb.total_cost_aud ?? 0)}
            </td>
          </tr>
        </tbody>
      </table>
      <div className={`mt-4 ${col.bg} ${col.border} border-2 rounded p-4 flex items-baseline justify-between`}
           data-testid="margin-pill">
        <div className={`text-[10px] font-bold uppercase tracking-[0.2em] ${col.text}`}>Margin</div>
        <div className="flex items-baseline gap-2">
          <span className={`text-2xl font-black tabular-nums ${col.text}`} data-testid="margin-aud">{formatAUD(icb.margin_aud ?? 0)}</span>
          <span className={`text-base font-bold tabular-nums ${col.text}`} data-testid="margin-pct">
            ({(icb.margin_pct ?? 0).toFixed(1)}%)
          </span>
        </div>
      </div>
    </section>
  );
}

function ResultsPanel({ result }) {
  const { per_panel, totals, cost_breakdown, inputs, panel_type, finish, internal_cost_breakdown } = result;
  return (
    <div className="space-y-4">
      <div className="bg-white border border-gray-200 rounded p-6 results-card" data-testid="results-card">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="overline">Results · per panel</div>
            <div className="text-sm font-semibold text-[#1F2A33] mt-1">
              {panel_type.label} · {inputs.thickness_mm}mm · {finish.label}
            </div>
          </div>
          <button
            onClick={() => window.print()}
            data-testid="calc-print-btn"
            className="no-print inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[#3A6B8C] hover:text-[#1F2A33]"
          >
            <Printer className="w-3.5 h-3.5" /> Export / Print
          </button>
        </div>

        <dl className="grid grid-cols-2 gap-3 text-sm">
          <Stat label="Face area" value={`${formatNumber(per_panel.face_area_m2)} m²`} testid="stat-face-area" />
          <Stat label="Net area" value={`${formatNumber(per_panel.net_area_m2)} m²`} testid="stat-net-area" />
          <Stat label="Volume" value={`${formatNumber(per_panel.volume_m3, 3)} m³`} testid="stat-volume" />
          <Stat label="Concrete weight" value={`${formatNumber(per_panel.concrete_weight_kg)} kg`} testid="stat-concrete-weight" />
          <Stat label="Steel weight" value={`${formatNumber(per_panel.steel_weight_kg)} kg`} testid="stat-steel-weight" />
          <Stat label="Total weight" value={`${formatNumber(per_panel.total_weight_kg)} kg`} testid="stat-total-weight" />
        </dl>
      </div>

      <div className="bg-white border border-gray-200 rounded p-6 results-card">
        <div className="overline mb-3">Project totals · {totals.quantity} panel(s)</div>
        <dl className="grid grid-cols-2 gap-3 text-sm mb-5">
          <Stat label="Total volume" value={`${formatNumber(totals.total_volume_m3, 3)} m³`} testid="tot-volume" />
          <Stat label="Total weight" value={`${formatNumber(totals.total_weight_tonnes, 3)} t`} testid="tot-weight" />
          <Stat label="Base cost / m²" value={formatAUD(totals.base_cost_per_m2)} testid="tot-base-cost" />
          <Stat label="Finish ×" value={`${totals.finish_multiplier.toFixed(2)}`} testid="tot-finish-mult" />
        </dl>

        <table className="w-full text-sm border border-gray-200 rounded overflow-hidden">
          <thead className="bg-[#3A6B8C] text-white uppercase text-[10px] tracking-wider">
            <tr>
              <th className="px-3 py-2 text-left">Item</th>
              <th className="px-3 py-2 text-right">AUD</th>
            </tr>
          </thead>
          <tbody className="bg-white tabular-nums">
            <Row label="Material" value={cost_breakdown.material} testid="row-material" />
            <Row label="Manufacturing" value={cost_breakdown.manufacturing} testid="row-manufacturing" />
            <Row label="Transport + Install" value={cost_breakdown.transport_install} testid="row-transport-install" />
            <Row label={`Finish premium (${finish.label})`} value={cost_breakdown.finish_premium} testid="row-finish-premium" />
            <tr className="border-t border-gray-200 font-semibold">
              <td className="px-3 py-2.5">Subtotal</td>
              <td className="px-3 py-2.5 text-right" data-testid="row-subtotal">{formatAUD(cost_breakdown.subtotal)}</td>
            </tr>
            <tr>
              <td className="px-3 py-2 text-[#3A6B8C]">GST ({cost_breakdown.gst_rate_pct}%)</td>
              <td className="px-3 py-2 text-right" data-testid="row-gst">{formatAUD(cost_breakdown.gst)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="bg-[#F5C518] border border-[#1F2A33]/10 rounded p-6 results-card">
        <div className="text-xs font-bold uppercase tracking-[0.2em] text-[#1F2A33]/70">Total inc. GST</div>
        <div
          className="mt-2 text-4xl md:text-5xl font-black tracking-tighter text-[#1F2A33] tabular-nums"
          data-testid="calc-total-aud"
        >
          {formatAUD(cost_breakdown.total_inc_gst)}
        </div>
        <div className="mt-1 text-xs text-[#1F2A33]/70">AUD · {totals.quantity} panel(s) · GST 10% included</div>
      </div>

      <InternalCostPanel icb={internal_cost_breakdown} />

      <div className="print-only">
        <h2 className="text-lg font-bold mt-4">Paneltec Group — Calculator Export</h2>
        <p className="text-xs text-gray-600">
          {panel_type.label} · {inputs.length_m} × {inputs.height_m} m · {inputs.thickness_mm}mm ·
          Grade {inputs.concrete_grade} · {finish.label} · Qty {totals.quantity}
        </p>
      </div>
    </div>
  );
}

function Stat({ label, value, testid }) {
  return (
    <div className="border-b border-gray-100 pb-2 last:border-b-0">
      <dt className="text-[10px] uppercase tracking-wider text-gray-500 font-bold">{label}</dt>
      <dd className="text-base font-semibold text-[#1F2A33] tabular-nums mt-0.5" data-testid={testid}>{value}</dd>
    </div>
  );
}

function Row({ label, value, testid }) {
  return (
    <tr>
      <td className="px-3 py-2 text-gray-600">{label}</td>
      <td className="px-3 py-2 text-right text-[#1F2A33]" data-testid={testid}>{formatAUD(value)}</td>
    </tr>
  );
}
