import { useMemo, useState } from "react";
import { Loader2, Upload, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiErrorDetail } from "../lib/api";
import { REINFORCEMENT_OPTIONS, fmtMm } from "../lib/panels";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "./ui/dialog";

// Step 1: choose a DXF + the details CAD doesn't hold (thickness etc).
// Step 2: check what was found, fix marks, untick anything unwanted, import.
export default function DxfImportDialog({ jobId, existingMarks = [], onClose, onImported }) {
  const [file, setFile] = useState(null);
  const [thickness, setThickness] = useState("150");
  const [grade, setGrade] = useState("");
  const [reinf, setReinf] = useState("standard");
  const [result, setResult] = useState(null);
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const taken = useMemo(() => new Set(existingMarks.map((m) => m.toLowerCase())), [existingMarks]);

  const read = async () => {
    if (!file) return;
    setBusy(true); setErr("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data } = await api.post(`/panels/dxf-preview`, fd, { params: { thickness_mm: thickness, reinforcement_key: reinf } });
      setResult(data);
      setRows(data.panels.map((p) => ({ ...p, include: p.valid })));
    } catch (e) {
      setErr(formatApiErrorDetail(e.response?.data?.detail));
    } finally { setBusy(false); }
  };

  const markProblem = (r, i) => {
    const m = (r.mark || "").trim().toLowerCase();
    if (!m) return "Needs a mark";
    if (taken.has(m)) return "Mark already on this job";
    if (rows.some((o, j) => j !== i && o.include && (o.mark || "").trim().toLowerCase() === m)) return "Duplicate mark";
    return "";
  };

  const chosen = rows.filter((r) => r.include);
  const blocked = rows.some((r, i) => r.include && markProblem(r, i));

  const doImport = async () => {
    setBusy(true); setErr("");
    try {
      const panels = chosen.map((r) => ({
        mark: r.mark.trim(), thickness_mm: Number(thickness), concrete_grade: grade, reinforcement_key: reinf,
        outline: r.outline, openings: r.openings, source: "dxf", source_file: result.filename || file?.name || "",
      }));
      const { data } = await api.post(`/jobs/${jobId}/panels/bulk`, { panels });
      toast.success(`${data.created} panel${data.created === 1 ? "" : "s"} imported`);
      onImported();
    } catch (e) {
      setErr(formatApiErrorDetail(e.response?.data?.detail));
    } finally { setBusy(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import panels from a DXF</DialogTitle>
          <DialogDescription>
            Draw each panel as a closed outline, openings as closed shapes inside it, and (optionally) its mark as text inside the panel.
            Nothing is saved until you press Import.
          </DialogDescription>
        </DialogHeader>

        {!result && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <Label className="text-xs uppercase tracking-wider text-[#3A6B8C] font-bold">DXF file</Label>
              <Input type="file" accept=".dxf" className="mt-1 h-11" data-testid="dxf-file"
                onChange={(e) => setFile(e.target.files?.[0] || null)} />
              <p className="text-xs text-gray-500 mt-1">From AutoCAD, Revit, BricsCAD etc. use "Save As → DXF". Max 15 MB.</p>
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-[#3A6B8C] font-bold">Panel thickness (mm)</Label>
              <Input type="number" min="1" value={thickness} onChange={(e) => setThickness(e.target.value)} className="mt-1 h-11" />
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-[#3A6B8C] font-bold">Concrete grade</Label>
              <Input value={grade} onChange={(e) => setGrade(e.target.value)} placeholder="e.g. 40 MPa" className="mt-1 h-11" />
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-[#3A6B8C] font-bold">Reinforcement</Label>
              <Select value={reinf} onValueChange={setReinf}>
                <SelectTrigger className="mt-1 h-11"><SelectValue /></SelectTrigger>
                <SelectContent>{REINFORCEMENT_OPTIONS.map((o) => <SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <p className="text-xs text-gray-500 self-end">These apply to every panel in the file. You can change any panel afterwards.</p>
          </div>
        )}

        {result && (
          <div className="space-y-3">
            <div className="text-sm text-gray-700">
              Found <strong>{rows.length}</strong> panel{rows.length === 1 ? "" : "s"} in <strong>{result.filename}</strong> · units: {result.units}
            </div>
            {result.warnings.map((w) => (
              <div key={w} className="flex gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2"><AlertTriangle className="w-4 h-4 shrink-0" />{w}</div>
            ))}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {rows.map((r, i) => {
                const prob = r.include ? markProblem(r, i) : "";
                return (
                  <div key={i} className={`border rounded p-3 ${r.include ? "border-gray-300" : "border-gray-200 opacity-60"}`}>
                    <div className="flex items-center gap-2 mb-2">
                      <input type="checkbox" checked={r.include} disabled={!r.valid} aria-label="Include this panel"
                        onChange={() => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, include: !x.include } : x)))} />
                      <Input value={r.mark} className="h-8 w-28 font-bold" aria-label="Panel mark"
                        onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, mark: e.target.value } : x)))} />
                      <span className="text-xs text-gray-600 tabular-nums">{fmtMm(r.width_mm)} × {fmtMm(r.height_mm)} · {r.openings.length} opening{r.openings.length === 1 ? "" : "s"}</span>
                    </div>
                    <div className="bg-gray-50 rounded" dangerouslySetInnerHTML={{ __html: r.svg }} />
                    {r.calc && <div className="text-xs text-gray-600 mt-1 tabular-nums">{r.calc.net_area_m2.toFixed(2)} m² · {(r.calc.total_weight_kg / 1000).toFixed(2)} t</div>}
                    {!r.valid && <div className="text-xs text-red-700 mt-1">Can't import: {r.problem}</div>}
                    {prob && <div className="text-xs text-red-700 mt-1">{prob}</div>}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {err && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{err}</div>}

        <DialogFooter>
          {result && <Button variant="outline" onClick={() => { setResult(null); setRows([]); }}>Choose another file</Button>}
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          {!result ? (
            <Button onClick={read} disabled={!file || busy || !(Number(thickness) > 0)} className="bg-[#3A6B8C] text-white hover:bg-[#2C526B]" data-testid="dxf-read-btn">
              {busy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Upload className="w-4 h-4 mr-1" />} Read file
            </Button>
          ) : (
            <Button onClick={doImport} disabled={busy || !chosen.length || blocked} className="bg-[#F5C518] text-[#1F2A33] font-bold hover:bg-[#E0B416]" data-testid="dxf-import-btn">
              {busy && <Loader2 className="w-4 h-4 mr-1 animate-spin" />} Import {chosen.length} panel{chosen.length === 1 ? "" : "s"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
