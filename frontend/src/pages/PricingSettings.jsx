import { useEffect, useState } from "react";
import { Loader2, Save, Plus, Trash2, Lock } from "lucide-react";
import { api, formatApiErrorDetail } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../components/ui/tabs";
import { toast, Toaster } from "sonner";

export default function PricingSettings() {
  const [data, setData] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    try {
      const { data } = await api.get("/settings/pricing");
      setData(data);
    } catch (e) {
      setError(formatApiErrorDetail(e.response?.data?.detail) || e.message);
    }
  };
  useEffect(() => { load(); }, []);

  if (error && !data) {
    return <div className="text-sm text-red-700">{error}</div>;
  }
  if (!data) {
    return (
      <div className="flex items-center gap-2 text-gray-500 text-sm">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading…
      </div>
    );
  }

  const update = (path, value) => {
    setData((prev) => {
      const next = structuredClone(prev);
      const keys = path.split(".");
      let cur = next;
      for (let i = 0; i < keys.length - 1; i++) {
        const k = keys[i];
        cur = isNaN(parseInt(k, 10)) ? cur[k] : cur[parseInt(k, 10)];
      }
      cur[keys[keys.length - 1]] = value;
      return next;
    });
  };

  const onSave = async () => {
    setSaving(true);
    try {
      const payload = {
        concrete_density: Number(data.concrete_density),
        gst_rate: Number(data.gst_rate),
        reinforcement_densities: {
          light: Number(data.reinforcement_densities.light),
          standard: Number(data.reinforcement_densities.standard),
          heavy: Number(data.reinforcement_densities.heavy),
          prestressed: Number(data.reinforcement_densities.prestressed),
        },
        panel_types: data.panel_types.map((p) => ({
          ...p,
          thickness_mm: parseInt(p.thickness_mm, 10),
          material_per_m2: Number(p.material_per_m2),
          manufacturing_per_m2: Number(p.manufacturing_per_m2),
          transport_install_per_m2: Number(p.transport_install_per_m2),
          manufacturing_labour_per_m2: Number(p.manufacturing_labour_per_m2 ?? 0),
        })),
        thickness_options_mm: data.thickness_options_mm.map((t) => parseInt(t, 10)).filter((n) => n > 0),
        concrete_grades: data.concrete_grades.map((g) => String(g).trim()).filter(Boolean),
        finishes: data.finishes.map((f) => ({
          ...f,
          multiplier: Number(f.multiplier),
          finishing_labour_per_m2: Number(f.finishing_labour_per_m2 ?? 0),
        })),
        concrete_cost_per_m3: Number(data.concrete_cost_per_m3 ?? 0),
        steel_cost_per_kg: Number(data.steel_cost_per_kg ?? 0),
        transport_cost_per_m2: Number(data.transport_cost_per_m2 ?? 0),
        overhead_pct: Number(data.overhead_pct ?? 0),
      };
      const { data: saved } = await api.put("/settings/pricing", payload);
      setData(saved);
      toast.success("Pricing saved");
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message);
    } finally {
      setSaving(false);
    }
  };

  const addThickness = () => update("thickness_options_mm", [...data.thickness_options_mm, 100]);
  const rmThickness = (i) => update("thickness_options_mm", data.thickness_options_mm.filter((_, idx) => idx !== i));
  const addGrade = () => update("concrete_grades", [...data.concrete_grades, "Cnn/nn"]);
  const rmGrade = (i) => update("concrete_grades", data.concrete_grades.filter((_, idx) => idx !== i));

  return (
    <div className="max-w-6xl space-y-6" data-testid="pricing-settings-page">
      <Toaster richColors position="top-right" />
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <div className="overline">Admin</div>
          <h1 className="text-3xl md:text-4xl font-black tracking-tighter text-[#1F2A33]">Pricing Settings</h1>
          <p className="text-sm text-gray-500 mt-1">All values editable. Saved values flow into the calculator immediately.</p>
        </div>
        <Button
          onClick={onSave}
          disabled={saving}
          data-testid="pricing-save-btn"
          className="bg-[#F5C518] text-[#1F2A33] font-bold hover:bg-[#E0B416] h-11 px-6"
        >
          {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </div>

      {/* Global */}
      <Tabs defaultValue="sell" className="space-y-6">
        <TabsList data-testid="pricing-tabs">
          <TabsTrigger value="sell" data-testid="tab-sell">Sell Prices</TabsTrigger>
          <TabsTrigger value="cost" data-testid="tab-cost">Cost Inputs (internal)</TabsTrigger>
        </TabsList>

        <TabsContent value="sell" className="space-y-6">
      <Card title="Global">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <NumberField label="Concrete density (kg/m³)" value={data.concrete_density}
            onChange={(v) => update("concrete_density", v)} testid="setting-concrete-density" />
          <NumberField label="GST rate (%)" value={data.gst_rate}
            onChange={(v) => update("gst_rate", v)} testid="setting-gst-rate" />
        </div>
      </Card>

      {/* Reinforcement */}
      <Card title="Reinforcement densities (kg/m³)">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <NumberField label="Light (mesh)" value={data.reinforcement_densities.light}
            onChange={(v) => update("reinforcement_densities.light", v)} testid="setting-rein-light" />
          <NumberField label="Standard (mesh + bars)" value={data.reinforcement_densities.standard}
            onChange={(v) => update("reinforcement_densities.standard", v)} testid="setting-rein-standard" />
          <NumberField label="Heavy (rebar cage)" value={data.reinforcement_densities.heavy}
            onChange={(v) => update("reinforcement_densities.heavy", v)} testid="setting-rein-heavy" />
          <NumberField label="Prestressed tendons" value={data.reinforcement_densities.prestressed}
            onChange={(v) => update("reinforcement_densities.prestressed", v)} testid="setting-rein-prestressed" />
        </div>
      </Card>

      {/* Panel types */}
      <Card title="Panel types · AUD per m²">
        <div className="overflow-x-auto">
          <table className="w-full text-sm border border-gray-200 rounded overflow-hidden">
            <thead className="bg-[#3A6B8C] text-white uppercase text-[10px] tracking-wider">
              <tr>
                <th className="px-3 py-2 text-left">Panel Type</th>
                <th className="px-3 py-2 text-right">Material $/m²</th>
                <th className="px-3 py-2 text-right">Manufacturing $/m²</th>
                <th className="px-3 py-2 text-right">Transport + Install $/m²</th>
              </tr>
            </thead>
            <tbody>
              {data.panel_types.map((p, i) => (
                <tr key={p.key} className="border-t border-gray-200">
                  <td className="px-3 py-2 text-[#1F2A33] font-medium">{p.label}</td>
                  <td className="px-3 py-1">
                    <Input
                      type="number" step="0.01"
                      value={p.material_per_m2}
                      onChange={(e) => update(`panel_types.${i}.material_per_m2`, e.target.value)}
                      data-testid={`setting-panel-${p.key}-material`}
                      className="h-9 text-right tabular-nums"
                    />
                  </td>
                  <td className="px-3 py-1">
                    <Input
                      type="number" step="0.01"
                      value={p.manufacturing_per_m2}
                      onChange={(e) => update(`panel_types.${i}.manufacturing_per_m2`, e.target.value)}
                      data-testid={`setting-panel-${p.key}-manufacturing`}
                      className="h-9 text-right tabular-nums"
                    />
                  </td>
                  <td className="px-3 py-1">
                    <Input
                      type="number" step="0.01"
                      value={p.transport_install_per_m2}
                      onChange={(e) => update(`panel_types.${i}.transport_install_per_m2`, e.target.value)}
                      data-testid={`setting-panel-${p.key}-transport-install`}
                      className="h-9 text-right tabular-nums"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Thickness options */}
      <Card title="Thickness options (mm)" action={
        <Button variant="outline" size="sm" onClick={addThickness} data-testid="add-thickness-btn">
          <Plus className="w-3.5 h-3.5 mr-1" /> Add
        </Button>
      }>
        <div className="flex flex-wrap gap-2">
          {data.thickness_options_mm.map((t, i) => (
            <div key={i} className="flex items-center gap-1 border border-gray-300 rounded pl-2">
              <Input
                type="number"
                value={t}
                onChange={(e) => update(`thickness_options_mm.${i}`, e.target.value)}
                className="h-9 w-20 border-0 focus-visible:ring-0 tabular-nums"
                data-testid={`thickness-${i}`}
              />
              <button onClick={() => rmThickness(i)} className="p-2 text-gray-400 hover:text-red-600" aria-label="Remove">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      </Card>

      {/* Concrete grades */}
      <Card title="Concrete grades" action={
        <Button variant="outline" size="sm" onClick={addGrade} data-testid="add-grade-btn">
          <Plus className="w-3.5 h-3.5 mr-1" /> Add
        </Button>
      }>
        <div className="flex flex-wrap gap-2">
          {data.concrete_grades.map((g, i) => (
            <div key={i} className="flex items-center gap-1 border border-gray-300 rounded pl-2">
              <Input
                value={g}
                onChange={(e) => update(`concrete_grades.${i}`, e.target.value)}
                className="h-9 w-28 border-0 focus-visible:ring-0"
                data-testid={`grade-${i}`}
              />
              <button onClick={() => rmGrade(i)} className="p-2 text-gray-400 hover:text-red-600" aria-label="Remove">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      </Card>

      {/* Finishes */}
      <Card title="Surface finish multipliers">
        <div className="overflow-x-auto">
          <table className="w-full text-sm border border-gray-200 rounded overflow-hidden">
            <thead className="bg-[#3A6B8C] text-white uppercase text-[10px] tracking-wider">
              <tr>
                <th className="px-3 py-2 text-left">Finish</th>
                <th className="px-3 py-2 text-right">Multiplier</th>
              </tr>
            </thead>
            <tbody>
              {data.finishes.map((f, i) => (
                <tr key={f.key} className="border-t border-gray-200">
                  <td className="px-3 py-2 text-[#1F2A33] font-medium">{f.label}</td>
                  <td className="px-3 py-1">
                    <Input
                      type="number" step="0.01"
                      value={f.multiplier}
                      onChange={(e) => update(`finishes.${i}.multiplier`, e.target.value)}
                      data-testid={`setting-finish-${f.key}`}
                      className="h-9 text-right tabular-nums w-32 ml-auto"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
        </TabsContent>

        <TabsContent value="cost" className="space-y-6">
          <div className="bg-[#F5C518]/20 border border-[#F5C518] rounded p-4 text-sm text-[#1F2A33]" data-testid="cost-banner">
            <Lock className="inline w-4 h-4 mr-1.5 mb-0.5"/>
            <span className="font-bold">These values are INTERNAL ONLY.</span> Used to calculate margin per quote. Never shown to customers on quotes or invoices. Adjust to match your actual costs.
          </div>
          <Card title="Material costs">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <NumberField label="Concrete cost ($/m³)" value={data.concrete_cost_per_m3 ?? 180}
                onChange={(v) => update("concrete_cost_per_m3", v)} testid="cost-concrete-per-m3" />
              <NumberField label="Steel cost ($/kg)" value={data.steel_cost_per_kg ?? 1.5}
                onChange={(v) => update("steel_cost_per_kg", v)} testid="cost-steel-per-kg" />
              <NumberField label="Transport cost ($/m²)" value={data.transport_cost_per_m2 ?? 25}
                onChange={(v) => update("transport_cost_per_m2", v)} testid="cost-transport-per-m2" />
              <NumberField label="Overhead (%)" value={data.overhead_pct ?? 12}
                onChange={(v) => update("overhead_pct", v)} testid="cost-overhead-pct" />
            </div>
          </Card>
          <Card title="Manufacturing labour per panel type · AUD per m²">
            <table className="w-full text-sm border border-gray-200 rounded overflow-hidden">
              <thead className="bg-[#3A6B8C] text-white uppercase text-[10px] tracking-wider">
                <tr><th className="px-3 py-2 text-left">Panel Type</th><th className="px-3 py-2 text-right">Labour $/m²</th></tr>
              </thead>
              <tbody>
                {(data.panel_types ?? []).map((p, i) => (
                  <tr key={p.key} className="border-t border-gray-200">
                    <td className="px-3 py-2 text-[#1F2A33] font-medium">{p.label}</td>
                    <td className="px-3 py-1">
                      <Input type="number" step="0.01"
                        value={p.manufacturing_labour_per_m2 ?? 0}
                        onChange={(e) => update(`panel_types.${i}.manufacturing_labour_per_m2`, e.target.value)}
                        data-testid={`cost-mfg-labour-${p.key}`}
                        className="h-9 text-right tabular-nums w-32 ml-auto"/>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <Card title="Finishing labour per finish · AUD per m²">
            <table className="w-full text-sm border border-gray-200 rounded overflow-hidden">
              <thead className="bg-[#3A6B8C] text-white uppercase text-[10px] tracking-wider">
                <tr><th className="px-3 py-2 text-left">Finish</th><th className="px-3 py-2 text-right">Labour $/m²</th></tr>
              </thead>
              <tbody>
                {(data.finishes ?? []).map((f, i) => (
                  <tr key={f.key} className="border-t border-gray-200">
                    <td className="px-3 py-2 text-[#1F2A33] font-medium">{f.label}</td>
                    <td className="px-3 py-1">
                      <Input type="number" step="0.01"
                        value={f.finishing_labour_per_m2 ?? 0}
                        onChange={(e) => update(`finishes.${i}.finishing_labour_per_m2`, e.target.value)}
                        data-testid={`cost-fin-labour-${f.key}`}
                        className="h-9 text-right tabular-nums w-32 ml-auto"/>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Card({ title, action, children }) {
  return (
    <section className="bg-white border border-gray-200 rounded p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-bold uppercase tracking-[0.15em] text-[#3A6B8C]">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function NumberField({ label, value, onChange, testid }) {
  return (
    <div>
      <Label className="text-xs uppercase tracking-wider text-[#3A6B8C] font-bold">{label}</Label>
      <Input
        type="number"
        step="0.01"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 h-11 tabular-nums"
        data-testid={testid}
      />
    </div>
  );
}
