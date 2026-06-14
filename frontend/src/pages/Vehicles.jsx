import { useEffect, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { Loader2, Plus, ArrowLeft, Save, Trash2 } from "lucide-react";
import { api, formatApiErrorDetail } from "../lib/api";
import { useAuth } from "../contexts/AuthContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Toaster, toast } from "sonner";

const STATUS_OPTIONS = [
  { value: "available", label: "Available" },
  { value: "on_delivery", label: "On Delivery" },
  { value: "maintenance", label: "Maintenance" },
  { value: "out_of_service", label: "Out of Service" },
];
const SOURCE_BADGE = {
  MANUAL: "bg-gray-100 text-gray-700",
  MOCKED_NAVIXY: "bg-yellow-100 text-yellow-800",
  NAVIXY: "bg-green-100 text-green-800",
};

export function VehiclesList() {
  const { hasPerm } = useAuth();
  const [items, setItems] = useState(null);
  const [statusFilter, setStatusFilter] = useState("active");
  const navigate = useNavigate();
  const load = async () => {
    setItems(null);
    try {
      const { data } = await api.get(`/vehicles?status=${statusFilter}`);
      setItems(data);
    } catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [statusFilter]);

  return (
    <div className="space-y-5" data-testid="vehicles-page">
      <Toaster richColors position="top-right"/>
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <div className="overline">Fleet</div>
          <h1 className="text-3xl md:text-4xl font-black tracking-tighter text-[#1F2A33]">Vehicles</h1>
          <p className="text-sm text-gray-500 mt-1">Manual fleet. Live Navixy sync coming in Phase 4 Part 2.</p>
        </div>
        {hasPerm("vehicles.create") && (
          <Button onClick={() => navigate("/vehicles/new")} className="bg-[#F5C518] text-[#1F2A33] font-bold hover:bg-[#E0B416] h-11" data-testid="new-vehicle-btn">
            <Plus className="w-4 h-4 mr-2"/> New Vehicle
          </Button>
        )}
      </div>
      <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 text-xs px-4 py-2 rounded">
        Currently MANUAL. Will sync from Navixy in Phase 4 Part 2.
      </div>
      <div className="inline-flex rounded border border-gray-200 bg-white p-0.5 text-xs">
        {[["active","Active"],["inactive","Inactive"],["deleted","Deleted"],["all","All"]].map(([k,l])=>(
          <button key={k} onClick={() => setStatusFilter(k)} data-testid={`veh-filter-${k}`}
            className={`px-3 py-1.5 rounded font-semibold ${statusFilter===k ? "bg-[#1F2A33] text-white" : "text-gray-600 hover:bg-gray-50"}`}>{l}</button>
        ))}
      </div>
      <div className="bg-white border border-gray-200 rounded overflow-hidden">
        {items === null ? <div className="p-6 text-sm text-gray-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin"/> Loading…</div>
         : items.length === 0 ? <div className="p-6 text-sm text-gray-500">No vehicles in this view.</div>
         : (
        <table className="w-full text-sm">
          <thead className="bg-[#3A6B8C] text-white uppercase text-[10px] tracking-wider">
            <tr><th className="px-4 py-3 text-left">Code</th><th className="px-4 py-3 text-left">Make / Model</th>
            <th className="px-4 py-3 text-left">Rego</th><th className="px-4 py-3 text-right">Capacity</th>
            <th className="px-4 py-3 text-left">Status</th><th className="px-4 py-3 text-left">Source</th></tr>
          </thead>
          <tbody>{items.map(v => (
            <tr key={v.id} onClick={() => navigate(`/vehicles/${v.id}`)}
              className={`border-t border-gray-200 hover:bg-gray-50 cursor-pointer ${v.deleted_at ? "opacity-60" : ""}`}
              data-testid={`vehicle-row-${v.vehicle_code}`}>
              <td className="px-4 py-3 font-mono text-[#1F2A33] font-bold">{v.vehicle_code}{v.deleted_at && <span className="ml-2 text-[10px] text-red-700 italic">(deleted)</span>}</td>
              <td className="px-4 py-3">{v.make_model}</td>
              <td className="px-4 py-3 text-gray-600">{v.rego || "—"}</td>
              <td className="px-4 py-3 text-right tabular-nums">{v.capacity_tonnes} t</td>
              <td className="px-4 py-3 text-gray-600">{v.status.replace(/_/g," ")}</td>
              <td className="px-4 py-3"><span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${SOURCE_BADGE[v.source] || "bg-gray-100"}`}>{v.source}</span></td>
            </tr>))}
          </tbody>
        </table>)}
      </div>
    </div>
  );
}

export function VehicleForm() {
  const { id } = useParams();
  const isNew = !id || id === "new";
  const navigate = useNavigate();
  const { hasPerm } = useAuth();
  const [form, setForm] = useState({ vehicle_code:"", make_model:"", rego:"", capacity_tonnes:0, status:"available", notes:"" });
  const [loading, setLoading] = useState(!isNew);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (isNew) return;
    api.get(`/vehicles/${id}`).then(({ data }) => { setForm(data); setLoading(false); })
      .catch(e => { toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message); setLoading(false); });
  }, [id, isNew]);

  const save = async (e) => {
    e.preventDefault(); setBusy(true);
    try {
      const payload = { vehicle_code: form.vehicle_code, make_model: form.make_model, rego: form.rego, capacity_tonnes: parseFloat(form.capacity_tonnes)||0, status: form.status, notes: form.notes };
      if (isNew) await api.post("/vehicles", payload);
      else await api.patch(`/vehicles/${id}`, payload);
      toast.success(isNew ? "Vehicle created" : "Vehicle updated");
      navigate("/vehicles");
    } catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!window.confirm(`Delete vehicle ${form.vehicle_code}? You can restore from the Deleted filter.`)) return;
    try { await api.delete(`/vehicles/${id}`); toast.success("Vehicle deleted"); navigate("/vehicles"); }
    catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message); }
  };

  if (loading) return <div className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="w-4 h-4 animate-spin"/> Loading…</div>;
  return (
    <div className="max-w-2xl space-y-5" data-testid="vehicle-form-page">
      <Toaster richColors position="top-right"/>
      <Link to="/vehicles" className="text-xs uppercase tracking-wider text-[#3A6B8C] hover:text-[#1F2A33] inline-flex items-center gap-1"><ArrowLeft className="w-3 h-3"/> Back to vehicles</Link>
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="overline">{isNew ? "New" : form.vehicle_code}</div>
          <h1 className="text-3xl font-black tracking-tighter text-[#1F2A33]">{isNew ? "Create vehicle" : form.make_model}</h1>
        </div>
        {!isNew && hasPerm("vehicles.delete") && !form.deleted_at && (
          <Button variant="outline" onClick={remove} className="border-red-300 text-red-700 hover:bg-red-50" data-testid="vehicle-delete-btn">
            <Trash2 className="w-4 h-4 mr-2"/> Delete
          </Button>
        )}
      </div>
      <form onSubmit={save} className="space-y-3 bg-white border border-gray-200 rounded p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div><Label>Vehicle Code *</Label><Input value={form.vehicle_code} required placeholder="e.g. V-006" onChange={(e)=>setForm({...form, vehicle_code:e.target.value})} data-testid="veh-code"/></div>
          <div><Label>Make / Model</Label><Input value={form.make_model} required onChange={(e)=>setForm({...form, make_model:e.target.value})} data-testid="veh-make-model"/></div>
          <div><Label>Rego</Label><Input value={form.rego} onChange={(e)=>setForm({...form, rego:e.target.value})} data-testid="veh-rego"/></div>
          <div><Label>Capacity (tonnes)</Label><Input type="number" step="0.1" value={form.capacity_tonnes} onChange={(e)=>setForm({...form, capacity_tonnes:e.target.value})} data-testid="veh-capacity"/></div>
          <div><Label>Status</Label>
            <Select value={form.status} onValueChange={(v)=>setForm({...form, status:v})}>
              <SelectTrigger data-testid="veh-status"><SelectValue/></SelectTrigger>
              <SelectContent>{STATUS_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <div><Label>Notes</Label><Textarea value={form.notes} onChange={(e)=>setForm({...form, notes:e.target.value})} data-testid="veh-notes"/></div>
        <div className="flex justify-end gap-2">
          {!isNew && <span className="text-xs text-gray-500 mr-auto">Source: <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${SOURCE_BADGE[form.source]||"bg-gray-100"}`}>{form.source}</span></span>}
          <Button type="submit" disabled={busy} className="bg-[#F5C518] text-[#1F2A33] font-bold hover:bg-[#E0B416]" data-testid="veh-save">
            {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin"/> : <Save className="w-4 h-4 mr-2"/>} {isNew ? "Create" : "Save"}
          </Button>
        </div>
      </form>
    </div>
  );
}

export default VehiclesList;
