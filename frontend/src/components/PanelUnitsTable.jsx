import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, QrCode } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiErrorDetail } from "../lib/api";
import { openPdf } from "../lib/print";
import { StatusChip, fmtDay } from "../lib/production";
import { useAuth } from "../contexts/AuthContext";
import UnitActions from "./UnitActions";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

// The physical panels (units) behind one panel mark: status, dates, yard, load, erection order.
export default function PanelUnitsTable({ panel }) {
  const { hasPerm } = useAuth();
  const canEdit = hasPerm("production.edit");
  const [units, setUnits] = useState(null);
  const [seq, setSeq] = useState({});

  const load = useCallback(() => api.get(`/panels/${panel.id}/units`).then((r) => { setUnits(r.data.items); setSeq({}); }).catch(() => setUnits([])), [panel.id]);
  useEffect(() => { load(); }, [load, panel.quantity, panel.mark]);

  const saveSeq = async (u) => {
    const v = seq[u.id];
    if (v === undefined || String(v) === String(u.erection_seq ?? "")) return;
    try { await api.patch(`/units/${u.id}`, { erection_seq: v === "" ? null : Number(v) }); toast.success(`${u.label} erection sequence saved`); load(); }
    catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail)); }
  };

  if (!units) return <div className="flex items-center gap-2 text-gray-500 text-sm"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>;

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="text-xs text-gray-500">{units.length} physical panel{units.length === 1 ? "" : "s"} for this mark. Each has its own QR code and status.</p>
        <Button variant="outline" size="sm" className="h-8" onClick={() => openPdf(`/jobs/${panel.job_id}/units/labels.pdf?ids=${panel.id}`, `qr_labels_${panel.mark}.pdf`).catch((e) => toast.error(formatApiErrorDetail(e.response?.data?.detail)))} data-testid="panel-labels-btn">
          <QrCode className="w-4 h-4 mr-1" /> QR labels
        </Button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm" data-testid="panel-units">
          <thead className="bg-gray-50 text-[10px] uppercase tracking-wider text-gray-600 border-b">
            <tr><th className="px-2 py-2 text-left">Unit</th><th className="px-2 py-2 text-left">Status</th><th className="px-2 py-2 text-left">Planned</th><th className="px-2 py-2 text-left">Cast</th><th className="px-2 py-2 text-left">Yard</th><th className="px-2 py-2 text-left">Load</th><th className="px-2 py-2 text-left">Erect. seq</th><th className="px-2 py-2 text-right">Next step</th></tr>
          </thead>
          <tbody>
            {units.map((u) => (
              <tr key={u.id} className="border-b border-gray-100" data-testid={`unit-row-${u.label}`}>
                <td className="px-2 py-1.5 font-bold"><Link to={`/units/${u.id}`} className="hover:text-[#3A6B8C]">{u.label}</Link>{u.open_defects > 0 && <span className="ml-1 text-[10px] text-amber-800 font-bold">⚠ {u.open_defects}</span>}</td>
                <td className="px-2 py-1.5"><StatusChip status={u.status} /></td>
                <td className="px-2 py-1.5 text-gray-600 whitespace-nowrap">{u.planned_cast_date ? `${fmtDay(u.planned_cast_date)}${u.bed_name ? ` · ${u.bed_name}` : ""}` : "—"}</td>
                <td className="px-2 py-1.5 text-gray-600 whitespace-nowrap">{u.cast_at ? fmtDay(u.cast_at) : "—"}</td>
                <td className="px-2 py-1.5 text-gray-600">{u.yard_location || "—"}</td>
                <td className="px-2 py-1.5 text-gray-600 whitespace-nowrap">{u.load ? <Link to={`/loads/${u.load.id}`} className="text-[#3A6B8C]">{u.load.docket_number}</Link> : "—"}</td>
                <td className="px-2 py-1.5">
                  {canEdit ? <Input type="number" min="0" value={seq[u.id] ?? (u.erection_seq ?? "")} onChange={(e) => setSeq((s) => ({ ...s, [u.id]: e.target.value }))} onBlur={() => saveSeq(u)} onKeyDown={(e) => e.key === "Enter" && e.target.blur()} className="h-8 w-20" aria-label={`Erection sequence for ${u.label}`} /> : (u.erection_seq ?? "—")}
                </td>
                <td className="px-2 py-1.5 text-right"><UnitActions unit={u} compact onChange={load} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
