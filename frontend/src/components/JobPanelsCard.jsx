import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Loader2, Plus, Upload, FileDown, Layers, Trash2, Pencil, FileText, QrCode } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiErrorDetail } from "../lib/api";
import { openPdf } from "../lib/print";
import { LIFTING_STATUS, downloadFile, fmtMm, fmtT } from "../lib/panels";
import { unitSummary } from "../lib/production";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "./ui/dialog";
import DxfImportDialog from "./DxfImportDialog";

// Panels register for one job: list, totals, add / import, and shop drawing PDFs.
export default function JobPanelsCard({ job, canEdit }) {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(new Set());
  const [importOpen, setImportOpen] = useState(false);
  const [toDelete, setToDelete] = useState(null);
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    try {
      const { data: d } = await api.get(`/jobs/${job.id}/panels`);
      setData(d);
      setSelected((s) => new Set([...s].filter((id) => d.items.some((p) => p.id === id))));
    } catch (e) {
      setError(formatApiErrorDetail(e.response?.data?.detail));
    }
  }, [job.id]);

  useEffect(() => { load(); }, [load]);

  const editable = canEdit && job.status !== "cancelled";
  const hasQuotedPanels = (job.line_items || []).some((l) => (l.line_type || "panel") === "panel" && l.length_m && l.height_m);

  const pdf = async (path, name, id) => {
    try {
      setBusy(id);
      toast.loading("Building shop drawings…", { id: "sd" });
      const r = await openPdf(path, name);
      if (r?.blocked) toast.message("Popup blocked — the PDF was downloaded instead.", { id: "sd" });
      else toast.success("Shop drawings opened", { id: "sd" });
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail) || "Couldn't build the PDF", { id: "sd" });
    } finally { setBusy(""); }
  };

  const fromLines = async () => {
    try {
      setBusy("lines");
      const { data: d } = await api.post(`/jobs/${job.id}/panels/from-job-lines`);
      toast.success(`${d.created} panel${d.created === 1 ? "" : "s"} added from the quote — check sizes and draw in any openings`);
      load();
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail));
    } finally { setBusy(""); }
  };

  const doDelete = async () => {
    try {
      await api.delete(`/panels/${toDelete.id}`);
      toast.success(`Panel ${toDelete.mark} removed`);
      setToDelete(null); load();
    } catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail)); }
  };

  const toggle = (id) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allOn = data && data.items.length > 0 && selected.size === data.items.length;

  return (
    <section className="bg-white border border-gray-200 rounded p-6" data-testid="job-panels">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-[0.15em] text-[#3A6B8C]">Panels &amp; shop drawings</h2>
          <p className="text-xs text-gray-500 mt-1">Each panel's shape, weight, centre of gravity and the engineer's lifting record.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {editable && (
            <>
              <Button onClick={() => navigate(`/jobs/${job.id}/panels/new`)} className="bg-[#3A6B8C] text-white hover:bg-[#2C526B] h-9" data-testid="panel-add-btn">
                <Plus className="w-4 h-4 mr-1" /> Add panel
              </Button>
              <Button variant="outline" onClick={() => setImportOpen(true)} className="border-[#3A6B8C] text-[#3A6B8C] h-9" data-testid="panel-import-btn">
                <Upload className="w-4 h-4 mr-1" /> Import DXF
              </Button>
            </>
          )}
          {data?.items?.length > 0 && (
            <>
              <Button variant="outline" disabled={!!busy}
                onClick={() => {
                  const ids = [...selected];
                  const q = ids.length && ids.length < data.items.length ? `?ids=${ids.join(",")}` : "";
                  pdf(`/jobs/${job.id}/panels/shop-drawings.pdf${q}`, `shop_drawings_${job.job_number}.pdf`, "batch");
                }}
                className="border-[#1F2A33] text-[#1F2A33] font-semibold h-9" data-testid="panel-batch-pdf-btn">
                {busy === "batch" ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <FileDown className="w-4 h-4 mr-1" />}
                {selected.size && selected.size < data.items.length ? `Shop drawings (${selected.size} selected)` : "All shop drawings (PDF)"}
              </Button>
              <Button variant="outline" disabled={!!busy} className="h-9" data-testid="panel-labels-btn"
                onClick={() => {
                  const ids = [...selected];
                  const q = ids.length && ids.length < data.items.length ? `?ids=${ids.join(",")}` : "";
                  pdf(`/jobs/${job.id}/units/labels.pdf${q}`, `qr_labels_${job.job_number}.pdf`, "labels");
                }}>
                {busy === "labels" ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <QrCode className="w-4 h-4 mr-1" />} QR labels
              </Button>
              <Button variant="ghost" className="h-9 text-gray-600"
                onClick={() => downloadFile(`/jobs/${job.id}/panels/export.dxf`, `panels_${job.job_number}.dxf`).catch(() => toast.error("Couldn't export DXF"))}>
                Export DXF
              </Button>
            </>
          )}
        </div>
      </div>

      {error && <div className="text-sm text-red-700">{error}</div>}
      {!data && !error && <div className="flex items-center gap-2 text-gray-500 text-sm"><Loader2 className="w-4 h-4 animate-spin" /> Loading panels…</div>}

      {data && data.items.length === 0 && (
        <div className="border border-dashed border-gray-300 rounded p-6 text-center text-sm text-gray-600">
          <Layers className="w-6 h-6 mx-auto mb-2 text-gray-400" />
          No panels on this job yet.
          {editable && (
            <div className="mt-3 flex flex-wrap gap-2 justify-center">
              {hasQuotedPanels && (
                <Button onClick={fromLines} disabled={busy === "lines"} className="bg-[#F5C518] text-[#1F2A33] font-bold hover:bg-[#E0B416] h-9" data-testid="panel-from-lines-btn">
                  {busy === "lines" && <Loader2 className="w-4 h-4 mr-1 animate-spin" />} Start from the quoted panels
                </Button>
              )}
              <Button variant="outline" onClick={() => setImportOpen(true)} className="h-9">Import from a DXF</Button>
              <Button variant="outline" onClick={() => navigate(`/jobs/${job.id}/panels/new`)} className="h-9">Draw one</Button>
            </div>
          )}
        </div>
      )}

      {data && data.items.length > 0 && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4" data-testid="panel-totals">
            <Stat label="Panels" value={`${data.totals.panels}`} sub={`${data.totals.marks} mark${data.totals.marks === 1 ? "" : "s"}`} />
            <Stat label="Net area" value={`${data.totals.net_area_m2.toFixed(2)} m²`} />
            <Stat label="Concrete" value={`${data.totals.volume_m3.toFixed(2)} m³`} />
            <Stat label="Total mass" value={`${data.totals.weight_t.toFixed(2)} t`} sub={`Heaviest ${data.totals.heaviest_mark} · ${fmtT(data.totals.heaviest_kg)}`} />
            <Stat label="Lifting designs" warn={data.totals.lifting_missing > 0}
              value={data.totals.lifting_missing ? `${data.totals.lifting_missing} outstanding` : "All recorded"} />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-[10px] uppercase tracking-wider text-gray-600 border-b">
                <tr>
                  <th className="px-2 py-2 w-8"><input type="checkbox" aria-label="Select all panels" checked={allOn}
                    onChange={() => setSelected(allOn ? new Set() : new Set(data.items.map((p) => p.id)))} /></th>
                  <th className="px-3 py-2 text-left">Mark</th>
                  <th className="px-3 py-2 text-left">W × H × T (mm)</th>
                  <th className="px-3 py-2 text-right">Qty</th>
                  <th className="px-3 py-2 text-right">Openings</th>
                  <th className="px-3 py-2 text-right">Net m²</th>
                  <th className="px-3 py-2 text-right">Mass each</th>
                  <th className="px-3 py-2 text-left">Lifting</th>
                  <th className="px-3 py-2 text-left">Production</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((p) => {
                  const st = LIFTING_STATUS[p.lifting_status] || LIFTING_STATUS.missing;
                  return (
                    <tr key={p.id} className="border-b border-gray-100" data-testid={`panel-row-${p.mark}`}>
                      <td className="px-2 py-2.5"><input type="checkbox" aria-label={`Select ${p.mark}`} checked={selected.has(p.id)} onChange={() => toggle(p.id)} /></td>
                      <td className="px-3 py-2.5 font-bold">
                        <Link to={`/panels/${p.id}`} className="text-[#1F2A33] hover:text-[#3A6B8C]">{p.mark}</Link>
                        {p.description && <div className="text-[11px] font-normal text-gray-500 max-w-[220px] truncate">{p.description}</div>}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums text-gray-700">{fmtMm(p.calc.width_mm)} × {fmtMm(p.calc.height_mm)} × {fmtMm(p.thickness_mm)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{p.quantity}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{p.calc.opening_count}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{p.calc.net_area_m2.toFixed(2)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-semibold">{fmtT(p.calc.total_weight_kg)}</td>
                      <td className="px-3 py-2.5"><span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded ${st.cls}`}>{st.label}</span></td>
                      <td className="px-3 py-2.5 text-[11px] text-gray-600 whitespace-nowrap" data-testid={`panel-units-${p.mark}`}>{unitSummary(p.unit_status_counts) || "—"}</td>
                      <td className="px-3 py-2.5 text-right whitespace-nowrap">
                        <Button variant="ghost" size="sm" className="h-8 px-2" title="Shop drawing PDF" disabled={!!busy}
                          onClick={() => pdf(`/panels/${p.id}/shop-drawing.pdf`, `shop_drawing_${p.mark}.pdf`, p.id)}>
                          {busy === p.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
                        </Button>
                        <Button variant="ghost" size="sm" className="h-8 px-2" title={editable ? "Edit" : "View"} onClick={() => navigate(`/panels/${p.id}`)}>
                          <Pencil className="w-4 h-4" />
                        </Button>
                        {editable && (
                          <Button variant="ghost" size="sm" className="h-8 px-2 text-red-600" title="Remove" onClick={() => setToDelete(p)}>
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {importOpen && <DxfImportDialog jobId={job.id} existingMarks={(data?.items || []).map((p) => p.mark)}
        onClose={() => setImportOpen(false)} onImported={() => { setImportOpen(false); load(); }} />}

      <Dialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove panel {toDelete?.mark}?</DialogTitle>
            <DialogDescription>It will disappear from this job and its shop drawings. An administrator can still see it in the audit trail.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setToDelete(null)}>Keep it</Button>
            <Button onClick={doDelete} className="bg-red-600 text-white hover:bg-red-700">Remove panel</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function Stat({ label, value, sub, warn }) {
  return (
    <div className={`border rounded px-3 py-2 ${warn ? "border-red-300 bg-red-50" : "border-gray-200"}`}>
      <div className="text-[10px] uppercase tracking-wider text-gray-500 font-bold">{label}</div>
      <div className={`text-lg font-black tabular-nums ${warn ? "text-red-700" : "text-[#1F2A33]"}`}>{value}</div>
      {sub && <div className="text-[11px] text-gray-500 truncate">{sub}</div>}
    </div>
  );
}
