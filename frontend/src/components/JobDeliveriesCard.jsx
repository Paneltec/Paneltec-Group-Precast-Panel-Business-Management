import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Loader2, Plus, Truck } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiErrorDetail } from "../lib/api";
import { fmtDay, fmtT } from "../lib/production";
import { useAuth } from "../contexts/AuthContext";
import { LoadChip } from "../pages/Loads";
import { Button } from "./ui/button";

// Truck loads for one job, with a one-click "New load".
export default function JobDeliveriesCard({ job }) {
  const { hasPerm } = useAuth();
  const navigate = useNavigate();
  const [loads, setLoads] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api.get("/production/loads", { params: { job_id: job.id } }).then((r) => setLoads(r.data.items)).catch(() => setLoads([])), [job.id]);
  useEffect(() => { load(); }, [load]);

  if (!hasPerm("production.view")) return null;
  const editable = hasPerm("production.edit") && job.status !== "cancelled";

  const create = async () => {
    setBusy(true);
    try { const { data } = await api.post(`/jobs/${job.id}/loads`, {}); navigate(`/loads/${data.id}`); }
    catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail)); setBusy(false); }
  };

  return (
    <section className="bg-white border border-gray-200 rounded p-6" data-testid="job-deliveries">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-[0.15em] text-[#3A6B8C]">Deliveries</h2>
          <p className="text-xs text-gray-500 mt-1">Truck loads for this job. Each load gets a docket and moves its panels to loaded / delivered.</p>
        </div>
        {editable && <Button onClick={create} disabled={busy} className="bg-[#3A6B8C] text-white hover:bg-[#2C526B] h-9" data-testid="load-new-btn">{busy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Plus className="w-4 h-4 mr-1" />} New load</Button>}
      </div>
      {!loads && <div className="text-sm text-gray-500">Loading…</div>}
      {loads && loads.length === 0 && <div className="text-sm text-gray-500 inline-flex items-center gap-2"><Truck className="w-4 h-4 text-gray-400" /> No loads yet.</div>}
      {loads && loads.length > 0 && (
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-[10px] uppercase tracking-wider text-gray-600 border-b"><tr><th className="px-3 py-2 text-left">Docket</th><th className="px-3 py-2 text-left">Date</th><th className="px-3 py-2 text-right">Panels</th><th className="px-3 py-2 text-right">Mass</th><th className="px-3 py-2 text-left">Status</th><th className="px-3 py-2 text-left">Panels</th></tr></thead>
          <tbody>
            {loads.map((l) => (
              <tr key={l.id} className="border-b border-gray-100">
                <td className="px-3 py-2 font-bold"><Link to={`/loads/${l.id}`} className="hover:text-[#3A6B8C]">{l.docket_number}</Link></td>
                <td className="px-3 py-2">{fmtDay(l.delivery_date)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{l.unit_count}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtT(l.total_weight_kg)}</td>
                <td className="px-3 py-2"><LoadChip status={l.status} /></td>
                <td className="px-3 py-2 text-xs text-gray-600 truncate max-w-[280px]">{l.unit_labels.join(", ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
