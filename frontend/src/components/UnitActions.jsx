import { useEffect, useState } from "react";
import { Loader2, Undo2, Ban, AlertTriangle, Camera, ArrowRight, Check } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiErrorDetail } from "../lib/api";
import { ACTION_VERB, UNIT_STATUS, UNIT_STATUS_ORDER, todayISO } from "../lib/production";
import { useAuth } from "../contexts/AuthContext";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "./ui/dialog";

/*
 * UnitActions — the buttons that move one physical panel through the yard,
 * plus the small dialogs behind them (pour log, yard location, undo, reject,
 * defect, photo). `unit` is a unit detail object; `onChange(unit)` receives
 * the updated unit after every action.
 *
 * `compact` shows only the next-step button (for tables).
 */
const SHORT_VERB = { cast: "Cast", stripped: "Strip", in_yard: "To yard", loaded: "Load", delivered: "Deliver", installed: "Install" };

export default function UnitActions({ unit, onChange, compact = false, big = false }) {
  const { hasPerm } = useAuth();
  const canMove = hasPerm("production.transition");
  const [dlg, setDlg] = useState(null);   // "next" | "undo" | "reject" | "defect" | "photo" | "jump"
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({});
  const [knownLocations, setKnownLocations] = useState([]);

  const next = unit?.next_status;
  const locked = !canMove || unit?.status === "rejected" || unit?.job?.status === "cancelled";

  useEffect(() => {
    if (dlg === "next" && (form.to === "in_yard")) {
      api.get("/settings/production").then((r) => setKnownLocations(r.data.yard_locations || [])).catch(() => {});
    }
  }, [dlg, form.to]);

  const open = (kind, to) => {
    setForm({ to: to || next, at: todayISO(), note: "", yard_location: unit?.yard_location || "", pour: { supplier: "", docket_no: "", batch_no: "", concrete_grade: unit?.panel?.concrete_grade || "", slump_mm: "", cylinder_ids: "", poured_m3: unit?.dims?.volume_m3 ?? "", notes: "" }, severity: "minor", description: "", caption: "", file: null });
    setDlg(kind);
  };

  const run = async (fn, okMsg) => {
    setBusy(true);
    try {
      const { data } = await fn();
      onChange?.(data);
      toast.success(okMsg);
      setDlg(null);
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail));
    } finally { setBusy(false); }
  };

  const doTransition = () => {
    const body = { to: form.to, note: form.note, at: form.at || null };
    if (form.to === "cast") {
      const p = { ...form.pour };
      ["slump_mm", "poured_m3"].forEach((k) => { p[k] = p[k] === "" || p[k] == null ? null : Number(p[k]); });
      body.pour = p;
    }
    if (form.to === "in_yard") body.yard_location = form.yard_location;
    return run(() => api.post(`/units/${unit.id}/transition`, body), `${unit.label} → ${UNIT_STATUS[form.to].label}`);
  };

  const sz = big ? "h-14 text-base" : "h-9";
  if (!unit) return null;

  return (
    <>
      <div className={`flex flex-wrap gap-2 ${big ? "flex-col" : ""}`}>
        {next && !locked && (compact ? (
          <Button onClick={() => open("next")} size="sm" title={ACTION_VERB[next]} className="h-7 px-2 bg-[#F5C518] text-[#1F2A33] font-bold hover:bg-[#E0B416] text-[11px]" data-testid="unit-next-btn">
            <Check className="w-3 h-3 mr-1" /> {SHORT_VERB[next]}
          </Button>
        ) : (
          <Button onClick={() => open("next")} className={`bg-[#F5C518] text-[#1F2A33] font-bold hover:bg-[#E0B416] ${sz}`} data-testid="unit-next-btn">
            <ArrowRight className="w-4 h-4 mr-2" /> {ACTION_VERB[next]}
          </Button>
        ))}
        {!compact && !locked && (
          <>
            {next && next !== "installed" && (
              <Button variant="outline" onClick={() => open("jump", "installed")} className={`${sz}`} data-testid="unit-jump-btn">Skip to another step…</Button>
            )}
            {(unit.status_history || []).length > 0 && (
              <Button variant="outline" onClick={() => open("undo")} className={`${sz} text-gray-700`} data-testid="unit-undo-btn"><Undo2 className="w-4 h-4 mr-2" /> Undo last step</Button>
            )}
            <Button variant="outline" onClick={() => open("defect")} className={`${sz} border-amber-400 text-amber-800`} data-testid="unit-defect-btn"><AlertTriangle className="w-4 h-4 mr-2" /> Record defect</Button>
            <Button variant="outline" onClick={() => open("photo")} className={`${sz}`} data-testid="unit-photo-btn"><Camera className="w-4 h-4 mr-2" /> Add photo</Button>
            {!["delivered", "installed"].includes(unit.status) && (
              <Button variant="outline" onClick={() => open("reject")} className={`${sz} border-red-300 text-red-700`} data-testid="unit-reject-btn"><Ban className="w-4 h-4 mr-2" /> Reject panel</Button>
            )}
          </>
        )}
        {!compact && unit.status === "rejected" && canMove && (
          <Button variant="outline" onClick={() => open("undo")} className={sz}><Undo2 className="w-4 h-4 mr-2" /> Undo rejection</Button>
        )}
      </div>

      {/* ---- next step / jump ---- */}
      <Dialog open={dlg === "next" || dlg === "jump"} onOpenChange={(o) => !o && setDlg(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{unit.label}: {dlg === "jump" ? "skip to a step" : ACTION_VERB[form.to] || form.to}</DialogTitle>
            <DialogDescription>Recorded against your name with the date below.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {dlg === "jump" && (
              <F label="Step">
                <Select value={form.to} onValueChange={(v) => setForm((f) => ({ ...f, to: v }))}>
                  <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {UNIT_STATUS_ORDER.slice(UNIT_STATUS_ORDER.indexOf(unit.status) + 1)
                      .map((s) => <SelectItem key={s} value={s}>{UNIT_STATUS[s].label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </F>
            )}
            <F label="Date"><Input type="date" value={form.at} onChange={(e) => setForm((f) => ({ ...f, at: e.target.value }))} className="h-10" /></F>
            {form.to === "cast" && (
              <div className="border rounded p-3 space-y-2 bg-gray-50">
                <div className="text-xs font-bold uppercase tracking-wider text-[#3A6B8C]">Pour log (optional)</div>
                <div className="grid grid-cols-2 gap-2">
                  <F label="Concrete supplier"><Input value={form.pour.supplier} onChange={(e) => setPour(setForm, "supplier", e.target.value)} className="h-9" /></F>
                  <F label="Docket no."><Input value={form.pour.docket_no} onChange={(e) => setPour(setForm, "docket_no", e.target.value)} className="h-9" /></F>
                  <F label="Batch no."><Input value={form.pour.batch_no} onChange={(e) => setPour(setForm, "batch_no", e.target.value)} className="h-9" /></F>
                  <F label="Grade"><Input value={form.pour.concrete_grade} onChange={(e) => setPour(setForm, "concrete_grade", e.target.value)} className="h-9" /></F>
                  <F label="Slump (mm)"><Input type="number" value={form.pour.slump_mm} onChange={(e) => setPour(setForm, "slump_mm", e.target.value)} className="h-9" /></F>
                  <F label="Poured (m³)"><Input type="number" step="0.01" value={form.pour.poured_m3} onChange={(e) => setPour(setForm, "poured_m3", e.target.value)} className="h-9" /></F>
                  <div className="col-span-2"><F label="Test cylinder IDs"><Input value={form.pour.cylinder_ids} onChange={(e) => setPour(setForm, "cylinder_ids", e.target.value)} placeholder="e.g. C-101, C-102" className="h-9" /></F></div>
                </div>
              </div>
            )}
            {form.to === "in_yard" && (
              <F label="Yard location (bay / row)">
                <Input list="yard-locs" value={form.yard_location} onChange={(e) => setForm((f) => ({ ...f, yard_location: e.target.value }))} placeholder="e.g. Bay 3" className="h-10" data-testid="unit-yard-loc" />
                <datalist id="yard-locs">{knownLocations.map((l) => <option key={l} value={l} />)}</datalist>
              </F>
            )}
            <F label="Note (optional)"><Textarea rows={2} value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} /></F>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDlg(null)}>Cancel</Button>
            <Button onClick={doTransition} disabled={busy} className="bg-[#F5C518] text-[#1F2A33] font-bold hover:bg-[#E0B416]" data-testid="unit-confirm-btn">
              {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} {ACTION_VERB[form.to] || "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- undo ---- */}
      <Dialog open={dlg === "undo"} onOpenChange={(o) => !o && setDlg(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Undo the last step for {unit.label}?</DialogTitle>
            <DialogDescription>It goes back to the previous status. Say why, for the record.</DialogDescription></DialogHeader>
          <F label="Reason *"><Textarea rows={2} value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} /></F>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDlg(null)}>Cancel</Button>
            <Button disabled={busy || (form.note || "").trim().length < 3} onClick={() => run(() => api.post(`/units/${unit.id}/revert`, { note: form.note }), "Step undone")} className="bg-[#1F2A33] text-white">Undo</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- reject ---- */}
      <Dialog open={dlg === "reject"} onOpenChange={(o) => !o && setDlg(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reject {unit.label}?</DialogTitle>
            <DialogDescription>Use this for a panel that can't be used. It is taken off any load and no longer counts in production. You can undo it.</DialogDescription></DialogHeader>
          <F label="Reason *"><Textarea rows={3} value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} /></F>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDlg(null)}>Cancel</Button>
            <Button disabled={busy || (form.note || "").trim().length < 3} onClick={() => run(() => api.post(`/units/${unit.id}/reject`, { reason: form.note }), `${unit.label} rejected`)} className="bg-red-600 text-white hover:bg-red-700">Reject panel</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- defect ---- */}
      <Dialog open={dlg === "defect"} onOpenChange={(o) => !o && setDlg(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Record a defect on {unit.label}</DialogTitle>
            <DialogDescription>Chips, blowholes, cracks, wrong cast-ins… It stays open until someone marks it repaired or accepted.</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <F label="What's wrong *"><Textarea rows={3} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} data-testid="defect-desc" /></F>
            <F label="Severity">
              <Select value={form.severity} onValueChange={(v) => setForm((f) => ({ ...f, severity: v }))}>
                <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="minor">Minor (cosmetic)</SelectItem><SelectItem value="major">Major (needs engineer / customer sign-off)</SelectItem><SelectItem value="reject">Reject candidate</SelectItem></SelectContent>
              </Select>
            </F>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDlg(null)}>Cancel</Button>
            <Button disabled={busy || (form.description || "").trim().length < 2} onClick={() => run(() => api.post(`/units/${unit.id}/defects`, { description: form.description, severity: form.severity }), "Defect recorded")} className="bg-[#1F2A33] text-white" data-testid="defect-save">Save defect</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- photo ---- */}
      <Dialog open={dlg === "photo"} onOpenChange={(o) => !o && setDlg(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add a photo of {unit.label}</DialogTitle><DialogDescription>On a phone you can take the photo straight from the camera.</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <F label="Photo"><Input type="file" accept="image/*" capture="environment" onChange={(e) => setForm((f) => ({ ...f, file: e.target.files?.[0] || null }))} className="h-11" data-testid="photo-file" /></F>
            <F label="Caption"><Input value={form.caption} onChange={(e) => setForm((f) => ({ ...f, caption: e.target.value }))} className="h-10" /></F>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDlg(null)}>Cancel</Button>
            <Button disabled={busy || !form.file} className="bg-[#1F2A33] text-white" data-testid="photo-save"
              onClick={() => { const fd = new FormData(); fd.append("file", form.file); fd.append("caption", form.caption || ""); return run(() => api.post(`/units/${unit.id}/photos`, fd), "Photo added"); }}>
              {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Upload
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function setPour(setForm, k, v) { setForm((f) => ({ ...f, pour: { ...f.pour, [k]: v } })); }

function F({ label, children }) {
  return <div><Label className="text-xs uppercase tracking-wider text-[#3A6B8C] font-bold">{label}</Label><div className="mt-1">{children}</div></div>;
}
