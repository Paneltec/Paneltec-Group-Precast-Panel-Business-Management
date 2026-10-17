import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, MapPin, Search, Check } from "lucide-react";
import { Toaster, toast } from "sonner";
import { api, formatApiErrorDetail } from "../lib/api";
import { StatusChip, fmtT } from "../lib/production";
import { fmtMm } from "../lib/panels";
import { useAuth } from "../contexts/AuthContext";
import UnitActions from "../components/UnitActions";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";

// Where every finished panel is sitting, grouped by bay / row.
export default function Yard() {
  const { hasPerm } = useAuth();
  const canEdit = hasPerm("production.edit");
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState({});   // unit id → draft location

  const load = useCallback(async () => {
    try {
      const { data: d } = await api.get("/production/yard", { params: search ? { search } : {} });
      setData(d); setErr("");
    } catch (e) { setErr(formatApiErrorDetail(e.response?.data?.detail)); }
  }, [search]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  const saveLoc = async (u) => {
    const loc = (editing[u.id] ?? "").trim();
    try {
      await api.patch(`/units/${u.id}`, { yard_location: loc });
      toast.success(`${u.label} → ${loc || "no location"}`);
      setEditing((e) => { const n = { ...e }; delete n[u.id]; return n; });
      load();
    } catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail)); }
  };

  const groups = {};
  (data?.items || []).forEach((u) => { const k = u.status === "in_yard" ? (u.yard_location || "No location recorded") : u.status === "loaded" ? "On a truck (loaded)" : "Stripped — not yet in yard"; (groups[k] = groups[k] || []).push(u); });
  const order = Object.keys(groups).sort((a, b) => (a.startsWith("No loc") || a.startsWith("Stripped") || a.startsWith("On a") ? 1 : 0) - (b.startsWith("No loc") || b.startsWith("Stripped") || b.startsWith("On a") ? 1 : 0) || a.localeCompare(b, undefined, { numeric: true }));

  return (
    <div className="space-y-5" data-testid="yard-page">
      <Toaster richColors position="top-right" />
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div>
          <div className="overline">Production</div>
          <h1 className="text-3xl md:text-4xl font-black tracking-tighter text-[#1F2A33]">Yard</h1>
          <p className="text-sm text-gray-500 mt-1">Finished panels and where they're stacked. Type a bay or row against any panel to move it.</p>
        </div>
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-3 text-gray-400" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find mark, job or bay" className="h-10 pl-9 w-64" data-testid="yard-search" />
        </div>
      </div>

      {err && <div className="text-sm text-red-700">{err}</div>}
      {!data && !err && <div className="flex items-center gap-2 text-gray-500 text-sm"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>}

      {data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Panels in yard" value={data.total_in_yard} />
            <Stat label="Mass in yard" value={`${(data.total_weight_kg / 1000).toFixed(1)} t`} />
            <Stat label="Locations in use" value={Object.keys(data.locations).filter((k) => k).length} />
            <Stat label="No location recorded" value={data.locations[""] || 0} warn={(data.locations[""] || 0) > 0} />
          </div>

          {order.length === 0 && <div className="border border-dashed border-gray-300 rounded p-6 text-sm text-gray-600 bg-white">Nothing in the yard{search ? " matching that search" : ""}. Panels appear here once they're marked stripped or moved to the yard.</div>}

          {order.map((k) => (
            <section key={k} className="bg-white border border-gray-200 rounded">
              <div className="flex items-center justify-between px-4 py-2 border-b bg-gray-50">
                <h2 className="text-sm font-bold text-[#1F2A33] inline-flex items-center gap-2"><MapPin className="w-4 h-4 text-[#3A6B8C]" /> {k}</h2>
                <span className="text-xs text-gray-500">{groups[k].length} panel{groups[k].length === 1 ? "" : "s"} · {fmtT(groups[k].reduce((s, u) => s + (u.dims?.weight_kg || 0), 0))}</span>
              </div>
              <table className="w-full text-sm">
                <tbody>
                  {groups[k].map((u) => (
                    <tr key={u.id} className="border-b border-gray-100" data-testid={`yard-${u.label}`}>
                      <td className="px-4 py-2 font-bold w-32"><Link to={`/units/${u.id}`} className="hover:text-[#3A6B8C]">{u.label}</Link></td>
                      <td className="px-2 py-2 text-gray-600 w-40">{u.job_number}<div className="text-[11px] text-gray-500 truncate max-w-[180px]">{u.project_name}</div></td>
                      <td className="px-2 py-2 text-gray-600 tabular-nums whitespace-nowrap">{fmtMm(u.dims?.width_mm)} × {fmtMm(u.dims?.height_mm)} · {fmtT(u.dims?.weight_kg)}</td>
                      <td className="px-2 py-2"><StatusChip status={u.status} /></td>
                      <td className="px-2 py-2 text-gray-500 whitespace-nowrap">{u.days_in_yard != null ? `${u.days_in_yard} d` : ""}{u.erection_seq != null ? ` · seq ${u.erection_seq}` : ""}{u.load ? ` · ${u.load.docket_number}` : ""}</td>
                      <td className="px-2 py-2 w-56">
                        {canEdit && u.status !== "loaded" ? (
                          <div className="flex gap-1">
                            <Input list="yard-locs" value={editing[u.id] ?? (u.yard_location || "")} onChange={(e) => setEditing((ed) => ({ ...ed, [u.id]: e.target.value }))}
                              onKeyDown={(e) => e.key === "Enter" && saveLoc(u)} placeholder="Bay / row" className="h-8" />
                            {editing[u.id] != null && editing[u.id] !== (u.yard_location || "") && <Button size="sm" className="h-8 px-2 bg-[#1F2A33] text-white" onClick={() => saveLoc(u)}><Check className="w-4 h-4" /></Button>}
                          </div>
                        ) : <span className="text-gray-600">{u.yard_location}</span>}
                      </td>
                      <td className="px-2 py-2 text-right"><UnitActions unit={u} compact onChange={load} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
          <datalist id="yard-locs">{(data.known_locations || []).map((l) => <option key={l} value={l} />)}</datalist>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, warn }) {
  return (
    <div className={`border rounded px-3 py-2 bg-white ${warn ? "border-amber-300" : "border-gray-200"}`}>
      <div className="text-[10px] uppercase tracking-wider text-gray-500 font-bold">{label}</div>
      <div className={`text-xl font-black tabular-nums ${warn ? "text-amber-800" : "text-[#1F2A33]"}`}>{value}</div>
    </div>
  );
}
