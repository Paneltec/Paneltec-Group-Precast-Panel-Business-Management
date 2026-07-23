import { useEffect, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { Loader2, Plus, ArrowLeft, Save, Trash2 } from "lucide-react";
import AppIcon from "../components/AppIcon";
import { api, formatApiErrorDetail } from "../lib/api";
import { useAuth } from "../contexts/AuthContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "../components/ui/dialog";
import { Toaster, toast } from "sonner";
import { formatDateTime } from "../lib/format";

const SOURCE_BADGE = {
  MANUAL: "bg-gray-100 text-gray-700",
  MOCKED_SIMPRO: "bg-yellow-100 text-yellow-800",
  SIMPRO: "bg-purple-100 text-purple-800",
};

export function EmployeesList() {
  const { hasPerm } = useAuth();
  const [items, setItems] = useState(null);
  const [statusFilter, setStatusFilter] = useState("active");
  const [simpro, setSimpro] = useState(null);       // integration_settings.simpro (or null while loading)
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);  // {synced, created, updated, errors[]}
  const navigate = useNavigate();

  const load = async () => {
    setItems(null);
    try { const { data } = await api.get(`/employees?status=${statusFilter}`); setItems(data); }
    catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message); }
  };
  const loadSimpro = async () => {
    if (!hasPerm("integrations.view")) { setSimpro({ enabled: false, _no_perm: true }); return; }
    try { const { data } = await api.get("/settings/integrations"); setSimpro(data?.simpro || { enabled: false }); }
    catch (_e) { setSimpro({ enabled: false }); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [statusFilter]);
  useEffect(() => { loadSimpro(); /* eslint-disable-next-line */ }, []);

  const runSync = async () => {
    setSyncing(true); setSyncResult(null);
    try {
      const { data } = await api.post("/integrations/simpro/sync-employees");
      setSyncResult(data);
      toast.success(`Synced ${data.synced} employees (${data.created} new, ${data.updated} updated)`);
      await Promise.all([load(), loadSimpro()]);
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message);
      setSyncResult({ error: formatApiErrorDetail(e.response?.data?.detail) || e.message });
    } finally { setSyncing(false); }
  };

  const simproEnabled = !!(simpro && simpro.enabled);
  const simproConfigured = simproEnabled && !!(simpro.build_name && simpro.client_id);
  const lastSyncOk = simpro?.last_sync_status === "ok" && simpro?.last_sync_at;
  const canSync = hasPerm("integrations.edit") && hasPerm("employees.create") && simproConfigured;

  return (
    <div className="space-y-5" data-testid="employees-page">
      <Toaster richColors position="top-right"/>
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <div className="overline">Crew</div>
          <h1 className="text-3xl md:text-4xl font-black tracking-tighter text-[#1F2A33]">Employees</h1>
          <p className="text-sm text-gray-500 mt-1">
            {simproEnabled ? "Live Simpro sync configured. Records can be pulled from Simpro on demand." : "Manual roster. Enable Simpro in Settings → Integrations to sync automatically."}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {canSync && (
            <Button onClick={runSync} disabled={syncing} className="bg-purple-600 text-white font-bold hover:bg-purple-700 h-11" data-testid="simpro-sync-employees-btn">
              {syncing ? <Loader2 className="w-4 h-4 mr-2 animate-spin"/> : <AppIcon name="upload" size={16} className="mr-2" decorative/>}
              Sync from Simpro
            </Button>
          )}
          {hasPerm("employees.create") && (
            <Button onClick={() => navigate("/employees/new")} className="bg-[#F5C518] text-[#1F2A33] font-bold hover:bg-[#E0B416] h-11" data-testid="new-employee-btn">
              <AppIcon name="add" size={16} className="mr-1" decorative/> New Employee
            </Button>
          )}
        </div>
      </div>

      {/* Sync-status banner */}
      {simpro === null ? null : !simproEnabled ? (
        <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 text-xs px-4 py-2 rounded" data-testid="employees-banner-mocked">
          Currently MANUAL. Enable Simpro in Settings → Integrations and click "Sync from Simpro" to pull the live roster.
        </div>
      ) : !simproConfigured ? (
        <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 text-xs px-4 py-2 rounded" data-testid="employees-banner-not-configured">
          Simpro enabled but credentials are incomplete. Finish setup in Settings → Integrations, then click Sync.
        </div>
      ) : !lastSyncOk ? (
        <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 text-xs px-4 py-2 rounded" data-testid="employees-banner-not-synced">
          Simpro enabled but not yet synced. {canSync && "Click Sync from Simpro to pull the roster."}
        </div>
      ) : (
        <div className="bg-green-50 border border-green-200 text-green-800 text-xs px-4 py-2 rounded" data-testid="employees-banner-live">
          <span className="font-bold">LIVE</span> · Synced from Simpro {formatDateTime(simpro.last_sync_at)} · {simpro.last_sync_employees_count || 0} employees
        </div>
      )}

      <div className="inline-flex rounded border border-gray-200 bg-white p-0.5 text-xs">
        {[["active","Active"],["inactive","Inactive"],["deleted","Deleted"],["all","All"]].map(([k,l])=>(
          <button key={k} onClick={() => setStatusFilter(k)} data-testid={`emp-filter-${k}`}
            className={`px-3 py-1.5 rounded font-semibold ${statusFilter===k ? "bg-[#1F2A33] text-white" : "text-gray-600 hover:bg-gray-50"}`}>{l}</button>
        ))}
      </div>
      <div className="bg-white border border-gray-200 rounded overflow-hidden">
        {items === null ? <div className="p-6 text-sm text-gray-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin"/> Loading…</div>
         : items.length === 0 ? <div className="p-6 text-sm text-gray-500">No employees in this view.</div>
         : (
        <table className="w-full text-sm">
          <thead className="bg-[#3A6B8C] text-white uppercase text-[10px] tracking-wider">
            <tr><th className="px-4 py-3 text-left">Name</th><th className="px-4 py-3 text-left">Role</th>
            <th className="px-4 py-3 text-left">Email</th><th className="px-4 py-3 text-left">Phone</th>
            <th className="px-4 py-3 text-left">Source</th></tr>
          </thead>
          <tbody>{items.map(e => (
            <tr key={e.id} onClick={() => navigate(`/employees/${e.id}`)}
              className={`border-t border-gray-200 hover:bg-gray-50 cursor-pointer ${e.deleted_at ? "opacity-60" : ""}`}
              data-testid={`employee-row-${e.id}`}>
              <td className="px-4 py-3 font-semibold text-[#1F2A33]">
                {e.name}
                {e.source === "SIMPRO" && (
                  <span className="ml-2 text-[10px] font-bold uppercase tracking-wider bg-purple-100 text-purple-800 px-1.5 py-0.5 rounded" data-testid={`simpro-chip-${e.id}`}>Simpro</span>
                )}
                {e.deleted_at && <span className="ml-2 text-[10px] text-red-700 italic">(deleted)</span>}
              </td>
              <td className="px-4 py-3 text-gray-600">{e.role || "—"}</td>
              <td className="px-4 py-3 text-gray-600 text-xs">{e.email || "—"}</td>
              <td className="px-4 py-3 text-gray-600 text-xs">{e.phone || "—"}</td>
              <td className="px-4 py-3"><span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${SOURCE_BADGE[e.source]||"bg-gray-100"}`}>{e.source}</span></td>
            </tr>))}
          </tbody>
        </table>)}
      </div>

      {/* Sync result modal */}
      <Dialog open={!!syncResult} onOpenChange={(v) => !v && setSyncResult(null)}>
        <DialogContent data-testid="simpro-sync-result">
          <DialogHeader>
            <DialogTitle className="inline-flex items-center gap-2">
              <AppIcon name={syncResult?.error ? "warning" : "success"} size={22} decorative/>
              {syncResult?.error ? "Simpro sync failed" : "Simpro sync complete"}
            </DialogTitle>
            <DialogDescription>
              {syncResult?.error ? syncResult.error :
                `Fetched ${syncResult?.fetched_from_simpro} from Simpro · created ${syncResult?.created} · updated ${syncResult?.updated}${(syncResult?.errors?.length||0) ? ` · ${syncResult.errors.length} row error(s)` : ""}.`}
            </DialogDescription>
          </DialogHeader>
          {(syncResult?.errors?.length||0) > 0 && (
            <div className="text-xs bg-amber-50 border border-amber-200 rounded p-2 max-h-40 overflow-auto space-y-1">
              {syncResult.errors.slice(0, 10).map((e, i) => (<div key={i}><strong>#{e.simpro_id}</strong> — {e.reason}</div>))}
              {syncResult.errors.length > 10 && <div className="italic">+{syncResult.errors.length - 10} more</div>}
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setSyncResult(null)} className="bg-[#1F2A33] text-white hover:bg-[#3A6B8C]">Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function EmployeeForm() {
  const { id } = useParams();
  const isNew = !id || id === "new";
  const navigate = useNavigate();
  const { hasPerm } = useAuth();
  const [form, setForm] = useState({ name:"", role:"", email:"", phone:"", notes:"" });
  const [loading, setLoading] = useState(!isNew);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (isNew) return;
    api.get(`/employees/${id}`).then(({ data }) => { setForm(data); setLoading(false); })
      .catch(e => { toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message); setLoading(false); });
  }, [id, isNew]);

  const save = async (e) => {
    e.preventDefault(); setBusy(true);
    try {
      const payload = { name:form.name, role:form.role, email:form.email, phone:form.phone, notes:form.notes };
      if (isNew) await api.post("/employees", payload);
      else await api.patch(`/employees/${id}`, payload);
      toast.success(isNew ? "Employee created" : "Employee updated");
      navigate("/employees");
    } catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!window.confirm(`Delete ${form.name}? You can restore from the Deleted filter.`)) return;
    try { await api.delete(`/employees/${id}`); toast.success("Employee deleted"); navigate("/employees"); }
    catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message); }
  };

  if (loading) return <div className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="w-4 h-4 animate-spin"/> Loading…</div>;
  return (
    <div className="max-w-2xl space-y-5" data-testid="employee-form-page">
      <Toaster richColors position="top-right"/>
      <Link to="/employees" className="text-xs uppercase tracking-wider text-[#3A6B8C] hover:text-[#1F2A33] inline-flex items-center gap-1"><ArrowLeft className="w-3 h-3"/> Back to employees</Link>
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="overline">{isNew ? "New" : "Edit"}</div>
          <h1 className="text-3xl font-black tracking-tighter text-[#1F2A33]">{isNew ? "Create employee" : form.name}</h1>
        </div>
        {!isNew && hasPerm("employees.delete") && !form.deleted_at && (
          <Button variant="outline" onClick={remove} className="border-red-300 text-red-700 hover:bg-red-50" data-testid="employee-delete-btn">
            <AppIcon name="delete" size={16} className="mr-2" decorative/> Delete
          </Button>
        )}
      </div>
      <form onSubmit={save} className="space-y-3 bg-white border border-gray-200 rounded p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div><Label>Name</Label><Input value={form.name} required onChange={(e)=>setForm({...form, name:e.target.value})} data-testid="emp-name"/></div>
          <div><Label>Role (e.g. Foreman, Driver)</Label><Input value={form.role} onChange={(e)=>setForm({...form, role:e.target.value})} data-testid="emp-role"/></div>
          <div><Label>Email</Label><Input type="email" value={form.email} onChange={(e)=>setForm({...form, email:e.target.value})} data-testid="emp-email"/></div>
          <div><Label>Phone</Label><Input value={form.phone} onChange={(e)=>setForm({...form, phone:e.target.value})} data-testid="emp-phone"/></div>
        </div>
        <div><Label>Notes</Label><Textarea value={form.notes} onChange={(e)=>setForm({...form, notes:e.target.value})} data-testid="emp-notes"/></div>
        <div className="flex justify-end gap-2">
          {!isNew && <span className="text-xs text-gray-500 mr-auto">Source: <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${SOURCE_BADGE[form.source]||"bg-gray-100"}`}>{form.source}</span></span>}
          <Button type="submit" disabled={busy} className="bg-[#F5C518] text-[#1F2A33] font-bold hover:bg-[#E0B416]" data-testid="emp-save">
            {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin"/> : <AppIcon name="save" size={16} className="mr-2" decorative/>} {isNew ? "Create" : "Save"}
          </Button>
        </div>
      </form>
    </div>
  );
}

export default EmployeesList;
