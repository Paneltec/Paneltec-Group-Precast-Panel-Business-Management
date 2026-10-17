import { useEffect, useState } from "react";
import { Link2, Copy, Loader2, Ban } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiErrorDetail } from "../lib/api";
import { useAuth } from "../contexts/AuthContext";
import { Button } from "./ui/button";

// Share a read-only progress page with the builder.
export default function JobTrackingCard({ job }) {
  const { hasPerm } = useAuth();
  const [link, setLink] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get(`/jobs/${job.id}/tracking-link`).then((r) => setLink(r.data)).catch(() => setLink({ enabled: false })); }, [job.id]);

  const create = async () => {
    setBusy(true);
    try { const { data } = await api.post(`/jobs/${job.id}/tracking-link`); setLink(data); toast.success("Tracking link ready"); }
    catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail)); }
    finally { setBusy(false); }
  };
  const revoke = async () => {
    if (!window.confirm("Turn off this link? Anyone who has it will see 'no longer active'.")) return;
    try { const { data } = await api.delete(`/jobs/${job.id}/tracking-link`); setLink(data); toast.success("Link turned off"); }
    catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail)); }
  };
  const copy = async () => { try { await navigator.clipboard.writeText(link.url); toast.success("Copied"); } catch (_e) { toast.message(link.url); } };

  return (
    <section className="bg-white border border-gray-200 rounded p-6" data-testid="job-tracking">
      <h2 className="text-sm font-bold uppercase tracking-[0.15em] text-[#3A6B8C]">Customer tracking link</h2>
      <p className="text-xs text-gray-500 mt-1 mb-3">A read-only page the builder can open without logging in: panel stages, cast dates and delivery bookings. No prices, notes or yard details.</p>
      {!link ? <div className="text-sm text-gray-500">Loading…</div> : link.enabled ? (
        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          <code className="text-xs bg-gray-100 rounded px-2 py-1.5 flex-1 truncate" data-testid="tracking-url">{link.url}</code>
          <Button variant="outline" className="h-9" onClick={copy}><Copy className="w-4 h-4 mr-1" /> Copy</Button>
          <a href={link.url} target="_blank" rel="noreferrer"><Button variant="outline" className="h-9"><Link2 className="w-4 h-4 mr-1" /> Open</Button></a>
          {hasPerm("jobs.edit") && <Button variant="ghost" className="h-9 text-red-700" onClick={revoke}><Ban className="w-4 h-4 mr-1" /> Turn off</Button>}
        </div>
      ) : hasPerm("jobs.edit") ? (
        <Button onClick={create} disabled={busy} className="bg-[#3A6B8C] text-white hover:bg-[#2C526B] h-9" data-testid="tracking-create">{busy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Link2 className="w-4 h-4 mr-1" />} Create tracking link</Button>
      ) : <div className="text-sm text-gray-500">No link yet.</div>}
    </section>
  );
}
