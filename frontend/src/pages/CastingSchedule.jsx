import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight, Loader2, CalendarDays, AlertTriangle, Settings } from "lucide-react";
import { Toaster, toast } from "sonner";
import { api, formatApiErrorDetail } from "../lib/api";
import { StatusChip, addDays, fmtT, mondayOf, todayISO } from "../lib/production";
import { fmtMm } from "../lib/panels";
import { useAuth } from "../contexts/AuthContext";
import UnitActions from "../components/UnitActions";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "../components/ui/dialog";

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// Week board: rows = casting beds, columns = days. Click a panel to place it.
export default function CastingSchedule() {
  const { hasPerm } = useAuth();
  const canEdit = hasPerm("production.edit");
  const [weekStart, setWeekStart] = useState(mondayOf(todayISO()));
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [picked, setPicked] = useState(null);      // unit being placed
  const [place, setPlace] = useState({ date: "", bed_id: "" });
  const [busy, setBusy] = useState(false);
  const [showWeekend, setShowWeekend] = useState(() => [0, 6].includes(new Date().getDay()));   // weekends show when it is one
  const [filter, setFilter] = useState("");

  const days = useMemo(() => Array.from({ length: showWeekend ? 7 : 5 }, (_, i) => addDays(weekStart, i)), [weekStart, showWeekend]);
  const load = useCallback(async () => {
    try {
      const { data: d } = await api.get("/production/schedule", { params: { from: weekStart, to: addDays(weekStart, 6) } });
      setData(d); setErr("");
    } catch (e) { setErr(formatApiErrorDetail(e.response?.data?.detail)); }
  }, [weekStart]);
  useEffect(() => { load(); }, [load]);

  const cell = (bedId, day) => (data?.items || []).filter((u) => (u.bed_id || "") === (bedId || "") && u.planned_cast_date === day);
  const noBed = (day) => cell("", day);

  const startPlace = (u, day = "", bed_id = "") => {
    if (!canEdit) return;
    setPicked(u); setPlace({ date: day || u.planned_cast_date || todayISO(), bed_id: bed_id || u.bed_id || (data?.beds?.[0]?.id || "") });
  };
  const confirmPlace = async (unschedule = false) => {
    setBusy(true);
    try {
      await api.patch(`/units/${picked.id}/plan`, unschedule ? { planned_cast_date: null, bed_id: null } : { planned_cast_date: place.date, bed_id: place.bed_id || null });
      toast.success(unschedule ? `${picked.label} taken off the schedule` : `${picked.label} planned for ${place.date}`);
      setPicked(null); load();
    } catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail)); }
    finally { setBusy(false); }
  };

  const usage = (bed, day) => {
    const used = data?.usage_mm?.[bed.id]?.[day] || 0;
    return { used, pct: bed.length_mm ? used / bed.length_mm : 0 };
  };

  const unscheduled = (data?.unscheduled || []).filter((u) => !filter || `${u.job_number} ${u.label}`.toLowerCase().includes(filter.toLowerCase()));
  const today = todayISO();

  return (
    <div className="space-y-5" data-testid="casting-schedule">
      <Toaster richColors position="top-right" />
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div>
          <div className="overline">Production</div>
          <h1 className="text-3xl md:text-4xl font-black tracking-tighter text-[#1F2A33]">Casting Schedule</h1>
          <p className="text-sm text-gray-500 mt-1">Which panels pour on which bed, day by day. Click a panel to move it; use its ✓ button once it's poured.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" className="h-9 px-2" onClick={() => setWeekStart(addDays(weekStart, -7))} aria-label="Previous week"><ChevronLeft className="w-4 h-4" /></Button>
          <Button variant="outline" className="h-9" onClick={() => setWeekStart(mondayOf(today))}>This week</Button>
          <Button variant="outline" className="h-9 px-2" onClick={() => setWeekStart(addDays(weekStart, 7))} aria-label="Next week"><ChevronRight className="w-4 h-4" /></Button>
          <label className="text-xs text-gray-600 inline-flex items-center gap-1 ml-2"><input type="checkbox" checked={showWeekend} onChange={(e) => setShowWeekend(e.target.checked)} /> Weekend</label>
          <Link to="/settings/production"><Button variant="ghost" className="h-9 text-gray-600"><Settings className="w-4 h-4 mr-1" /> Beds</Button></Link>
        </div>
      </div>

      {err && <div className="text-sm text-red-700">{err}</div>}
      {!data && !err && <div className="flex items-center gap-2 text-gray-500 text-sm"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>}

      {data && data.beds.length === 0 && (
        <div className="border border-dashed border-gray-300 rounded p-6 text-sm text-gray-600 bg-white">
          No casting beds set up yet. <Link to="/settings/production" className="text-[#3A6B8C] underline">Add your beds</Link> (name and length) and they'll appear here as rows. You can still plan by date below.
        </div>
      )}

      {data && (data.overdue || []).length > 0 && (
        <div className="flex gap-2 text-sm text-red-800 bg-red-50 border border-red-200 rounded px-3 py-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <div><strong>{data.overdue.length} panel{data.overdue.length === 1 ? "" : "s"}</strong> planned before this week but not cast yet:
            {" "}{data.overdue.slice(0, 8).map((u) => <button key={u.id} type="button" className="underline mr-2" onClick={() => startPlace(u)}>{u.label}</button>)}{data.overdue.length > 8 ? "…" : ""}</div>
        </div>
      )}

      {data && (
        <div className="grid grid-cols-1 xl:grid-cols-4 gap-5">
          <div className="xl:col-span-3 bg-white border border-gray-200 rounded overflow-x-auto">
            <table className="w-full text-xs border-collapse" data-testid="schedule-grid">
              <thead>
                <tr className="bg-gray-50">
                  <th className="text-left px-3 py-2 w-36 border-b border-r border-gray-200 sticky left-0 bg-gray-50 z-10">Bed</th>
                  {days.map((d) => (
                    <th key={d} className={`px-2 py-2 border-b border-gray-200 text-center ${d === today ? "bg-[#FFF8DC]" : ""}`}>
                      <div className="font-bold text-[#1F2A33]">{DAY_NAMES[(new Date(d + "T12:00:00").getDay() + 6) % 7]}</div>
                      <div className="text-gray-500 font-normal">{d.slice(8)}/{d.slice(5, 7)}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...data.beds, { id: "", name: "No bed chosen", length_mm: 0, _nobed: true }].map((bed) => (
                  <tr key={bed.id || "none"} className="align-top">
                    <td className="px-3 py-2 border-r border-b border-gray-200 sticky left-0 bg-white z-10">
                      <div className="font-bold text-[#1F2A33]">{bed.name}</div>
                      {!bed._nobed && <div className="text-gray-500">{(bed.length_mm / 1000).toFixed(1)} m × {(bed.width_mm / 1000).toFixed(1)} m</div>}
                    </td>
                    {days.map((d) => {
                      const items = bed._nobed ? noBed(d) : cell(bed.id, d);
                      const u = bed._nobed ? null : usage(bed, d);
                      const over = u && u.pct > 1;
                      return (
                        <td key={d} className={`px-1.5 py-1.5 border-b border-gray-100 min-w-[130px] ${d === today ? "bg-[#FFFDF2]" : ""} ${over ? "bg-red-50" : ""}`}
                          onDoubleClick={() => canEdit && picked && setPlace({ date: d, bed_id: bed.id })}>
                          {u && items.length > 0 && (
                            <div className="h-1.5 rounded bg-gray-200 mb-1" title={`${(u.used / 1000).toFixed(1)} m of ${(bed.length_mm / 1000).toFixed(1)} m used`}>
                              <div className={`h-1.5 rounded ${over ? "bg-red-500" : u.pct > 0.85 ? "bg-amber-400" : "bg-[#3A6B8C]"}`} style={{ width: `${Math.min(100, u.pct * 100)}%` }} />
                            </div>
                          )}
                          {over && <div className="text-[10px] text-red-700 font-bold mb-1">Over bed length</div>}
                          <div className="space-y-1">
                            {items.map((it) => <UnitCard key={it.id} u={it} onPick={() => startPlace(it)} onChanged={load} canEdit={canEdit} />)}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="bg-white border border-gray-200 rounded p-4">
            <h2 className="text-sm font-bold uppercase tracking-[0.15em] text-[#3A6B8C] mb-1">To be scheduled</h2>
            <p className="text-xs text-gray-500 mb-2">{data.unscheduled.length} panel{data.unscheduled.length === 1 ? "" : "s"} on live jobs with no cast date.</p>
            <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by job or mark" className="h-9 mb-2" />
            <div className="space-y-1 max-h-[60vh] overflow-y-auto">
              {unscheduled.map((u) => (
                <button key={u.id} type="button" onClick={() => startPlace(u)} disabled={!canEdit}
                  className="w-full text-left border border-gray-200 rounded px-2 py-1.5 hover:border-[#3A6B8C] hover:bg-gray-50 disabled:cursor-default" data-testid={`unsched-${u.label}`}>
                  <div className="flex justify-between"><span className="font-bold text-[#1F2A33]">{u.label}</span><span className="text-[11px] text-gray-500">{u.job_number}</span></div>
                  <div className="text-[11px] text-gray-600 tabular-nums">{fmtMm(u.dims?.width_mm)} × {fmtMm(u.dims?.height_mm)} · {fmtT(u.dims?.weight_kg)}</div>
                </button>
              ))}
              {unscheduled.length === 0 && <div className="text-sm text-gray-500">Nothing waiting.</div>}
            </div>
          </div>
        </div>
      )}

      <Dialog open={!!picked} onOpenChange={(o) => !o && setPicked(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle><CalendarDays className="w-4 h-4 inline mr-1" /> Plan {picked?.label}</DialogTitle>
            <DialogDescription>{picked?.job_number} · {fmtMm(picked?.dims?.width_mm)} × {fmtMm(picked?.dims?.height_mm)} mm · {fmtT(picked?.dims?.weight_kg)}</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs uppercase tracking-wider text-[#3A6B8C] font-bold">Cast date</Label>
              <Input type="date" value={place.date} onChange={(e) => setPlace((p) => ({ ...p, date: e.target.value }))} className="h-10 mt-1" data-testid="plan-date" /></div>
            <div><Label className="text-xs uppercase tracking-wider text-[#3A6B8C] font-bold">Bed</Label>
              <Select value={place.bed_id || "none"} onValueChange={(v) => setPlace((p) => ({ ...p, bed_id: v === "none" ? "" : v }))}>
                <SelectTrigger className="h-10 mt-1" data-testid="plan-bed"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="none">No bed yet</SelectItem>{(data?.beds || []).map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
              </Select></div>
          </div>
          <DialogFooter className="gap-2">
            {picked?.planned_cast_date && <Button variant="outline" className="text-red-700" disabled={busy} onClick={() => confirmPlace(true)}>Take off schedule</Button>}
            <Button variant="outline" onClick={() => setPicked(null)}>Cancel</Button>
            <Button disabled={busy || !place.date} onClick={() => confirmPlace(false)} className="bg-[#F5C518] text-[#1F2A33] font-bold hover:bg-[#E0B416]" data-testid="plan-save">{busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function UnitCard({ u, onPick, onChanged, canEdit }) {
  const [expanded, setExpanded] = useState(false);
  const planned = u.status === "planned";
  return (
    <div className={`border rounded px-1.5 py-1 ${planned ? "border-gray-300 bg-white" : "border-transparent bg-gray-50 opacity-80"}`} data-testid={`sched-${u.label}`}>
      <div className="flex items-center justify-between gap-1">
        <button type="button" onClick={() => (planned && canEdit ? onPick() : setExpanded((x) => !x))} className="text-left min-w-0">
          <div className="font-bold text-[#1F2A33] truncate"><Link to={`/units/${u.id}`} onClick={(e) => e.stopPropagation()} className="hover:underline">{u.label}</Link></div>
          <div className="text-[10px] text-gray-500 truncate">{u.job_number} · {fmtMm(u.dims?.width_mm)}×{fmtMm(u.dims?.height_mm)}</div>
        </button>
        {planned ? (
          <UnitActions unit={{ ...u, next_status: "cast", status_history: [] }} compact onChange={onChanged} />
        ) : <StatusChip status={u.status} />}
      </div>
      {expanded && !planned && <div className="text-[10px] text-gray-600 mt-1">Cast {u.cast_at?.slice(0, 10)}{u.yard_location ? ` · ${u.yard_location}` : ""}</div>}
    </div>
  );
}
