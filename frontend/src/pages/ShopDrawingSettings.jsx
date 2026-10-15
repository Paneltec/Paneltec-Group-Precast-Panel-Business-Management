import { useEffect, useState } from "react";
import { Loader2, Save, Eye } from "lucide-react";
import { Toaster, toast } from "sonner";
import { api, formatApiErrorDetail } from "../lib/api";
import { useAuth } from "../contexts/AuthContext";
import { openPostedPdf } from "../lib/panels";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import { Switch } from "../components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";

const TOGGLES = [
  ["show_dimensions", "Dimension chains", "Running and overall dimensions along the bottom and left."],
  ["show_cog", "Centre of gravity", "CoG marker on the drawing and in the panel data."],
  ["show_lifters", "Lifters", "Engineer's lifter positions on the drawing."],
  ["show_opening_schedule", "Opening schedule", "Table of every opening's position and size."],
  ["show_weights", "Volume & mass", "Concrete volume and estimated mass in the panel data."],
];

// Shop drawing template: what every panel sheet looks like.
export default function ShopDrawingSettings() {
  const { hasPerm } = useAuth();
  const canEdit = hasPerm("company.edit");
  const [form, setForm] = useState(null);
  const [meta, setMeta] = useState({ placeholders: [], lifting_disclaimer: "" });
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    api.get("/settings/shop-drawing").then(({ data }) => {
      const { placeholders, lifting_disclaimer, ...rest } = data;
      setForm(rest); setMeta({ placeholders, lifting_disclaimer });
    }).catch((e) => setErr(formatApiErrorDetail(e.response?.data?.detail)));
  }, []);

  const u = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    setBusy("save");
    try {
      const { data } = await api.put("/settings/shop-drawing", form);
      const { placeholders, lifting_disclaimer, ...rest } = data;
      setForm(rest);
      toast.success("Shop drawing template saved");
    } catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail)); }
    finally { setBusy(""); }
  };

  const preview = async () => {
    setBusy("preview");
    try { await openPostedPdf("/settings/shop-drawing/preview.pdf", form, "shop_drawing_sample.pdf"); }
    catch (_e) { toast.error("Couldn't build the sample"); }
    finally { setBusy(""); }
  };

  if (err) return <div className="text-sm text-red-700">{err}</div>;
  if (!form) return <div className="flex items-center gap-2 text-gray-500 text-sm"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>;

  return (
    <div className="max-w-5xl space-y-6" data-testid="shop-drawing-settings">
      <Toaster richColors position="top-right" />
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <div className="overline">Settings</div>
          <h1 className="text-3xl md:text-4xl font-black tracking-tighter text-[#1F2A33]">Shop Drawing Template</h1>
          <p className="text-sm text-gray-500 mt-1">Sets the layout and notes on every panel shop drawing. Try it with "Preview sample" before saving.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={preview} disabled={!!busy} className="h-11 border-[#1F2A33] text-[#1F2A33]" data-testid="sd-preview-btn">
            {busy === "preview" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Eye className="w-4 h-4 mr-2" />} Preview sample
          </Button>
          {canEdit && (
            <Button onClick={save} disabled={!!busy} className="bg-[#F5C518] text-[#1F2A33] font-bold hover:bg-[#E0B416] h-11 px-6" data-testid="sd-save-btn">
              {busy === "save" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />} Save template
            </Button>
          )}
        </div>
      </div>

      <section className="bg-white border border-gray-200 rounded p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
        <F label="Drawing title"><Input value={form.title} onChange={(e) => u("title", e.target.value)} disabled={!canEdit} className="h-11" /></F>
        <F label="Paper size (landscape)">
          <Select value={form.paper} onValueChange={(v) => u("paper", v)} disabled={!canEdit}>
            <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="A3">A3</SelectItem><SelectItem value="A4">A4</SelectItem></SelectContent>
          </Select>
        </F>
        <F label="Drawn by"><Input value={form.drawn_by} onChange={(e) => u("drawn_by", e.target.value)} disabled={!canEdit} className="h-11" /></F>
        <F label="Checked by"><Input value={form.checked_by} onChange={(e) => u("checked_by", e.target.value)} disabled={!canEdit} className="h-11" /></F>
      </section>

      <section className="bg-white border border-gray-200 rounded p-6 space-y-4">
        <F label="General notes (printed on every sheet)">
          <Textarea rows={7} value={form.general_notes} onChange={(e) => u("general_notes", e.target.value)} disabled={!canEdit} className="font-mono text-sm" />
        </F>
        <div className="text-xs text-gray-600">
          Fill-in fields — type these and each sheet swaps in that panel's value:
          <div className="flex flex-wrap gap-1.5 mt-2">
            {meta.placeholders.map((p) => (
              <button key={p} type="button" disabled={!canEdit} onClick={() => u("general_notes", `${form.general_notes}{{${p}}}`)}
                className="font-mono text-[11px] px-2 py-0.5 rounded bg-gray-100 hover:bg-gray-200 text-[#1F2A33]">{`{{${p}}}`}</button>
            ))}
          </div>
        </div>
        <F label="Footer note (optional)"><Input value={form.footer_note} onChange={(e) => u("footer_note", e.target.value)} disabled={!canEdit} className="h-11" placeholder="e.g. Issued for construction" /></F>
      </section>

      <section className="bg-white border border-gray-200 rounded p-6">
        <h2 className="text-sm font-bold uppercase tracking-[0.15em] text-[#3A6B8C] mb-4">Show on the drawing</h2>
        <div className="divide-y">
          {TOGGLES.map(([k, label, help]) => (
            <div key={k} className="flex items-center justify-between py-3 gap-4">
              <div><div className="font-semibold text-sm text-[#1F2A33]">{label}</div><div className="text-xs text-gray-500">{help}</div></div>
              <Switch checked={!!form[k]} onCheckedChange={(v) => u(k, v)} disabled={!canEdit} aria-label={label} />
            </div>
          ))}
        </div>
      </section>

      <section className="bg-[#FFF8DC] border border-[#E0B416] rounded p-4 text-xs text-[#1F2A33]">
        <strong>Always printed (can't be turned off):</strong> {meta.lifting_disclaimer}
      </section>
    </div>
  );
}

function F({ label, children }) {
  return <div><Label className="text-xs uppercase tracking-wider text-[#3A6B8C] font-bold">{label}</Label><div className="mt-1">{children}</div></div>;
}
