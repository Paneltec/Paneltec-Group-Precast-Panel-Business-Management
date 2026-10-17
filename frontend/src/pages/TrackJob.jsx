import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import axios from "axios";
import { API_BASE } from "../lib/api";

const STAGE_ORDER = ["Scheduled", "Cast", "Ready in yard", "On its way", "Delivered", "Installed", "Being remade"];
const STAGE_CLS = {
  "Scheduled": "bg-gray-100 text-gray-700", "Cast": "bg-blue-100 text-blue-800", "Ready in yard": "bg-amber-100 text-amber-800",
  "On its way": "bg-orange-100 text-orange-800", "Delivered": "bg-cyan-100 text-cyan-800", "Installed": "bg-green-100 text-green-800",
  "Being remade": "bg-red-100 text-red-700",
};
const day = (iso) => (iso ? new Date(iso + "T12:00:00").toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric" }) : "—");

// Public, read-only progress page for the builder. No login.
export default function TrackJob() {
  const { token } = useParams();
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  const [filter, setFilter] = useState("");

  useEffect(() => {
    axios.get(`${API_BASE}/public/track/${token}`).then((r) => setD(r.data)).catch((e) => setErr(e.response?.data?.detail || "This link isn't working"));
  }, [token]);

  if (err) return <Shell><div className="text-center py-20"><div className="text-xl font-bold text-[#1F2A33]">{err}</div><div className="text-sm text-gray-500 mt-2">Ask your contact at the precaster for a new link.</div></div></Shell>;
  if (!d) return <Shell><div className="text-center py-20 text-gray-500">Loading…</div></Shell>;

  const rows = d.panels.filter((p) => !filter || p.label.toLowerCase().includes(filter.toLowerCase()) || (p.description || "").toLowerCase().includes(filter.toLowerCase()));

  return (
    <Shell company={d.company}>
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-[#3A6B8C] font-bold">Panel progress</div>
          <h1 className="text-3xl font-black tracking-tighter text-[#1F2A33]">{d.project || d.customer}</h1>
          <div className="text-sm text-gray-600">{d.customer} · Job {d.job_number}</div>
        </div>
        <div className="text-right">
          <div className="text-3xl font-black tabular-nums text-[#1F2A33]">{d.progress_pct}%</div>
          <div className="text-xs text-gray-500">{d.delivered_or_installed} of {d.total_panels} panels delivered</div>
        </div>
      </div>
      <div className="h-3 rounded bg-gray-200 mt-3 overflow-hidden"><div className="h-3 bg-[#3A6B8C]" style={{ width: `${d.progress_pct}%` }} /></div>

      <div className="flex flex-wrap gap-2 mt-4">
        {STAGE_ORDER.filter((s) => d.counts[s]).map((s) => <span key={s} className={`text-xs font-bold px-2.5 py-1 rounded ${STAGE_CLS[s]}`}>{d.counts[s]} {s.toLowerCase()}</span>)}
      </div>

      {d.loads.length > 0 && (
        <section className="mt-6">
          <h2 className="text-sm font-bold uppercase tracking-[0.15em] text-[#3A6B8C] mb-2">Deliveries</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {d.loads.map((l) => (
              <div key={l.docket_number} className="border border-gray-200 rounded p-3 bg-white">
                <div className="flex justify-between"><span className="font-bold">{day(l.delivery_date)}</span><span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${l.status === "delivered" ? "bg-green-100 text-green-800" : l.status === "loaded" ? "bg-orange-100 text-orange-800" : "bg-gray-100 text-gray-700"}`}>{l.status === "planned" ? "Booked" : l.status}</span></div>
                <div className="text-xs text-gray-600 mt-1">{l.panel_count} panel{l.panel_count === 1 ? "" : "s"}: {l.labels.join(", ")}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="mt-6">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-bold uppercase tracking-[0.15em] text-[#3A6B8C]">Panels</h2>
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find a panel" className="h-9 border border-gray-300 rounded px-2 text-sm" />
        </div>
        <div className="bg-white border border-gray-200 rounded overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-[10px] uppercase tracking-wider text-gray-600 border-b">
              <tr><th className="px-3 py-2 text-left">Panel</th><th className="px-3 py-2 text-left">Size (mm)</th><th className="px-3 py-2 text-left">Stage</th><th className="px-3 py-2 text-left">Cast</th><th className="px-3 py-2 text-left">Delivery</th><th className="px-3 py-2 text-left">Installed</th></tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.label} className="border-b border-gray-100">
                  <td className="px-3 py-2 font-bold">{p.label}{p.description && <div className="text-[11px] font-normal text-gray-500">{p.description}</div>}</td>
                  <td className="px-3 py-2 text-gray-600 tabular-nums whitespace-nowrap">{p.size}</td>
                  <td className="px-3 py-2"><span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded whitespace-nowrap ${STAGE_CLS[p.stage]}`}>{p.stage}</span></td>
                  <td className="px-3 py-2 whitespace-nowrap">{p.cast_date ? day(p.cast_date) : p.planned_cast_date ? <span className="text-gray-500">planned {day(p.planned_cast_date)}</span> : "—"}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{p.delivered_date ? day(p.delivered_date) : p.delivery_date ? <span className="text-gray-500">booked {day(p.delivery_date)}</span> : "—"}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{day(p.installed_date)}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-gray-500">No panels yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
      <p className="text-[11px] text-gray-500 mt-6">Updated {new Date(d.generated_at).toLocaleString("en-AU")}. Dates are plans until marked done. Questions: {d.company?.phone || d.company?.email || "contact your precaster"}.</p>
    </Shell>
  );
}

function Shell({ company, children }) {
  return (
    <div className="min-h-screen bg-[#F5F6F7]">
      <header className="bg-[#1F2A33] text-white px-4 py-3">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="font-black tracking-tight text-lg">{company?.name || "Paneltec Group"}</div>
          <div className="text-xs text-gray-300">{company?.phone}</div>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-4 py-6">{children}</main>
    </div>
  );
}
