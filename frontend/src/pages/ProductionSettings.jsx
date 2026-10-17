import { useEffect, useState } from "react";
import { Loader2, Save, Plus, Trash2 } from "lucide-react";
import { Toaster, toast } from "sonner";
import { api, formatApiErrorDetail } from "../lib/api";
import { useAuth } from "../contexts/AuthContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Switch } from "../components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "../components/ui/dialog";

const BLANK_BED = { name: "", length_mm: 12000, width_mm: 3600, active: true, sort_order: 0, notes: "" };

// Casting beds, QR link address, label layout and the list of yard bays.
export default function ProductionSettings() {
  const { hasPerm } = useAuth();
  const canBeds = hasPerm("production.edit");
  const canSettings = hasPerm("company.edit");
  const [beds, setBeds] = useState(null);
  const [settings, setSettings] = useState(null);
  const [bedDlg, setBedDlg] = useState(null);     // bed being edited (object) or null
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [locText, setLocText] = useState("");

  const load = async () => {
    try {
      const [{ data: b }, { data: s }] = await Promise.all([api.get("/production/beds", { params: { include_inactive: true } }), api.get("/settings/production")]);
      setBeds(b.items); setSettings(s); setLocText((s.yard_locations || []).join("\n"));
    } catch (e) { setErr(formatApiErrorDetail(e.response?.data?.detail)); }
  };
  useEffect(() => { load(); }, []);

  const saveBed = async () => {
    setBusy("bed");
    try {
      const body = { ...bedDlg, length_mm: Number(bedDlg.length_mm), width_mm: Number(bedDlg.width_mm), sort_order: Number(bedDlg.sort_order) || 0 };
      if (bedDlg.id) await api.patch(`/production/beds/${bedDlg.id}`, body); else await api.post("/production/beds", body);
      toast.success("Bed saved"); setBedDlg(null); load();
    } catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail)); }
    finally { setBusy(""); }
  };
  const deleteBed = async (b) => {
    if (!window.confirm(`Remove ${b.name}? Planned panels on it keep their date but lose the bed.`)) return;
    try { await api.delete(`/production/beds/${b.id}`); toast.success("Bed removed"); load(); }
    catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail)); }
  };
  const saveSettings = async () => {
    setBusy("settings");
    try {
      const { data } = await api.put("/settings/production", { ...settings, yard_locations: locText.split("\n").map((x) => x.trim()).filter(Boolean) });
      setSettings(data); setLocText((data.yard_locations || []).join("\n")); toast.success("Production settings saved");
    } catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail)); }
    finally { setBusy(""); }
  };

  if (err) return <div className="text-sm text-red-700">{err}</div>;
  if (!beds || !settings) return <div className="flex items-center gap-2 text-gray-500 text-sm"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>;

  return (
    <div className="max-w-5xl space-y-6" data-testid="production-settings">
      <Toaster richColors position="top-right" />
      <div>
        <div className="overline">Settings</div>
        <h1 className="text-3xl md:text-4xl font-black tracking-tighter text-[#1F2A33]">Production Settings</h1>
        <p className="text-sm text-gray-500 mt-1">Casting beds for the schedule, the address QR codes point to, label size, and your yard bays.</p>
      </div>

      <section className="bg-white border border-gray-200 rounded p-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold uppercase tracking-[0.15em] text-[#3A6B8C]">Casting beds</h2>
          {canBeds && <Button onClick={() => setBedDlg({ ...BLANK_BED, sort_order: beds.length + 1 })} className="bg-[#3A6B8C] text-white hover:bg-[#2C526B] h-9" data-testid="bed-add"><Plus className="w-4 h-4 mr-1" /> Add bed</Button>}
        </div>
        {beds.length === 0 ? <p className="text-sm text-gray-500">No beds yet. Add each casting bed or table with its usable length — the schedule warns when a day's panels won't fit.</p> : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-[10px] uppercase tracking-wider text-gray-600 border-b"><tr><th className="px-3 py-2 text-left">Order</th><th className="px-3 py-2 text-left">Name</th><th className="px-3 py-2 text-right">Length</th><th className="px-3 py-2 text-right">Width</th><th className="px-3 py-2 text-left">Active</th><th className="px-3 py-2 text-left">Notes</th><th /></tr></thead>
            <tbody>
              {beds.map((b) => (
                <tr key={b.id} className="border-b border-gray-100">
                  <td className="px-3 py-2 tabular-nums text-gray-500">{b.sort_order}</td>
                  <td className="px-3 py-2 font-bold">{b.name}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{(b.length_mm / 1000).toFixed(1)} m</td>
                  <td className="px-3 py-2 text-right tabular-nums">{(b.width_mm / 1000).toFixed(1)} m</td>
                  <td className="px-3 py-2">{b.active ? "Yes" : "No"}</td>
                  <td className="px-3 py-2 text-gray-600">{b.notes}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {canBeds && <><Button variant="ghost" size="sm" className="h-8" onClick={() => setBedDlg({ ...b })}>Edit</Button>
                      <Button variant="ghost" size="sm" className="h-8 text-red-600" onClick={() => deleteBed(b)}><Trash2 className="w-4 h-4" /></Button></>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="bg-white border border-gray-200 rounded p-6 space-y-4">
        <h2 className="text-sm font-bold uppercase tracking-[0.15em] text-[#3A6B8C]">QR codes &amp; labels</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <F label="App address printed in QR codes">
            <Input value={settings.app_url} onChange={(e) => setSettings((s) => ({ ...s, app_url: e.target.value }))} placeholder="e.g. http://192.168.15.165:3960" disabled={!canSettings} className="h-11" data-testid="app-url" />
            <p className="text-xs text-gray-500 mt-1">Leave blank to use whatever address you're on when printing. Set it if phones in the yard use a different address (e.g. a Tailscale or domain name).</p>
          </F>
          <F label="Label sheet layout">
            <Select value={settings.label_layout} onValueChange={(v) => setSettings((s) => ({ ...s, label_layout: v }))} disabled={!canSettings}>
              <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="a4_8">8 per A4 sheet (95 × 67 mm)</SelectItem><SelectItem value="a4_2">2 per A4 sheet (190 × 135 mm, big)</SelectItem></SelectContent>
            </Select>
          </F>
        </div>
        <F label="Yard bays / rows (one per line — offered as suggestions when moving panels)">
          <textarea rows={6} value={locText} onChange={(e) => setLocText(e.target.value)} disabled={!canSettings} className="w-full border border-gray-300 rounded p-2 text-sm font-mono" placeholder={"Bay 1\nBay 2\nRow A"} />
        </F>
        {canSettings && <Button onClick={saveSettings} disabled={busy === "settings"} className="bg-[#F5C518] text-[#1F2A33] font-bold hover:bg-[#E0B416] h-11 px-6" data-testid="prod-settings-save">{busy === "settings" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />} Save settings</Button>}
      </section>

      <Dialog open={!!bedDlg} onOpenChange={(o) => !o && setBedDlg(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{bedDlg?.id ? `Edit ${bedDlg.name}` : "New casting bed"}</DialogTitle><DialogDescription>Usable length is what the schedule checks against (panels plus a 300 mm gap each).</DialogDescription></DialogHeader>
          {bedDlg && (
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2"><F label="Name *"><Input value={bedDlg.name} onChange={(e) => setBedDlg((b) => ({ ...b, name: e.target.value }))} className="h-10" data-testid="bed-name" /></F></div>
              <F label="Usable length (mm)"><Input type="number" value={bedDlg.length_mm} onChange={(e) => setBedDlg((b) => ({ ...b, length_mm: e.target.value }))} className="h-10" /></F>
              <F label="Width (mm)"><Input type="number" value={bedDlg.width_mm} onChange={(e) => setBedDlg((b) => ({ ...b, width_mm: e.target.value }))} className="h-10" /></F>
              <F label="Order on the board"><Input type="number" value={bedDlg.sort_order} onChange={(e) => setBedDlg((b) => ({ ...b, sort_order: e.target.value }))} className="h-10" /></F>
              <div className="flex items-end gap-2 pb-2"><Switch checked={!!bedDlg.active} onCheckedChange={(v) => setBedDlg((b) => ({ ...b, active: v }))} /> <span className="text-sm">In use</span></div>
              <div className="col-span-2"><F label="Notes"><Input value={bedDlg.notes} onChange={(e) => setBedDlg((b) => ({ ...b, notes: e.target.value }))} className="h-10" /></F></div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setBedDlg(null)}>Cancel</Button>
            <Button onClick={saveBed} disabled={busy === "bed" || !bedDlg?.name?.trim()} className="bg-[#1F2A33] text-white" data-testid="bed-save">{busy === "bed" && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Save bed</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function F({ label, children }) {
  return <div><Label className="text-xs uppercase tracking-wider text-[#3A6B8C] font-bold">{label}</Label><div className="mt-1">{children}</div></div>;
}
