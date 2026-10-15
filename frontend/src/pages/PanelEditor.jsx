import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Loader2, Plus, Trash2, FileText, Save, AlertTriangle, ShieldAlert } from "lucide-react";
import { Toaster, toast } from "sonner";
import { api, formatApiErrorDetail } from "../lib/api";
import { openPdf } from "../lib/print";
import { useAuth } from "../contexts/AuthContext";
import { LIFTING_STATUS, REINFORCEMENT_OPTIONS, asRect, fmtMm, rectToPoly } from "../lib/panels";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import CadCanvas from "../components/CadCanvas";

const BLANK = { mark: "", description: "", quantity: 1, thickness_mm: 150, concrete_grade: "", reinforcement_key: "standard", finish: "", revision: "A" };
const BLANK_LIFTING = { engineer_name: "", engineer_company: "", reference: "", design_date: "", notes: "", lifters: [] };

// Turn stored openings into editable rows (rectangles get x/y/w/h boxes; other shapes are kept as-is).
const toRows = (openings) => (openings || []).map((poly) => {
  const r = asRect(poly);
  return r ? { kind: "rect", ...r } : { kind: "poly", poly };
});
const fromRows = (rows) => rows.map((r) => (r.kind === "rect" ? rectToPoly(r) : r.poly));

export default function PanelEditor() {
  const { jobId: jobIdParam, pid } = useParams();
  const isNew = !pid;
  const navigate = useNavigate();
  const { hasPerm } = useAuth();

  const [job, setJob] = useState(null);
  const [panel, setPanel] = useState(null);
  const [form, setForm] = useState(BLANK);
  const [shape, setShape] = useState("rect");
  const [rect, setRect] = useState({ w: 6000, h: 3000 });
  const [points, setPoints] = useState([[0, 0], [6000, 0], [6000, 3000], [0, 3000]]);
  const [openings, setOpenings] = useState([]);
  const [lifting, setLifting] = useState(BLANK_LIFTING);
  const [preview, setPreview] = useState(null);
  const [previewErr, setPreviewErr] = useState("");
  const [loadErr, setLoadErr] = useState("");
  const [saving, setSaving] = useState("");
  const [dirty, setDirty] = useState(false);
  const [liftDirty, setLiftDirty] = useState(false);
  const [view, setView] = useState("draw");

  // ----- load -----
  useEffect(() => {
    (async () => {
      try {
        let jid = jobIdParam;
        if (!isNew) {
          const { data: p } = await api.get(`/panels/${pid}`);
          setPanel(p); jid = p.job_id;
          setForm({ mark: p.mark, description: p.description || "", quantity: p.quantity, thickness_mm: p.thickness_mm,
            concrete_grade: p.concrete_grade || "", reinforcement_key: p.reinforcement_key || "standard",
            finish: p.finish || "", revision: p.revision || "A" });
          const r = asRect(p.outline);
          if (r && r.x === 0 && r.y === 0) { setShape("rect"); setRect({ w: r.w, h: r.h }); } else { setShape("custom"); }
          setPoints(p.outline);
          setOpenings(toRows(p.openings));
          setLifting({ ...BLANK_LIFTING, ...(p.lifting || {}), design_date: p.lifting?.design_date || "" });
        }
        const { data: j } = await api.get(`/jobs/${jid}`);
        setJob(j);
        if (isNew) {
          const { data: list } = await api.get(`/jobs/${jid}/panels`);
          const used = new Set(list.items.map((x) => x.mark.toLowerCase()));
          let n = list.items.length + 1;
          while (used.has(`p${String(n).padStart(2, "0")}`)) n++;
          setForm((f) => ({ ...f, mark: `P${String(n).padStart(2, "0")}` }));
        }
      } catch (e) {
        setLoadErr(formatApiErrorDetail(e.response?.data?.detail));
      }
    })();
  }, [jobIdParam, pid, isNew]);

  const outline = useMemo(() => (shape === "rect" ? rectToPoly({ x: 0, y: 0, w: rect.w, h: rect.h }) : points), [shape, rect, points]);
  const openingPolys = useMemo(() => fromRows(openings), [openings]);
  const editable = hasPerm("jobs.edit") && job && job.status !== "cancelled";

  // ----- CAD canvas <-> form state -----
  const n2 = (p) => [Number(p[0]) || 0, Number(p[1]) || 0];
  const cadValue = useMemo(() => ({
    outline: outline.map(n2),
    openings: openingPolys.map((o) => o.map(n2)),
    lifters: lifting.lifters,
  }), [outline, openingPolys, lifting.lifters]);
  const onCadChange = (next) => {
    if (JSON.stringify(next.outline) !== JSON.stringify(cadValue.outline)) {
      const r = asRect(next.outline);
      if (r && r.x === 0 && r.y === 0) { setShape("rect"); setRect({ w: r.w, h: r.h }); }
      else { setShape("custom"); }
      setPoints(next.outline);
      touch();
    }
    if (JSON.stringify(next.openings) !== JSON.stringify(cadValue.openings)) { setOpenings(toRows(next.openings)); touch(); }
    if (JSON.stringify(next.lifters) !== JSON.stringify(cadValue.lifters)) { setLifting((l) => ({ ...l, lifters: next.lifters })); setLiftDirty(true); }
  };

  // ----- live preview (debounced) -----
  const timer = useRef(null);
  useEffect(() => {
    if (!job) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        const lifters = lifting.lifters
          .filter((l) => l.x_mm !== "" && l.y_mm !== "" && Number.isFinite(Number(l.x_mm)) && Number.isFinite(Number(l.y_mm)))
          .map((l, i) => ({ ...l, label: l.label || `L${i + 1}`, x_mm: Number(l.x_mm), y_mm: Number(l.y_mm) }));
        const { data } = await api.post("/panels/preview", {
          thickness_mm: Number(form.thickness_mm), reinforcement_key: form.reinforcement_key,
          outline: outline.map((p) => [Number(p[0]), Number(p[1])]),
          openings: openingPolys.map((poly) => poly.map((p) => [Number(p[0]), Number(p[1])])), lifters,
        });
        setPreview(data); setPreviewErr("");
      } catch (e) {
        setPreviewErr(formatApiErrorDetail(e.response?.data?.detail));
      }
    }, 350);
    return () => clearTimeout(timer.current);
  }, [job, outline, openingPolys, form.thickness_mm, form.reinforcement_key, lifting.lifters]);

  const u = (k, v) => { setForm((f) => ({ ...f, [k]: v })); setDirty(true); };
  const touch = () => setDirty(true);

  // ----- save panel -----
  const save = async () => {
    setSaving("panel");
    const body = {
      ...form, mark: form.mark.trim(), quantity: Number(form.quantity) || 1, thickness_mm: Number(form.thickness_mm),
      outline: outline.map((p) => [Number(p[0]), Number(p[1])]),
      openings: openingPolys.map((poly) => poly.map((p) => [Number(p[0]), Number(p[1])])),
    };
    try {
      if (isNew) {
        const { data } = await api.post(`/jobs/${job.id}/panels`, body);
        toast.success(`Panel ${data.mark} saved`);
        setDirty(false);
        navigate(`/panels/${data.id}`, { replace: true });
      } else {
        const { data } = await api.patch(`/panels/${pid}`, body);
        setPanel(data); setDirty(false);
        toast.success("Panel saved");
      }
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail));
    } finally { setSaving(""); }
  };

  // ----- save lifting -----
  const saveLifting = async () => {
    setSaving("lifting");
    try {
      const body = {
        ...lifting, design_date: lifting.design_date || null,
        lifters: lifting.lifters.map((l) => ({
          label: l.label, type: l.type || "face", x_mm: Number(l.x_mm), y_mm: Number(l.y_mm),
          capacity_t: l.capacity_t === "" || l.capacity_t == null ? null : Number(l.capacity_t), product: l.product || "",
        })),
      };
      if (body.lifters.some((l) => !Number.isFinite(l.x_mm) || !Number.isFinite(l.y_mm))) {
        toast.error("Every lifter needs an X and Y position"); setSaving(""); return;
      }
      const { data } = await api.put(`/panels/${pid}/lifting`, body);
      setPanel(data); setLiftDirty(false);
      setLifting({ ...BLANK_LIFTING, ...(data.lifting || {}), design_date: data.lifting?.design_date || "" });
      toast.success("Lifting record saved");
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail));
    } finally { setSaving(""); }
  };

  const setLifter = (i, k, v) => { setLifting((l) => ({ ...l, lifters: l.lifters.map((x, j) => (j === i ? { ...x, [k]: v } : x)) })); setLiftDirty(true); };

  if (loadErr) return <div className="text-sm text-red-700">{loadErr}</div>;
  if (!job) return <div className="flex items-center gap-2 text-gray-500 text-sm"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>;

  const calc = preview?.calc;
  const st = LIFTING_STATUS[panel?.lifting_status || "missing"];

  return (
    <div className="space-y-6 max-w-7xl" data-testid="panel-editor">
      <Toaster richColors position="top-right" />
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div>
          <Link to={`/jobs/${job.id}`} className="inline-flex items-center text-xs uppercase tracking-wider text-[#3A6B8C] font-bold mb-2 hover:text-[#1F2A33]">
            <ArrowLeft className="w-3 h-3 mr-1" /> Back to job {job.job_number}
          </Link>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-3xl md:text-4xl font-black tracking-tighter text-[#1F2A33]">{isNew ? "New panel" : `Panel ${panel.mark}`}</h1>
            {!isNew && <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded ${st.cls}`}>{st.label}</span>}
            {dirty && <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded bg-amber-100 text-amber-800">Unsaved changes</span>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {!isNew && (
            <Button variant="outline" className="border-[#1F2A33] text-[#1F2A33] font-semibold h-10" disabled={dirty}
              title={dirty ? "Save first — the drawing uses the saved panel" : ""}
              onClick={async () => {
                try { await openPdf(`/panels/${pid}/shop-drawing.pdf`, `shop_drawing_${panel.mark}.pdf`); }
                catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail) || "Couldn't build the PDF"); }
              }} data-testid="panel-pdf-btn">
              <FileText className="w-4 h-4 mr-2" /> Shop drawing
            </Button>
          )}
          {editable && (
            <Button onClick={save} disabled={!!saving || !!previewErr || !form.mark.trim()} className="bg-[#F5C518] text-[#1F2A33] font-bold hover:bg-[#E0B416] h-10 px-6" data-testid="panel-save-btn">
              {saving === "panel" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />} Save panel
            </Button>
          )}
        </div>
      </div>

      <section className="bg-white border border-gray-200 rounded p-5">
        <div className="flex items-center justify-between gap-3 mb-3">
          <h2 className="text-sm font-bold uppercase tracking-[0.15em] text-[#3A6B8C]">Drawing</h2>
          <div className="flex rounded border border-gray-300 overflow-hidden text-xs font-semibold" role="tablist">
            {[["draw", editable ? "Draw (CAD)" : "Elevation"], ["sheet", "Dimensioned view"]].map(([k, l]) => (
              <button key={k} type="button" role="tab" aria-selected={view === k} onClick={() => setView(k)}
                className={`px-3 h-8 ${view === k ? "bg-[#1F2A33] text-white" : "bg-white text-[#1F2A33]"}`} data-testid={`panel-view-${k}`}>{l}</button>
            ))}
          </div>
        </div>
        {previewErr && <div className="flex gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2 mb-3" data-testid="panel-preview-error"><AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />{previewErr}</div>}
        {view === "draw" ? (
          <CadCanvas value={cadValue} onChange={onCadChange} editable={!!editable} allowLifters={!isNew && !!editable}
            cog={!previewErr && calc ? [calc.cog_x_mm, calc.cog_y_mm] : null} />
        ) : preview ? <div className={`bg-gray-50 rounded ${previewErr ? "opacity-40" : ""}`} dangerouslySetInnerHTML={{ __html: preview.svg }} />
          : <div className="h-64 flex items-center justify-center text-gray-400"><Loader2 className="w-5 h-5 animate-spin" /></div>}
        {view === "draw" && isNew && editable && <p className="text-xs text-gray-500 mt-2">Lifters can be placed once the panel is saved.</p>}
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
        {/* ---------- left: inputs ---------- */}
        <div className="xl:col-span-2 space-y-6">
          <Section title="Panel details">
            <div className="grid grid-cols-2 gap-3">
              <F label="Mark *"><Input value={form.mark} onChange={(e) => u("mark", e.target.value)} disabled={!editable} className="h-10 font-bold" data-testid="panel-mark" /></F>
              <F label="Quantity (identical)"><Input type="number" min="1" value={form.quantity} onChange={(e) => u("quantity", e.target.value)} disabled={!editable} className="h-10" /></F>
              <F label="Thickness (mm) *"><Input type="number" min="1" value={form.thickness_mm} onChange={(e) => u("thickness_mm", e.target.value)} disabled={!editable} className="h-10" data-testid="panel-thickness" /></F>
              <F label="Concrete grade"><Input value={form.concrete_grade} onChange={(e) => u("concrete_grade", e.target.value)} placeholder="e.g. 40 MPa" disabled={!editable} className="h-10" /></F>
              <F label="Reinforcement allowance">
                <Select value={form.reinforcement_key} onValueChange={(v) => u("reinforcement_key", v)} disabled={!editable}>
                  <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                  <SelectContent>{REINFORCEMENT_OPTIONS.map((o) => <SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>)}</SelectContent>
                </Select>
              </F>
              <F label="Revision"><Input value={form.revision} onChange={(e) => u("revision", e.target.value)} disabled={!editable} className="h-10" /></F>
              <div className="col-span-2"><F label="Finish"><Input value={form.finish} onChange={(e) => u("finish", e.target.value)} placeholder="e.g. Off-form Class 2" disabled={!editable} className="h-10" /></F></div>
              <div className="col-span-2"><F label="Description"><Input value={form.description} onChange={(e) => u("description", e.target.value)} disabled={!editable} className="h-10" /></F></div>
            </div>
          </Section>

          <Section title="Shape (mm, from bottom-left corner)">
            <div className="flex gap-2 mb-3">
              {[["rect", "Rectangle"], ["custom", "Custom shape"]].map(([k, l]) => (
                <button key={k} type="button" disabled={!editable}
                  onClick={() => {
                    if (k === "custom" && shape === "rect") setPoints(rectToPoly({ x: 0, y: 0, w: rect.w, h: rect.h }));
                    setShape(k); touch();
                  }}
                  className={`px-3 h-9 rounded text-sm font-semibold border ${shape === k ? "bg-[#1F2A33] text-white border-[#1F2A33]" : "bg-white text-[#1F2A33] border-gray-300"}`}>{l}</button>
              ))}
            </div>
            {shape === "rect" ? (
              <div className="grid grid-cols-2 gap-3">
                <F label="Width"><Input type="number" value={rect.w} onChange={(e) => { setRect((r) => ({ ...r, w: e.target.value })); touch(); }} disabled={!editable} className="h-10" data-testid="panel-width" /></F>
                <F label="Height"><Input type="number" value={rect.h} onChange={(e) => { setRect((r) => ({ ...r, h: e.target.value })); touch(); }} disabled={!editable} className="h-10" data-testid="panel-height" /></F>
              </div>
            ) : (
              <div>
                <p className="text-xs text-gray-500 mb-2">Corner points in order, going around the panel. The first point is joined back to the last.</p>
                <table className="w-full text-sm">
                  <thead className="text-[10px] uppercase tracking-wider text-gray-500"><tr><th className="text-left w-8">#</th><th className="text-left">X</th><th className="text-left">Y</th><th /></tr></thead>
                  <tbody>
                    {points.map((p, i) => (
                      <tr key={i}>
                        <td className="text-gray-500">{i + 1}</td>
                        <td className="pr-2 py-1"><Input type="number" value={p[0]} disabled={!editable} className="h-9"
                          onChange={(e) => { setPoints((ps) => ps.map((q, j) => (j === i ? [e.target.value, q[1]] : q))); touch(); }} /></td>
                        <td className="pr-2 py-1"><Input type="number" value={p[1]} disabled={!editable} className="h-9"
                          onChange={(e) => { setPoints((ps) => ps.map((q, j) => (j === i ? [q[0], e.target.value] : q))); touch(); }} /></td>
                        <td>{editable && points.length > 3 && (
                          <Button variant="ghost" size="sm" className="h-8 px-2 text-red-600" aria-label="Remove point"
                            onClick={() => { setPoints((ps) => ps.filter((_, j) => j !== i)); touch(); }}><Trash2 className="w-4 h-4" /></Button>)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {editable && <Button variant="outline" size="sm" className="mt-2" onClick={() => { setPoints((ps) => [...ps, ps[ps.length - 1] || [0, 0]]); touch(); }}><Plus className="w-4 h-4 mr-1" /> Add point</Button>}
              </div>
            )}
          </Section>

          <Section title="Openings">
            {openings.length === 0 && <p className="text-sm text-gray-500 mb-2">No openings. Add windows, doors or penetrations below.</p>}
            {openings.length > 0 && (
              <table className="w-full text-sm mb-2">
                <thead className="text-[10px] uppercase tracking-wider text-gray-500">
                  <tr><th className="text-left w-6">#</th><th className="text-left">X</th><th className="text-left">Y</th><th className="text-left">Width</th><th className="text-left">Height</th><th /></tr>
                </thead>
                <tbody>
                  {openings.map((o, i) => (
                    <tr key={i}>
                      <td className="text-gray-500">{i + 1}</td>
                      {o.kind === "rect" ? ["x", "y", "w", "h"].map((k) => (
                        <td key={k} className="pr-2 py-1"><Input type="number" value={o[k]} disabled={!editable} className="h-9"
                          onChange={(e) => { setOpenings((os) => os.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x))); touch(); }} /></td>
                      )) : <td colSpan={4} className="text-xs text-gray-600 py-2">Shaped opening ({o.poly.length} points, from DXF) — remove and redraw to change</td>}
                      <td>{editable && <Button variant="ghost" size="sm" className="h-8 px-2 text-red-600" aria-label="Remove opening"
                        onClick={() => { setOpenings((os) => os.filter((_, j) => j !== i)); touch(); }}><Trash2 className="w-4 h-4" /></Button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="text-xs text-gray-500">X / Y = bottom-left corner of the opening, measured from the panel's bottom-left corner.</p>
            {editable && <Button variant="outline" size="sm" className="mt-2" data-testid="opening-add-btn"
              onClick={() => { setOpenings((os) => [...os, { kind: "rect", x: 1000, y: 1000, w: 1000, h: 1000 }]); touch(); }}><Plus className="w-4 h-4 mr-1" /> Add opening</Button>}
          </Section>
        </div>

        {/* ---------- right: drawing + numbers ---------- */}
        <div className="xl:col-span-3 space-y-6">

          {calc && (
            <Section title="Calculated (per panel)">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="panel-calc">
                <Num label="Overall" value={`${fmtMm(calc.width_mm)} × ${fmtMm(calc.height_mm)}`} unit="mm" />
                <Num label="Net face area" value={calc.net_area_m2.toFixed(2)} unit="m²" sub={calc.openings_area_m2 ? `${calc.openings_area_m2.toFixed(2)} m² of openings` : "no openings"} />
                <Num label="Concrete volume" value={calc.volume_m3.toFixed(3)} unit="m³" />
                <Num label="Estimated mass" value={(calc.total_weight_kg / 1000).toFixed(2)} unit="t" strong
                  sub={`${Math.round(calc.concrete_weight_kg).toLocaleString()} kg concrete + ${Math.round(calc.steel_weight_kg).toLocaleString()} kg steel`} />
                <Num label="Centre of gravity" value={`${fmtMm(calc.cog_x_mm)}, ${fmtMm(calc.cog_y_mm)}`} unit="mm" sub="X, Y from bottom-left" />
                <Num label="Perimeter" value={calc.perimeter_m.toFixed(2)} unit="m" />
                {Number(form.quantity) > 1 && <Num label={`All ${form.quantity} off`} value={(calc.total_weight_kg * Number(form.quantity) / 1000).toFixed(2)} unit="t" sub={`${(calc.volume_m3 * Number(form.quantity)).toFixed(2)} m³`} />}
              </div>
              <p className="text-xs text-gray-500 mt-3">Mass uses {calc.concrete_density_kg_m3} kg/m³ concrete + {calc.reinforcement_kg_m3} kg/m³ reinforcement allowance from Pricing settings. It's an estimate for planning — the engineer's figure governs for lifting.</p>
            </Section>
          )}

          {/* ---------- lifting record ---------- */}
          <Section title="Lifting — engineer's design (record only)">
            <div className="flex gap-2 text-xs text-[#1F2A33] bg-[#FFF8DC] border border-[#E0B416] rounded px-3 py-2 mb-4">
              <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
              <span>Enter lifters exactly as your structural engineer specified them. This app does <strong>not</strong> work out lifter positions, loads or capacities — it only records and draws them. Panels without an engineer and reference print with a red "DO NOT LIFT" warning.</span>
            </div>
            {isNew ? (
              <p className="text-sm text-gray-500">Save the panel first, then record the lifting design here.</p>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <F label="Engineer name"><Input value={lifting.engineer_name} disabled={!editable} className="h-10" data-testid="lift-engineer"
                    onChange={(e) => { setLifting((l) => ({ ...l, engineer_name: e.target.value })); setLiftDirty(true); }} /></F>
                  <F label="Engineering company"><Input value={lifting.engineer_company} disabled={!editable} className="h-10"
                    onChange={(e) => { setLifting((l) => ({ ...l, engineer_company: e.target.value })); setLiftDirty(true); }} /></F>
                  <F label="Drawing / certificate reference"><Input value={lifting.reference} disabled={!editable} className="h-10" data-testid="lift-reference"
                    onChange={(e) => { setLifting((l) => ({ ...l, reference: e.target.value })); setLiftDirty(true); }} /></F>
                  <F label="Design date"><Input type="date" value={lifting.design_date || ""} disabled={!editable} className="h-10"
                    onChange={(e) => { setLifting((l) => ({ ...l, design_date: e.target.value })); setLiftDirty(true); }} /></F>
                </div>
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-[10px] uppercase tracking-wider text-gray-500">
                      <tr><th className="text-left">Label</th><th className="text-left">Type</th><th className="text-left">X (mm)</th><th className="text-left">Y (mm)</th><th className="text-left">WLL (t)</th><th className="text-left">Product</th><th /></tr>
                    </thead>
                    <tbody>
                      {lifting.lifters.map((l, i) => (
                        <tr key={i}>
                          <td className="pr-2 py-1"><Input value={l.label || ""} placeholder={`L${i + 1}`} disabled={!editable} className="h-9 w-16" onChange={(e) => setLifter(i, "label", e.target.value)} /></td>
                          <td className="pr-2 py-1">
                            <Select value={l.type || "face"} onValueChange={(v) => setLifter(i, "type", v)} disabled={!editable}>
                              <SelectTrigger className="h-9 w-24"><SelectValue /></SelectTrigger>
                              <SelectContent><SelectItem value="edge">Edge</SelectItem><SelectItem value="face">Face</SelectItem></SelectContent>
                            </Select>
                          </td>
                          <td className="pr-2 py-1"><Input type="number" value={l.x_mm} disabled={!editable} className="h-9 w-24" onChange={(e) => setLifter(i, "x_mm", e.target.value)} /></td>
                          <td className="pr-2 py-1"><Input type="number" value={l.y_mm} disabled={!editable} className="h-9 w-24" onChange={(e) => setLifter(i, "y_mm", e.target.value)} /></td>
                          <td className="pr-2 py-1"><Input type="number" step="0.1" value={l.capacity_t ?? ""} disabled={!editable} className="h-9 w-20" onChange={(e) => setLifter(i, "capacity_t", e.target.value)} /></td>
                          <td className="pr-2 py-1"><Input value={l.product || ""} disabled={!editable} className="h-9 min-w-[120px]" onChange={(e) => setLifter(i, "product", e.target.value)} /></td>
                          <td>{editable && <Button variant="ghost" size="sm" className="h-8 px-2 text-red-600" aria-label="Remove lifter"
                            onClick={() => { setLifting((x) => ({ ...x, lifters: x.lifters.filter((_, j) => j !== i) })); setLiftDirty(true); }}><Trash2 className="w-4 h-4" /></Button>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {editable && <Button variant="outline" size="sm" className="mt-2" data-testid="lifter-add-btn"
                    onClick={() => { setLifting((l) => ({ ...l, lifters: [...l.lifters, { label: "", type: "edge", x_mm: "", y_mm: "", capacity_t: "", product: "" }] })); setLiftDirty(true); }}>
                    <Plus className="w-4 h-4 mr-1" /> Add lifter</Button>}
                </div>
                {(preview?.warnings || []).map((w) => <div key={w} className="flex gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2 mt-3"><AlertTriangle className="w-4 h-4 shrink-0" />{w}</div>)}
                <div className="mt-3"><F label="Engineer's notes"><Textarea rows={3} value={lifting.notes} disabled={!editable}
                  onChange={(e) => { setLifting((l) => ({ ...l, notes: e.target.value })); setLiftDirty(true); }} /></F></div>
                {panel?.lifting?.recorded_at && <p className="text-xs text-gray-500 mt-2">Last recorded by {panel.lifting.recorded_by_name || "—"} on {new Date(panel.lifting.recorded_at).toLocaleString("en-AU")}</p>}
                {editable && (
                  <Button onClick={saveLifting} disabled={!!saving || !liftDirty} className="mt-3 bg-[#3A6B8C] text-white hover:bg-[#2C526B] h-10" data-testid="lift-save-btn">
                    {saving === "lifting" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />} Save lifting record
                  </Button>
                )}
              </>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section className="bg-white border border-gray-200 rounded p-5">
      <h2 className="text-sm font-bold uppercase tracking-[0.15em] text-[#3A6B8C] mb-3">{title}</h2>
      {children}
    </section>
  );
}
function F({ label, children }) {
  return <div><Label className="text-xs uppercase tracking-wider text-[#3A6B8C] font-bold">{label}</Label><div className="mt-1">{children}</div></div>;
}
function Num({ label, value, unit, sub, strong }) {
  return (
    <div className={`border rounded px-3 py-2 ${strong ? "border-[#1F2A33]" : "border-gray-200"}`}>
      <div className="text-[10px] uppercase tracking-wider text-gray-500 font-bold">{label}</div>
      <div className="text-lg font-black tabular-nums text-[#1F2A33]">{value} <span className="text-xs font-semibold text-gray-500">{unit}</span></div>
      {sub && <div className="text-[11px] text-gray-500">{sub}</div>}
    </div>
  );
}
