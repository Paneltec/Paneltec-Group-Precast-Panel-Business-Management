import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, CalendarDays, MapPin, Truck, AlertTriangle } from "lucide-react";
import { api, formatApiErrorDetail } from "../lib/api";
import { UNIT_STATUS, UNIT_STATUS_ORDER } from "../lib/production";
import { Button } from "../components/ui/button";

// Production at a glance: panels by status, this week's casting, yard, loads.
export default function ProductionDashboard() {
  const [s, setS] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => { api.get("/production/summary").then((r) => setS(r.data)).catch((e) => setErr(formatApiErrorDetail(e.response?.data?.detail))); }, []);

  if (err) return <div className="text-sm text-red-700">{err}</div>;
  if (!s) return <div className="flex items-center gap-2 text-gray-500 text-sm"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>;

  const maxDay = Math.max(1, ...s.days.map((d) => Math.max(d.cast, d.planned)));
  const inProgress = s.total_units - (s.counts.installed || 0) - (s.counts.rejected || 0);

  return (
    <div className="space-y-5" data-testid="production-dashboard">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div>
          <div className="overline">Production</div>
          <h1 className="text-3xl md:text-4xl font-black tracking-tighter text-[#1F2A33]">Production</h1>
          <p className="text-sm text-gray-500 mt-1">{s.live_jobs} live job{s.live_jobs === 1 ? "" : "s"} · {s.total_units} panel{s.total_units === 1 ? "" : "s"} · {inProgress} still to install</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/production/schedule"><Button variant="outline" className="h-10"><CalendarDays className="w-4 h-4 mr-2" /> Casting schedule</Button></Link>
          <Link to="/production/yard"><Button variant="outline" className="h-10"><MapPin className="w-4 h-4 mr-2" /> Yard</Button></Link>
          <Link to="/production/loads"><Button variant="outline" className="h-10"><Truck className="w-4 h-4 mr-2" /> Deliveries</Button></Link>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile label="Cast this week" value={s.cast_this_week} sub={`${s.m3_this_week} m³ · ${s.planned_this_week} planned`} />
        <Tile label="Cast this month" value={s.cast_this_month} sub={`${s.m3_this_month} m³`} />
        <Tile label="In yard" value={s.in_yard} sub={`${s.yard_weight_t} t`} />
        <Tile label="Loads to go" value={s.loads_open} sub={`${s.loads_this_week} this week`} />
        <Tile label="Overdue to cast" value={s.overdue_planned} warn={s.overdue_planned > 0} sub="planned date passed" link="/production/schedule" />
        <Tile label="Open defects" value={s.open_defects} warn={s.open_defects > 0} />
        <Tile label="Installed" value={s.counts.installed || 0} />
        <Tile label="Rejected" value={s.counts.rejected || 0} />
      </div>

      <section className="bg-white border border-gray-200 rounded p-5">
        <h2 className="text-sm font-bold uppercase tracking-[0.15em] text-[#3A6B8C] mb-3">Panels by status (live jobs)</h2>
        <div className="flex h-6 rounded overflow-hidden border border-gray-200" aria-hidden>
          {UNIT_STATUS_ORDER.map((k) => s.counts[k] ? <div key={k} title={`${UNIT_STATUS[k].label}: ${s.counts[k]}`} style={{ width: `${(s.counts[k] / Math.max(1, inProgress + (s.counts.installed || 0))) * 100}%`, background: UNIT_STATUS[k].dot }} /> : null)}
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-1 mt-2 text-xs">
          {UNIT_STATUS_ORDER.map((k) => <span key={k} className="inline-flex items-center gap-1"><i className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: UNIT_STATUS[k].dot }} /> {UNIT_STATUS[k].label} <strong className="tabular-nums">{s.counts[k] || 0}</strong></span>)}
        </div>
      </section>

      <section className="bg-white border border-gray-200 rounded p-5">
        <h2 className="text-sm font-bold uppercase tracking-[0.15em] text-[#3A6B8C] mb-3">Last 14 days — panels cast (and still planned)</h2>
        <div className="flex items-end gap-1 h-32" data-testid="cast-chart">
          {s.days.map((d) => (
            <div key={d.date} className="flex-1 flex flex-col items-center justify-end h-full" title={`${d.date}: ${d.cast} cast (${d.m3} m³), ${d.planned} planned`}>
              <div className="w-full flex items-end justify-center gap-px h-full">
                <div className="w-1/2 rounded-t bg-[#3A6B8C]" style={{ height: `${(d.cast / maxDay) * 100}%` }} />
                {d.planned > 0 && <div className="w-1/2 rounded-t bg-gray-300" style={{ height: `${(d.planned / maxDay) * 100}%` }} />}
              </div>
              <div className="text-[9px] text-gray-500 mt-1">{d.date.slice(8)}/{d.date.slice(5, 7)}</div>
            </div>
          ))}
        </div>
        <div className="text-xs text-gray-500 mt-2">Blue = cast · grey = planned but not cast · week {s.week_start} to {s.week_end}</div>
      </section>

      {s.overdue_planned > 0 && (
        <div className="flex gap-2 text-sm text-red-800 bg-red-50 border border-red-200 rounded px-3 py-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> {s.overdue_planned} panel{s.overdue_planned === 1 ? " is" : "s are"} past the planned cast date. <Link to="/production/schedule" className="underline">Open the schedule</Link> to move or cast them.
        </div>
      )}
    </div>
  );
}

function Tile({ label, value, sub, warn, link }) {
  const inner = (
    <div className={`border rounded px-3 py-2 bg-white h-full ${warn ? "border-red-300 bg-red-50" : "border-gray-200"}`}>
      <div className="text-[10px] uppercase tracking-wider text-gray-500 font-bold">{label}</div>
      <div className={`text-2xl font-black tabular-nums ${warn ? "text-red-700" : "text-[#1F2A33]"}`}>{value}</div>
      {sub && <div className="text-[11px] text-gray-500">{sub}</div>}
    </div>
  );
  return link ? <Link to={link}>{inner}</Link> : inner;
}
