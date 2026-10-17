import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Loader2, Truck, FileText, Plus, Trash2, ArrowUp, ArrowDown, X, AlertTriangle } from "lucide-react";
import { Toaster, toast } from "sonner";
import { api, formatApiErrorDetail } from "../lib/api";
import { openPdf } from "../lib/print";
import { LOAD_STATUS, StatusChip, fmtDay, fmtT, fmtWhen, todayISO } from "../lib/production";
import { fmtMm } from "../lib/panels";
import { useAuth } from "../contexts/AuthContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "../components/ui/dialog";

export function LoadChip({ status }) {
  const s = LOAD_STATUS[status] || LOAD_STATUS.planned;
  return <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${s.cls}`}>{s.label}</span>;
}

// ---------------------------------------------------------------------------
// All loads (deliveries) across jobs
// ---------------------------------------------------------------------------
export default function LoadsList() {
  const [items, setItems] = useState(null);
  const [err, setErr] = useState("");
  const [showDone, setShowDone] = useState(false);
  useEffect(() => {
    api.get("/production/loads", { params: showDone ? {} : { upcoming_days: 60 } }).then((r) => setItems(r.data.items)).catch((e) => setErr(formatApiErrorDetail(e.response?.data?.detail)));
  }, [showDone]);
  return (
    <div className="space-y-5" data-testid="loads-page">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div>
          <div className="overline">Production</div>
          <h1 className="text-3xl md:text-4xl font-black tracking-tighter text-[#1F2A33]">Deliveries</h1>
          <p className="text-sm text-gray-500 mt-1">Truck loads by delivery date. Loads are created from a job's page.</p>
        </div>
        <label className="text-xs text-gray-600 inline-flex items-center gap-1"><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Include delivered</label>
      </div>
      {err && <div className="text-sm text-red-700">{err}</div>}
      {!items && !err && <div className="flex items-center gap-2 text-gray-500 text-sm"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>}
      {items && items.length === 0 && <div className="border border-dashed border-gray-300 rounded p-6 text-sm text-gray-600 bg-white">No loads yet. Open a job, scroll to <strong>Deliveries</strong> and click <strong>New load</strong>.</div>}
      {items && items.length > 0 && (
        <div className="bg-white border border-gray-200 rounded overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-[10px] uppercase tracking-wider text-gray-600 border-b">
              <tr><th className="px-3 py-2 text-left">Date</th><th className="px-3 py-2 text-left">Docket</th><th className="px-3 py-2 text-left">Job</th><th className="px-3 py-2 text-right">Panels</th><th className="px-3 py-2 text-right">Mass</th><th className="px-3 py-2 text-left">Status</th><th className="px-3 py-2 text-left">Panels on load</th></tr>
            </thead>
            <tbody>
              {items.map((l) => (
                <tr key={l.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-3 py-2 whitespace-nowrap">{fmtDay(l.delivery_date)}</td>
                  <td className="px-3 py-2 font-bold"><Link to={`/loads/${l.id}`} className="hover:text-[#3A6B8C]">{l.docket_number}</Link></td>
                  <td className="px-3 py-2"><Link to={`/jobs/${l.job_id}`} className="text-[#3A6B8C]">{l.job_number}</Link></td>
                  <td className="px-3 py-2 text-right tabular-nums">{l.unit_count}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtT(l.total_weight_kg)}</td>
                  <td className="px-3 py-2"><LoadChip status={l.status} /></td>
                  <td className="px-3 py-2 text-xs text-gray-600 truncate max-w-[320px]">{l.unit_labels.join(", ")}{l.unit_count > l.unit_labels.length ? "…" : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// One load: pick panels, order them, check mass, print the docket, mark loaded / delivered
// ---------------------------------------------------------------------------
export function LoadDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { hasPerm } = useAuth();
  const canEdit = hasPerm("production.edit");
  const canMove = hasPerm("production.transition");
  const [load, setLoad] = useState(null);
  const [avail, setAvail] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [err, setErr] = useState("");
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState("");
  const [confirm, setConfirm] = useState(null);   // "loaded" | "delivered" | "delete"
  const [when, setWhen] = useState(todayISO());

  const refresh = useCallback(async () => {
    try {
      const { data } = await api.get(`/loads/${id}`);
      setLoad(data);
      setForm({ delivery_date: data.delivery_date || "", vehicle_id: data.vehicle_id || "", driver: data.driver || "", site_contact: data.site_contact || "", delivery_address: data.delivery_address || "", notes: data.notes || "" });
      const [{ data: a }, { data: v }] = await Promise.all([api.get(`/jobs/${data.job_id}/loadable-units`), api.get("/vehicles")]);
      setAvail(a.items); setVehicles(Array.isArray(v) ? v : v.items || []);
    } catch (e) { setErr(formatApiErrorDetail(e.response?.data?.detail)); }
  }, [id]);
  useEffect(() => { refresh(); }, [refresh]);

  const planned = load?.status === "planned";
  const dirty = useMemo(() => load && form && ["delivery_date", "vehicle_id", "driver", "site_contact", "delivery_address", "notes"].some((k) => (form[k] || "") !== (load[k] || "")), [load, form]);

  const saveDetails = async () => {
    setBusy("save");
    try { const { data } = await api.patch(`/loads/${id}`, { ...form, vehicle_id: form.vehicle_id || null, delivery_date: form.delivery_date || null }); setLoad(data); toast.success("Load saved"); }
    catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail)); }
    finally { setBusy(""); }
  };
  const setUnits = async (ids) => {
    setBusy("units");
    try { const { data } = await api.patch(`/loads/${id}`, { unit_ids: ids }); setLoad(data); const { data: a } = await api.get(`/jobs/${data.job_id}/loadable-units`); setAvail(a.items); }
    catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail)); }
    finally { setBusy(""); }
  };
  const ids = () => load.units.map((u) => u.id);
  const move = (i, dir) => { const a = ids(); const j = i + dir; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; setUnits(a); };
  const transition = async (to) => {
    setBusy(to);
    try { await api.post(`/loads/${id}/transition`, { to, at: when }); toast.success(`Load ${to}`); setConfirm(null); refresh(); }
    catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail)); }
    finally { setBusy(""); }
  };
  const del = async () => {
    try { await api.delete(`/loads/${id}`); toast.success("Load deleted"); navigate(`/jobs/${load.job_id}`); }
    catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail)); }
  };

  if (err) return <div className="text-sm text-red-700">{err}</div>;
  if (!load || !form) return <div className="flex items-center gap-2 text-gray-500 text-sm"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>;

  const capT = load.capacity_kg ? load.capacity_kg / 1000 : null;
  const totT = load.total_weight_kg / 1000;
  const pct = capT ? Math.min(100, (totT / capT) * 100) : 0;

  return (
    <div className="space-y-5 max-w-6xl" data-testid="load-detail">
      <Toaster richColors position="top-right" />
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div>
          <Link to={`/jobs/${load.job_id}`} className="inline-flex items-center text-xs uppercase tracking-wider text-[#3A6B8C] font-bold mb-2 hover:text-[#1F2A33]"><ArrowLeft className="w-3 h-3 mr-1" /> Job {load.job_number}</Link>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-3xl md:text-4xl font-black tracking-tighter text-[#1F2A33]"><Truck className="w-7 h-7 inline mr-2 text-[#3A6B8C]" />{load.docket_number}</h1>
            <LoadChip status={load.status} />
          </div>
          <p className="text-sm text-gray-500 mt-1">{load.customer_name}{load.project_name ? ` · ${load.project_name}` : ""}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="h-10 border-[#1F2A33] text-[#1F2A33] font-semibold" data-testid="docket-btn"
            onClick={() => openPdf(`/loads/${id}/docket.pdf`, `docket_${load.docket_number}.pdf`).catch((e) => toast.error(formatApiErrorDetail(e.response?.data?.detail)))}>
            <FileText className="w-4 h-4 mr-2" /> Delivery docket
          </Button>
          {canMove && planned && load.unit_count > 0 && <Button className="h-10 bg-[#F5C518] text-[#1F2A33] font-bold hover:bg-[#E0B416]" onClick={() => setConfirm("loaded")} data-testid="load-loaded-btn">Mark as loaded</Button>}
          {canMove && load.status === "loaded" && <Button className="h-10 bg-[#F5C518] text-[#1F2A33] font-bold hover:bg-[#E0B416]" onClick={() => setConfirm("delivered")} data-testid="load-delivered-btn">Mark as delivered</Button>}
          {canEdit && planned && <Button variant="outline" className="h-10 border-red-300 text-red-700" onClick={() => setConfirm("delete")}><Trash2 className="w-4 h-4 mr-2" /> Delete</Button>}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* details */}
        <section className="bg-white border border-gray-200 rounded p-5 space-y-3">
          <h2 className="text-sm font-bold uppercase tracking-[0.15em] text-[#3A6B8C]">Delivery details</h2>
          <F label="Delivery date"><Input type="date" value={form.delivery_date} onChange={(e) => setForm((f) => ({ ...f, delivery_date: e.target.value }))} disabled={!canEdit} className="h-10" /></F>
          <F label="Vehicle">
            <Select value={form.vehicle_id || "none"} onValueChange={(v) => setForm((f) => ({ ...f, vehicle_id: v === "none" ? "" : v }))} disabled={!canEdit}>
              <SelectTrigger className="h-10" data-testid="load-vehicle"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="none">Not chosen</SelectItem>{vehicles.map((v) => <SelectItem key={v.id} value={v.id}>{v.make_model}{v.rego ? ` · ${v.rego}` : ""}{v.capacity_tonnes ? ` · ${v.capacity_tonnes} t` : ""}</SelectItem>)}</SelectContent>
            </Select>
          </F>
          <F label="Driver"><Input value={form.driver} onChange={(e) => setForm((f) => ({ ...f, driver: e.target.value }))} disabled={!canEdit} className="h-10" /></F>
          <F label="Deliver to (address)"><Input value={form.delivery_address} onChange={(e) => setForm((f) => ({ ...f, delivery_address: e.target.value }))} placeholder={load.site_address || "Site address"} disabled={!canEdit} className="h-10" /></F>
          <F label="Site contact"><Input value={form.site_contact} onChange={(e) => setForm((f) => ({ ...f, site_contact: e.target.value }))} disabled={!canEdit} className="h-10" /></F>
          <F label="Notes for driver / site"><Textarea rows={3} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} disabled={!canEdit} /></F>
          {canEdit && <Button onClick={saveDetails} disabled={!dirty || busy === "save"} className="bg-[#1F2A33] text-white h-10" data-testid="load-save">{busy === "save" && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Save details</Button>}

          <div className="pt-3 border-t">
            <div className="flex justify-between text-sm"><span className="text-gray-600">Total mass</span><span className="font-black tabular-nums">{totT.toFixed(2)} t{capT ? ` / ${capT.toFixed(1)} t` : ""}</span></div>
            {capT ? (
              <div className="h-2 rounded bg-gray-200 mt-1"><div className={`h-2 rounded ${load.over_capacity ? "bg-red-500" : pct > 90 ? "bg-amber-400" : "bg-[#3A6B8C]"}`} style={{ width: `${pct}%` }} /></div>
            ) : <div className="text-xs text-gray-500 mt-1">Pick a vehicle with a capacity to check the mass.</div>}
            {load.over_capacity && <div className="flex gap-1 text-xs text-red-700 font-bold mt-1"><AlertTriangle className="w-4 h-4" /> Over the vehicle's capacity</div>}
          </div>
        </section>

        {/* panels on the load */}
        <section className="bg-white border border-gray-200 rounded p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold uppercase tracking-[0.15em] text-[#3A6B8C]">Panels on this load ({load.unit_count})</h2>
            <span className="text-xs text-gray-500">Loading order top → bottom. Tip: load the last-erected panels first.</span>
          </div>
          {load.units.length === 0 && <div className="text-sm text-gray-500 mb-3">No panels yet — add them from the list below.</div>}
          <table className="w-full text-sm">
            <tbody>
              {load.units.map((u, i) => (
                <tr key={u.id} className="border-b border-gray-100" data-testid={`onload-${u.label}`}>
                  <td className="py-1.5 pr-2 text-gray-400 w-6 tabular-nums">{i + 1}</td>
                  <td className="py-1.5 pr-2 font-bold"><Link to={`/units/${u.id}`} className="hover:text-[#3A6B8C]">{u.label}</Link></td>
                  <td className="py-1.5 pr-2 text-gray-600 tabular-nums whitespace-nowrap">{fmtMm(u.dims?.width_mm)} × {fmtMm(u.dims?.height_mm)} × {fmtMm(u.dims?.thickness_mm)}</td>
                  <td className="py-1.5 pr-2 tabular-nums font-semibold whitespace-nowrap">{fmtT(u.dims?.weight_kg)}</td>
                  <td className="py-1.5 pr-2 text-gray-600 whitespace-nowrap">{u.erection_seq != null ? `seq ${u.erection_seq}` : ""}{u.yard_location ? ` · ${u.yard_location}` : ""}</td>
                  <td className="py-1.5 pr-2"><StatusChip status={u.status} /></td>
                  <td className="py-1.5 text-right whitespace-nowrap">
                    {canEdit && planned && (
                      <>
                        <Button variant="ghost" size="sm" className="h-7 px-1.5" disabled={i === 0 || !!busy} onClick={() => move(i, -1)} aria-label="Move up"><ArrowUp className="w-4 h-4" /></Button>
                        <Button variant="ghost" size="sm" className="h-7 px-1.5" disabled={i === load.units.length - 1 || !!busy} onClick={() => move(i, 1)} aria-label="Move down"><ArrowDown className="w-4 h-4" /></Button>
                        <Button variant="ghost" size="sm" className="h-7 px-1.5 text-red-600" disabled={!!busy} onClick={() => setUnits(ids().filter((x) => x !== u.id))} aria-label="Remove"><X className="w-4 h-4" /></Button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {canEdit && planned && (
            <div className="mt-5">
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">Available on job {load.job_number} (cast, stripped or in yard, not on another load)</h3>
              {avail.length === 0 ? <div className="text-sm text-gray-500">Nothing available right now.</div> : (
                <div className="flex flex-wrap gap-1.5">
                  {avail.map((u) => (
                    <button key={u.id} type="button" disabled={!!busy} onClick={() => setUnits([...ids(), u.id])}
                      className="border border-gray-300 rounded px-2 py-1 text-xs hover:border-[#3A6B8C] hover:bg-gray-50 text-left" data-testid={`avail-${u.label}`}>
                      <Plus className="w-3 h-3 inline mr-1 text-[#3A6B8C]" /><strong>{u.label}</strong> · {fmtT(u.dims?.weight_kg)}{u.erection_seq != null ? ` · seq ${u.erection_seq}` : ""}{u.yard_location ? ` · ${u.yard_location}` : ""}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      {(load.status_history || []).length > 0 && (
        <section className="bg-white border border-gray-200 rounded p-5 text-sm">
          <h2 className="text-sm font-bold uppercase tracking-[0.15em] text-[#3A6B8C] mb-2">History</h2>
          {[...load.status_history].reverse().map((h, i) => <div key={i} className="text-gray-700"><span className="text-gray-500 tabular-nums mr-2">{fmtWhen(h.at)}</span><LoadChip status={h.to} /> <span className="text-gray-500">{h.by_user?.name || ""}{h.note ? ` — ${h.note}` : ""}</span></div>)}
        </section>
      )}

      <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirm === "delete" ? `Delete ${load.docket_number}?` : confirm === "loaded" ? "Mark this load as loaded?" : "Mark this load as delivered?"}</DialogTitle>
            <DialogDescription>{confirm === "delete" ? "The panels go back to being available. Nothing else changes." : `Every panel on it will be marked ${confirm} as well.`}</DialogDescription>
          </DialogHeader>
          {confirm !== "delete" && <F label="Date"><Input type="date" value={when} onChange={(e) => setWhen(e.target.value)} className="h-10" /></F>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)}>Cancel</Button>
            {confirm === "delete" ? <Button onClick={del} className="bg-red-600 text-white hover:bg-red-700">Delete load</Button>
              : <Button onClick={() => transition(confirm)} disabled={!!busy} className="bg-[#F5C518] text-[#1F2A33] font-bold hover:bg-[#E0B416]" data-testid="load-confirm">{busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Confirm</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function F({ label, children }) {
  return <div><Label className="text-xs uppercase tracking-wider text-[#3A6B8C] font-bold">{label}</Label><div className="mt-1">{children}</div></div>;
}
