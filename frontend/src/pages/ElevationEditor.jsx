import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Loader2, AlertTriangle, Layers } from "lucide-react";
import { Toaster, toast } from "sonner";
import { api, formatApiErrorDetail } from "../lib/api";
import { useAuth } from "../contexts/AuthContext";
import { REINFORCEMENT_OPTIONS, fmtMm, fmtT, rectToPoly } from "../lib/panels";
import CadCanvas from "../components/CadCanvas";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";

const COLORS = ["#3A6B8C", "#C0392B", "#16A34A", "#7C3AED", "#D97706", "#0EA5E9", "#DB2777", "#65A30D"];

// Draw a whole wall once, cut it into panels at the joints, create them all.
export default function ElevationEditor() {
  const { jobId } = useParams();
  const navigate = useNavigate();
  const { hasPerm } = useAuth();
  const [job, setJob] = useState(null);
  const [err, setErr] = useState("");
  const [wall, setWall] = useState({ outline: rectToPoly({ x: 0, y: 0, w: 12000, h: 3600 }), openings: [], lifters: [], cuts: [4000, 8000] });
  const [opts, setOpts] = useState({ elevation_name: "South", mark_prefix: "S-", start_no: 1, digits: 2, thickness_mm: 150, concrete_grade: "", reinforcement_key: "standard", finish: "" });
  const [preview, setPreview] = useState(null);
  const [previewErr, setPreviewErr] = useState("");
  const [busy, setBusy] = useState(false);
  const timer = useRef(null);

  useEffect(() => {
    api.get(`/jobs/${jobId}`).then((r) => setJob(r.data)).catch((e) => setErr(formatApiErrorDetail(e.response?.data?.detail)));
  }, [jobId]);

  // live preview of the split
  useEffect(() => {
    if (!job) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        const { data } = await api.post(`/jobs/${jobId}/panels/elevation-preview`, {
          outline: wall.outline, openings: wall.openings, cuts: wall.cuts,
          thickness_mm: Number(opts.thickness_mm), concrete_grade: opts.concrete_grade, reinforcement_key: opts.reinforcement_key,
          finish: opts.finish, mark_prefix: opts.mark_prefix, start_no: Number(opts.start_no) || 0, digits: Number(opts.digits) || 2,
        });
        setPreview(data); setPreviewErr("");
      } catch (e) { setPreviewErr(formatApiErrorDetail(e.response?.data?.detail)); }
    }, 350);
    return () => clearTimeout(timer.current);
  }, [job, jobId, wall, opts]);

  // overlays: each strip is re-based to its own bottom-left by the server; put it back at its origin
  const overlays = useMemo(() => (preview ? preview.panels.map((p, i) => ({
    outline: p.outline.map(([x, y]) => [x + p.origin[0], y + p.origin[1]]),
    label: p.mark, sub: p.calc ? `${fmtMm(p.width_mm)} · ${fmtT(p.calc.total_weight_kg)}` : "",
    color: COLORS[i % COLORS.length], valid: p.valid,
  })) : []), [preview]);

  const create = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      const panels = preview.panels.filter((p) => p.valid).map((p) => ({
        mark: p.mark, description: opts.elevation_name ? `${opts.elevation_name} elevation` : "", quantity: 1,
        thickness_mm: Number(opts.thickness_mm), concrete_grade: opts.concrete_grade, reinforcement_key: opts.reinforcement_key, finish: opts.finish,
        outline: p.outline, openings: p.openings, source: "elevation", source_file: opts.elevation_name || "",
      }));
      const { data } = await api.post(`/jobs/${jobId}/panels/bulk`, { panels });
      toast.success(`${data.created} panels created`);
      navigate(`/jobs/${jobId}`);
    } catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail)); setBusy(false); }
  };

  if (err) return <div className="text-sm text-red-700">{err}</div>;
  if (!job) return <div className="flex items-center gap-2 text-gray-500 text-sm"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>;
  const editable = hasPerm("jobs.edit") && job.status !== "cancelled";
  const blocked = !preview || preview.panels.some((p) => p.mark_taken) || !preview.panels.some((p) => p.valid);
  const u = (k, v) => setOpts((o) => ({ ...o, [k]: v }));

  return (
    <div className="space-y-5 max-w-7xl" data-testid="elevation-editor">
      <Toaster richColors position="top-right" />
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div>
          <Link to={`/jobs/${jobId}`} className="inline-flex items-center text-xs uppercase tracking-wider text-[#3A6B8C] font-bold mb-2 hover:text-[#1F2A33]"><ArrowLeft className="w-3 h-3 mr-1" /> Back to job {job.job_number}</Link>
          <h1 className="text-3xl md:text-4xl font-black tracking-tighter text-[#1F2A33]">Elevation → panels</h1>
          <p className="text-sm text-gray-500 mt-1">Draw the whole wall, put in the openings, then click where the panel joints go. Every strip becomes a panel.</p>
        </div>
        {editable && (
          <Button onClick={create} disabled={busy || blocked || !!previewErr} className="bg-[#F5C518] text-[#1F2A33] font-bold hover:bg-[#E0B416] h-11 px-6" data-testid="elevation-create">
            {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Layers className="w-4 h-4 mr-2" />} Create {preview ? preview.panels.filter((p) => p.valid).length : ""} panels
          </Button>
        )}
      </div>

      <section className="bg-white border border-gray-200 rounded p-5">
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3 mb-4">
          <F label="Elevation"><Input value={opts.elevation_name} onChange={(e) => u("elevation_name", e.target.value)} placeholder="South" className="h-10" /></F>
          <F label="Mark prefix"><Input value={opts.mark_prefix} onChange={(e) => u("mark_prefix", e.target.value)} className="h-10 font-bold" data-testid="elev-prefix" /></F>
          <F label="Start no."><Input type="number" value={opts.start_no} onChange={(e) => u("start_no", e.target.value)} className="h-10" /></F>
          <F label="Thickness (mm)"><Input type="number" value={opts.thickness_mm} onChange={(e) => u("thickness_mm", e.target.value)} className="h-10" /></F>
          <F label="Concrete grade"><Input value={opts.concrete_grade} onChange={(e) => u("concrete_grade", e.target.value)} placeholder="40 MPa" className="h-10" /></F>
          <F label="Reinforcement">
            <Select value={opts.reinforcement_key} onValueChange={(v) => u("reinforcement_key", v)}>
              <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
              <SelectContent>{REINFORCEMENT_OPTIONS.map((o) => <SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>)}</SelectContent>
            </Select>
          </F>
          <div className="col-span-2"><F label="Finish"><Input value={opts.finish} onChange={(e) => u("finish", e.target.value)} placeholder="e.g. Off-form Class 2" className="h-10" /></F></div>
        </div>
        {previewErr && <div className="flex gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2 mb-3"><AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />{previewErr}</div>}
        <CadCanvas value={wall} onChange={setWall} editable={editable} allowLifters={false} allowJoints overlays={overlays} height={560} />
        <p className="text-xs text-gray-500 mt-2">Tools: draw the wall with <strong>Draw panel outline</strong> or <strong>Rectangular panel</strong>, add <strong>Openings</strong>, then use <strong>Panel joint</strong> to click each joint position (drag to move, Delete to remove).</p>
      </section>

      {preview && (
        <section className="bg-white border border-gray-200 rounded p-5">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-bold uppercase tracking-[0.15em] text-[#3A6B8C]">Panels that will be created</h2>
            <span className="text-sm text-gray-600">{preview.panels.length} panels · {fmtT(preview.total_weight_kg)}</span>
          </div>
          {preview.warnings.map((w) => <div key={w} className="flex gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2 mb-2"><AlertTriangle className="w-4 h-4 shrink-0" />{w}</div>)}
          <table className="w-full text-sm" data-testid="elevation-table">
            <thead className="bg-gray-50 text-[10px] uppercase tracking-wider text-gray-600 border-b">
              <tr><th className="px-3 py-2 text-left">Mark</th><th className="px-3 py-2 text-left">From → to (mm)</th><th className="px-3 py-2 text-right">Width</th><th className="px-3 py-2 text-right">Height</th><th className="px-3 py-2 text-right">Openings</th><th className="px-3 py-2 text-right">Net m²</th><th className="px-3 py-2 text-right">Mass</th><th className="px-3 py-2 text-left">Note</th></tr>
            </thead>
            <tbody>
              {preview.panels.map((p, i) => (
                <tr key={p.mark} className="border-b border-gray-100">
                  <td className="px-3 py-1.5 font-bold"><span className="inline-block w-2.5 h-2.5 rounded-sm mr-2" style={{ background: COLORS[i % COLORS.length] }} />{p.mark}</td>
                  <td className="px-3 py-1.5 tabular-nums text-gray-600">{fmtMm(p.x_from)} → {fmtMm(p.x_to)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{fmtMm(p.width_mm)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{p.calc ? fmtMm(p.calc.height_mm) : "—"}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{p.openings.length}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{p.calc ? p.calc.net_area_m2.toFixed(2) : "—"}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums font-semibold">{p.calc ? fmtT(p.calc.total_weight_kg) : "—"}</td>
                  <td className="px-3 py-1.5 text-xs">{p.mark_taken ? <span className="text-red-700 font-bold">Mark already used</span> : p.problem ? <span className="text-red-700">{p.problem}</span> : p.split_openings.length ? <span className="text-amber-800">Opening cut by joint</span> : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

function F({ label, children }) {
  return <div><Label className="text-xs uppercase tracking-wider text-[#3A6B8C] font-bold">{label}</Label><div className="mt-1">{children}</div></div>;
}
