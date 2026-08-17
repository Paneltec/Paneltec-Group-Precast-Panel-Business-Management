import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { Loader2, ArrowLeft, Save, Trash2, CloudDownload, ChevronDown } from "lucide-react";
import AppIcon from "../components/AppIcon";
import { api, formatApiErrorDetail } from "../lib/api";
import { useAuth } from "../contexts/AuthContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import { Checkbox } from "../components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "../components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "../components/ui/alert-dialog";
import SimproEmployeeImportModal from "../components/SimproEmployeeImportModal";
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
  const [simpro, setSimpro] = useState(null);
  const [importOpen, setImportOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);          // single-row confirm
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState(new Set());             // bulk selection (employee ids)
  const [bulkOpen, setBulkOpen] = useState(false);                 // bulk confirm modal
  const [bulkTargetIds, setBulkTargetIds] = useState([]);          // ids to delete (selected OR all-in-view)
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const navigate = useNavigate();

  const load = async () => {
    setItems(null);
    setSelected(new Set());
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

  const activeItems = useMemo(() => (items || []).filter(e => !e.deleted_at), [items]);

  const toggleRow = (id) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };
  const toggleAll = () => {
    const ids = activeItems.map(e => e.id);
    if (ids.every(id => selected.has(id))) setSelected(new Set());
    else setSelected(new Set(ids));
  };

  const openBulkForSelected = () => {
    setBulkTargetIds(Array.from(selected));
    setBulkOpen(true);
  };
  const openBulkForAllInView = () => {
    setBulkTargetIds(activeItems.map(e => e.id));
    setBulkOpen(true);
  };

  const doBulkDelete = async () => {
    if (bulkTargetIds.length === 0) return;
    setBulkDeleting(true);
    try {
      const { data } = await api.post("/employees/bulk-delete",
        { employee_ids: bulkTargetIds });
      toast.success(`Deleted ${data.deleted} employee${data.deleted === 1 ? "" : "s"}.`);
      setBulkOpen(false);
      setSelected(new Set());
      await load();
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message);
    } finally { setBulkDeleting(false); }
  };

  const doDelete = async () => {
    if (!deleteTarget) return;
    try {
      await api.delete(`/employees/${deleteTarget.id}`);
      toast.success(`Deleted ${deleteTarget.name}.`);
      setDeleteTarget(null);
      await load();
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message);
    }
  };

  const runRefresh = async (companyIdsOverride) => {
    setRefreshing(true);
    try {
      const cids = companyIdsOverride ?? (simpro?.company_ids || []).map(Number);
      const { data } = await api.post("/integrations/simpro/sync-employees",
        { company_ids: cids });
      const created = data.created ?? 0;
      const updated = data.updated ?? 0;
      const unchanged = data.unchanged ?? Math.max(0, (data.synced ?? 0) - created - updated);
      toast.success(`Refreshed from Simpro — ${created} added, ${updated} updated, ${unchanged} unchanged.`);
      await Promise.all([load(), loadSimpro()]);
    } catch (e) {
      const msg = formatApiErrorDetail(e.response?.data?.detail) || e.message;
      toast.error(`${msg}${/simpro|token|credential/i.test(msg) ? "" : " · Try Test Connection in Admin Settings → Integrations."}`);
    } finally { setRefreshing(false); }
  };

  const simproEnabled = !!(simpro && simpro.enabled);
  const simproConfigured = simproEnabled && !!(simpro.url && (simpro.company_ids || []).length > 0);
  const lastSyncOk = simpro?.last_sync_status === "ok" && simpro?.last_sync_at;
  const canImport = hasPerm("integrations.edit") && hasPerm("employees.create");
  const canDelete = hasPerm("employees.delete");
  const allSelected = activeItems.length > 0 && activeItems.every(e => selected.has(e.id));
  const someSelected = selected.size > 0 && !allSelected;

  // Phase 11.7.9 — client-side filters (text + position)
  const [textFilter, setTextFilter] = useState("");
  const [positionFilter, setPositionFilter] = useState("__all__");
  const [refreshMenuOpen, setRefreshMenuOpen] = useState(false);
  const knownCompanyNames = simpro?.known_company_names || {};   // best-effort — cached by Test Connection
  const distinctPositions = useMemo(() => {
    const s = new Set();
    (items || []).forEach(e => { if ((e.role || "").trim()) s.add(e.role.trim()); });
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [items]);
  const filteredItems = useMemo(() => {
    const q = textFilter.trim().toLowerCase();
    return (items || []).filter(e => {
      if (positionFilter !== "__all__" && (e.role || "") !== positionFilter) return false;
      if (!q) return true;
      const hay = `${e.name || ""} ${e.email || ""} ${e.phone || ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [items, textFilter, positionFilter]);

  return (
    <div className="space-y-5" data-testid="employees-page">
      <Toaster richColors position="top-right"/>
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <div className="overline">Crew</div>
          <h1 className="text-3xl md:text-4xl font-black tracking-tighter text-[#1F2A33]">Employees</h1>
          <p className="text-sm text-gray-500 mt-1">
            {simproEnabled ? "Live Simpro sync configured. Import employees on demand." : "Manual roster. Enable Simpro in Admin Settings → Integrations to pull from Simpro."}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="flex gap-2 flex-wrap">
            {canImport && (
              <Button onClick={() => setImportOpen(true)}
                      className="bg-[#F5C518] text-[#1F2A33] font-bold hover:bg-[#E0B416] h-11"
                      data-testid="simpro-import-btn">
                <CloudDownload className="w-4 h-4 mr-1.5"/> Import from Simpro
              </Button>
            )}
            {canDelete && activeItems.length > 0 && (
              <Button onClick={openBulkForAllInView}
                       variant="outline"
                       className="h-11 border-red-300 text-red-700 hover:bg-red-50"
                       data-testid="employees-delete-all-btn">
                <Trash2 className="w-4 h-4 mr-1.5"/> Delete all in view
              </Button>
            )}
            {canImport && (
              <div className="relative inline-flex" data-testid="simpro-refresh-split">
                <Button onClick={() => runRefresh()}
                         disabled={refreshing || !simproConfigured}
                         variant="outline"
                         className="h-11 border-[#1F2A33] text-[#1F2A33] hover:bg-[#1F2A33] hover:text-white disabled:opacity-40 disabled:cursor-not-allowed rounded-r-none border-r-0"
                         title={!simproConfigured ? "Configure Simpro first" : "Refresh from all configured companies"}
                         data-testid="simpro-refresh-btn">
                  {refreshing ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin"/> : <AppIcon name="refresh" size={14} decorative className="mr-1.5"/>}
                  Refresh from Simpro
                </Button>
                <Button onClick={() => setRefreshMenuOpen(v => !v)}
                         disabled={refreshing || !simproConfigured}
                         variant="outline"
                         className="h-11 border-[#1F2A33] text-[#1F2A33] hover:bg-[#1F2A33] hover:text-white disabled:opacity-40 disabled:cursor-not-allowed rounded-l-none px-2"
                         title="Choose specific companies"
                         data-testid="simpro-refresh-menu-toggle">
                  <ChevronDown className="w-4 h-4"/>
                </Button>
                {refreshMenuOpen && (
                  <div className="absolute right-0 top-full mt-1 z-30 bg-white border border-gray-200 rounded shadow-lg min-w-[240px] py-1"
                       data-testid="simpro-refresh-menu">
                    {(simpro?.company_ids || []).map(cid => {
                      const name = knownCompanyNames[cid];
                      return (
                        <button key={cid} type="button"
                                onClick={() => { setRefreshMenuOpen(false); runRefresh([Number(cid)]); }}
                                className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center gap-2"
                                data-testid={`simpro-refresh-only-${cid}`}>
                          <span className="text-[10px] font-mono bg-[#1F2A33] text-white rounded px-1.5 py-0.5">CO {cid}</span>
                          <span>Refresh {name ? name : `CO ${cid}`}</span>
                        </button>
                      );
                    })}
                    <div className="border-t border-gray-200 my-1"/>
                    <button type="button"
                            onClick={() => { setRefreshMenuOpen(false); runRefresh(); }}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 font-semibold"
                            data-testid="simpro-refresh-all">
                      Refresh all
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
          {canImport && (
            <div className="text-[11px] text-gray-500" data-testid="simpro-last-refresh">
              Last Simpro refresh: {simpro?.last_sync_at ? formatDateTime(simpro.last_sync_at) : "never"}
            </div>
          )}
        </div>
      </div>

      {/* Sync-status banner */}
      {simpro === null ? null : !simproEnabled ? (
        <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 text-xs px-4 py-2 rounded" data-testid="employees-banner-mocked">
          Currently MANUAL. Enable Simpro in Admin Settings → Integrations and click &ldquo;Import from Simpro&rdquo; to pull the live roster.
        </div>
      ) : !simproConfigured ? (
        <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 text-xs px-4 py-2 rounded" data-testid="employees-banner-not-configured">
          Simpro enabled but credentials are incomplete. Finish setup in Admin Settings → Integrations, then click Import.
        </div>
      ) : !lastSyncOk ? (
        <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 text-xs px-4 py-2 rounded" data-testid="employees-banner-not-synced">
          Simpro enabled but not yet imported. Click Import from Simpro to preview and select employees.
        </div>
      ) : (
        <div className="bg-green-50 border border-green-200 text-green-800 text-xs px-4 py-2 rounded" data-testid="employees-banner-live">
          <span className="font-bold">LIVE</span> · Last import {formatDateTime(simpro.last_sync_at)} · {simpro.last_sync_employees_count || 0} employees
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div className="inline-flex rounded border border-gray-200 bg-white p-0.5 text-xs">
          {[["active","Active"],["inactive","Inactive"],["all","All"]].map(([k,l])=>(
            <button key={k} onClick={() => setStatusFilter(k)} data-testid={`emp-filter-${k}`}
              className={`px-3 py-1.5 rounded font-semibold ${statusFilter===k ? "bg-[#1F2A33] text-white" : "text-gray-600 hover:bg-gray-50"}`}>{l}</button>
          ))}
        </div>
        {(items || []).length > 0 && (
          <div className="flex flex-wrap items-center gap-2" data-testid="employees-filters">
            <Input value={textFilter} onChange={(e) => setTextFilter(e.target.value)}
                    placeholder="Search name, email, phone…"
                    className="h-9 w-64 text-sm"
                    data-testid="employees-text-filter"/>
            <select value={positionFilter}
                     onChange={(e) => setPositionFilter(e.target.value)}
                     className="h-9 border border-gray-300 rounded px-2 text-sm bg-white min-w-[200px]"
                     data-testid="employees-position-filter">
              <option value="__all__">All positions</option>
              {distinctPositions.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            <span className="text-[11px] uppercase tracking-wider font-bold bg-[#1F2A33] text-white rounded-full px-2.5 py-1"
                   data-testid="employees-filter-count">
              {filteredItems.length} match{filteredItems.length === 1 ? "" : "es"}
            </span>
          </div>
        )}
      </div>
      <div className="bg-white border border-gray-200 rounded overflow-hidden">
        {items === null ? <div className="p-6 text-sm text-gray-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin"/> Loading…</div>
         : items.length === 0 ? <div className="p-6 text-sm text-gray-500">No employees in this view.</div>
         : filteredItems.length === 0 ? <div className="p-6 text-sm text-gray-500">No employees match the current filters.</div>
         : (
        <table className="w-full text-sm">
          <thead className="bg-[#3A6B8C] text-white uppercase text-[10px] tracking-wider">
            <tr>
              {canDelete && (
                <th className="px-3 py-3 text-left w-10">
                  <Checkbox checked={allSelected} indeterminate={someSelected ? "true" : undefined}
                             onCheckedChange={toggleAll}
                             data-testid="employees-select-all"
                             className="border-white/60 data-[state=checked]:bg-[#F5C518] data-[state=checked]:border-[#F5C518]"/>
                </th>
              )}
              <th className="px-4 py-3 text-left">Name</th>
              <th className="px-4 py-3 text-left">Contact</th>
              <th className="px-4 py-3 text-left">Source</th>
              {canDelete && <th className="px-4 py-3 text-right w-14">Actions</th>}
            </tr>
          </thead>
          <tbody>{filteredItems.map(e => (
            <tr key={e.id}
              className={`border-t border-gray-200 hover:bg-gray-50 ${e.deleted_at ? "opacity-60" : ""} ${selected.has(e.id) ? "bg-yellow-50" : ""}`}
              data-testid={`employee-row-${e.id}`}>
              {canDelete && (
                <td className="px-3 py-3">
                  {!e.deleted_at && (
                    <Checkbox checked={selected.has(e.id)}
                               onCheckedChange={() => toggleRow(e.id)}
                               data-testid={`employee-select-${e.id}`}/>
                  )}
                </td>
              )}
              <td className="px-4 py-3 cursor-pointer" onClick={() => navigate(`/employees/${e.id}`)}>
                <div className="font-bold text-[#1F2A33]">{e.name || `Employee #${e.simpro_employee_id || "?"}`}</div>
                {e.role && <div className="text-xs text-gray-500 mt-0.5">{e.role}</div>}
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  {e.simpro_employee_id && (
                    <span className="text-[10px] font-mono uppercase tracking-wider bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded" data-testid={`simpro-id-chip-${e.id}`}>
                      SIMPRO #{e.simpro_employee_id}
                    </span>
                  )}
                  {e.excluded_from_sync && (
                    <span className="text-[10px] font-bold uppercase tracking-wider bg-orange-100 text-orange-800 px-1.5 py-0.5 rounded" title="Deleted here — Simpro sync will skip this employee." data-testid={`excluded-chip-${e.id}`}>excluded from sync</span>
                  )}
                  {e.deleted_at && <span className="text-[10px] text-red-700 italic">(deleted)</span>}
                </div>
              </td>
              <td className="px-4 py-3 cursor-pointer text-xs text-gray-600" onClick={() => navigate(`/employees/${e.id}`)}>
                <div>{e.email || <span className="text-gray-400">— no email</span>}</div>
                <div className="mt-0.5">{e.phone || <span className="text-gray-400">— no phone</span>}</div>
              </td>
              <td className="px-4 py-3 cursor-pointer" onClick={() => navigate(`/employees/${e.id}`)}>
                <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${SOURCE_BADGE[e.source]||"bg-gray-100"}`}>{e.source}</span>
              </td>
              {canDelete && (
                <td className="px-4 py-3 text-right">
                  {!e.deleted_at && (
                    <button type="button"
                            onClick={(ev) => { ev.stopPropagation(); setDeleteTarget(e); }}
                            className="text-gray-400 hover:text-red-700 p-1 rounded"
                            title="Delete employee"
                            data-testid={`employee-delete-btn-${e.id}`}
                            aria-label={`Delete ${e.name}`}>
                      <Trash2 className="w-4 h-4"/>
                    </button>
                  )}
                </td>
              )}
            </tr>))}
          </tbody>
        </table>)}
      </div>

      {/* Import modal */}
      <SimproEmployeeImportModal
        open={importOpen}
        onOpenChange={setImportOpen}
        simpro={simpro}
        onImported={async () => { await Promise.all([load(), loadSimpro()]); }}
      />

      {/* Floating bulk-action bar */}
      {canDelete && selected.size > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 bg-[#1F2A33] text-white rounded-full shadow-2xl border border-white/10 px-5 py-3 flex items-center gap-3"
              data-testid="employees-bulk-actionbar">
          <span className="text-sm font-semibold" data-testid="employees-bulk-count">{selected.size} selected</span>
          <div className="h-4 w-px bg-white/30"/>
          <Button size="sm" onClick={openBulkForSelected}
                   className="bg-red-600 hover:bg-red-700 text-white h-8"
                   data-testid="employees-bulk-delete-btn">
            <Trash2 className="w-3.5 h-3.5 mr-1"/> Delete selected
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}
                   className="text-white/80 hover:text-white hover:bg-white/10 h-8"
                   data-testid="employees-bulk-clear-btn">
            Clear
          </Button>
        </div>
      )}

      {/* Single-row Delete confirm dialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <AlertDialogContent data-testid="employee-delete-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This employee will be permanently removed from the crew list. The deletion is logged in the audit trail but the employee record itself cannot be recovered.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="employee-delete-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={doDelete}
              className="bg-red-600 text-white hover:bg-red-700"
              data-testid="employee-delete-confirm-btn">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk Delete confirm dialog */}
      <AlertDialog open={bulkOpen} onOpenChange={(v) => !v && setBulkOpen(false)}>
        <AlertDialogContent data-testid="employees-bulk-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {bulkTargetIds.length} employee{bulkTargetIds.length === 1 ? "" : "s"}?</AlertDialogTitle>
            <AlertDialogDescription>
              These employees will be permanently removed from the crew list. The deletion is logged in the audit trail but the employee records themselves cannot be recovered.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="employees-bulk-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={doBulkDelete}
              disabled={bulkDeleting}
              className="bg-red-600 text-white hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed"
              data-testid="employees-bulk-confirm-btn">
              {bulkDeleting ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin"/> : null}
              Delete {bulkTargetIds.length}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
