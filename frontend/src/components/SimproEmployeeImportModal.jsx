import { useEffect, useState } from "react";
import { Loader2, CloudDownload, Search } from "lucide-react";
import { api, formatApiErrorDetail } from "../lib/api";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "./ui/dialog";
import { toast } from "sonner";

/**
 * Simpro Employee Import Modal.
 * Props:
 *   open: boolean
 *   onOpenChange(v)
 *   simpro: settings.simpro section (or null)
 *   onImported({synced, created, updated, errors[]}): called after successful import
 */
export default function SimproEmployeeImportModal({ open, onOpenChange, simpro, onImported }) {
  const availableCids = (simpro?.company_ids || []).map(Number);
  const [selectedCids, setSelectedCids] = useState(new Set(availableCids));
  const [preview, setPreview] = useState(null);           // {items, count, new_count, existing_count}
  const [previewErr, setPreviewErr] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const [picked, setPicked] = useState(new Set());        // simpro_employee_ids ticked to import
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    if (!open) { setPreview(null); setPreviewErr(""); setPicked(new Set()); setSelectedCids(new Set(availableCids)); return; }
    // eslint-disable-next-line
  }, [open]);

  const configured = !!(simpro && simpro.enabled && simpro.url && (simpro.company_ids || []).length > 0);

  const toggleCid = (cid) => {
    const next = new Set(selectedCids);
    if (next.has(cid)) next.delete(cid); else next.add(cid);
    setSelectedCids(next);
  };

  const runPreview = async () => {
    if (selectedCids.size === 0) { toast.error("Select at least one company."); return; }
    setPreviewing(true); setPreviewErr(""); setPreview(null);
    try {
      const { data } = await api.post("/integrations/simpro/preview-employees",
        { company_ids: Array.from(selectedCids) });
      setPreview(data);
      // Pre-tick new employees only
      setPicked(new Set((data.items || []).filter(i => !i.exists_in_paneltec).map(i => i.simpro_employee_id)));
    } catch (e) {
      setPreviewErr(formatApiErrorDetail(e.response?.data?.detail) || e.message);
    } finally { setPreviewing(false); }
  };

  const togglePick = (sid) => {
    const next = new Set(picked);
    if (next.has(sid)) next.delete(sid); else next.add(sid);
    setPicked(next);
  };

  const doImport = async () => {
    if (picked.size === 0) { toast.error("Tick at least one employee to import."); return; }
    setImporting(true);
    try {
      const { data } = await api.post("/integrations/simpro/sync-employees",
        { company_ids: Array.from(selectedCids), simpro_employee_ids: Array.from(picked) });
      toast.success(`Imported ${data.created} new · updated ${data.updated}${(data.errors?.length||0) ? ` · ${data.errors.length} error(s)` : ""}.`);
      onImported && onImported(data);
      onOpenChange(false);
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message);
    } finally { setImporting(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto" data-testid="simpro-import-modal">
        <DialogHeader>
          <DialogTitle className="inline-flex items-center gap-2">
            <CloudDownload className="w-5 h-5"/> Import employees from Simpro
          </DialogTitle>
          <DialogDescription>
            Pull the current roster from Simpro. Employees you delete here will
            be flagged and skipped on future syncs.
          </DialogDescription>
        </DialogHeader>

        {!configured ? (
          <div className="bg-yellow-50 border border-yellow-200 text-yellow-900 rounded p-4 text-sm" data-testid="simpro-not-configured">
            Configure Simpro in <a href="/admin/settings" className="underline font-semibold">Admin Settings → Integrations</a> first.
            Set a URL, API token, and at least one Company ID, then come back here.
          </div>
        ) : (
          <>
            {/* Company selector */}
            <div>
              <div className="text-[10px] uppercase tracking-wider font-bold text-[#3A6B8C] mb-2">Companies to import from</div>
              <div className="flex flex-wrap gap-2" data-testid="simpro-import-companies">
                {availableCids.map(cid => {
                  const on = selectedCids.has(cid);
                  return (
                    <button key={cid} type="button" onClick={() => toggleCid(cid)}
                            className={`text-xs font-semibold border rounded-full px-3 py-1 uppercase tracking-wider transition
                                        ${on ? "bg-emerald-500 border-emerald-600 text-white"
                                             : "bg-white border-gray-300 text-gray-500 hover:border-emerald-400"}`}
                            data-testid={`simpro-import-cid-${cid}`}>
                      CO {cid}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex gap-2">
              <Button type="button" onClick={runPreview} disabled={previewing || selectedCids.size === 0}
                       className="bg-[#1F2A33] text-white hover:bg-[#374a58]"
                       data-testid="simpro-import-preview-btn">
                {previewing ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin"/> : <Search className="w-4 h-4 mr-1.5"/>}
                Preview
              </Button>
              {preview && (
                <span className="text-xs text-gray-500 self-center" data-testid="simpro-import-count">
                  {preview.new_count} new · {preview.existing_count} already imported · {picked.size} ticked
                </span>
              )}
            </div>

            {previewErr && (
              <div className="bg-red-50 border border-red-200 text-red-900 rounded p-3 text-sm" data-testid="simpro-import-error">
                {previewErr}
              </div>
            )}

            {preview && preview.items && preview.items.length > 0 && (
              <div className="border border-gray-200 rounded overflow-hidden max-h-96 overflow-y-auto">
                <table className="w-full text-sm" data-testid="simpro-import-table">
                  <thead className="bg-gray-100 uppercase text-[10px] tracking-wider text-gray-600 sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left w-10"/>
                      <th className="px-3 py-2 text-left">Name</th>
                      <th className="px-3 py-2 text-left">Position</th>
                      <th className="px-3 py-2 text-left">Email</th>
                      <th className="px-3 py-2 text-left w-24">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.items.map((row, i) => (
                      <tr key={`${row.simpro_employee_id}-${i}`}
                          className={`border-t border-gray-200 ${row.exists_in_paneltec ? "opacity-60" : ""}`}
                          data-testid={`simpro-import-row-${row.simpro_employee_id}`}>
                        <td className="px-3 py-2">
                          <Checkbox checked={picked.has(row.simpro_employee_id)}
                                     onCheckedChange={() => togglePick(row.simpro_employee_id)}
                                     data-testid={`simpro-import-tick-${row.simpro_employee_id}`}/>
                        </td>
                        <td className="px-3 py-2 font-semibold">{row.name}</td>
                        <td className="px-3 py-2 text-xs text-gray-600">{row.position || "—"}</td>
                        <td className="px-3 py-2 text-xs text-gray-600">{row.email || "—"}</td>
                        <td className="px-3 py-2">
                          {row.exists_in_paneltec
                            ? <span className="text-[10px] uppercase tracking-wider bg-gray-200 text-gray-700 px-1.5 py-0.5 rounded">Existing</span>
                            : <span className="text-[10px] uppercase tracking-wider bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded">New</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {preview && (preview.items || []).length === 0 && (
              <div className="text-sm text-gray-500 italic">No employees returned for the selected companies. Check that the companies you ticked have employees in Simpro.</div>
            )}
          </>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="simpro-import-cancel">Cancel</Button>
          {configured && (
            <Button onClick={doImport} disabled={picked.size === 0 || importing}
                     className="bg-[#F5C518] text-[#1F2A33] font-bold hover:bg-[#E0B416]"
                     data-testid="simpro-import-confirm">
              {importing ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin"/> : <CloudDownload className="w-4 h-4 mr-1.5"/>}
              Import selected ({picked.size})
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
