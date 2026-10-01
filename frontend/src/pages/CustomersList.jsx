import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus, Search, Loader2, Upload } from "lucide-react";
import AppIcon from "../components/AppIcon";
import { api, formatApiErrorDetail } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { formatDateTime } from "../lib/format";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../components/ui/tooltip";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "../components/ui/dialog";
import { toast } from "sonner";
import DeleteRowActions from "../components/DeleteRowActions";
import { useAuth } from "../contexts/AuthContext";

export default function CustomersList() {
  const [data, setData] = useState(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("active");
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const [simpro, setSimpro] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const navigate = useNavigate();
  const { hasPerm, isSuperAdmin } = useAuth();
  const canDelete = hasPerm("customers.delete");

  const load = async () => {
    try {
      const { data } = await api.get("/customers", {
        params: {
          search: search || undefined,
          status: statusFilter,
          active: "true",
          page,
          page_size: 25,
        },
      });
      setData(data);
    } catch (e) {
      setError(formatApiErrorDetail(e.response?.data?.detail) || e.message);
    }
  };
  const loadSimpro = async () => {
    if (!hasPerm("integrations.view")) { setSimpro({ enabled: false }); return; }
    try { const { data } = await api.get("/settings/integrations"); setSimpro(data?.simpro || { enabled: false }); }
    catch (_e) { setSimpro({ enabled: false }); }
  };
  useEffect(() => { load(); }, [page, statusFilter]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadSimpro(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const onSearchSubmit = (e) => { e.preventDefault(); setPage(1); load(); };

  const runSync = async () => {
    setSyncing(true); setSyncResult(null);
    try {
      const { data } = await api.post("/integrations/simpro/sync-customers");
      setSyncResult(data);
      toast.success(`Synced ${data.synced} customers (${data.created} new, ${data.updated} updated)`);
      await Promise.all([load(), loadSimpro()]);
    } catch (e) {
      const msg = formatApiErrorDetail(e.response?.data?.detail) || e.message;
      toast.error(msg);
      setSyncResult({ error: msg });
    } finally { setSyncing(false); }
  };

  const simproEnabled = !!(simpro && simpro.enabled);
  const simproConfigured = simproEnabled && !!(simpro.build_name && simpro.client_id);
  const canImport = hasPerm("integrations.edit") && hasPerm("customers.create") && simproConfigured;

  return (
    <div className="max-w-6xl space-y-6" data-testid="customers-page">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <div className="overline">CRM</div>
          <h1 className="text-3xl md:text-4xl font-black tracking-tighter text-[#1F2A33]">Customers</h1>
          <p className="text-sm text-gray-500 mt-1">Search, manage and quote your customers.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canImport ? (
            <Button variant="outline" onClick={runSync} disabled={syncing} data-testid="simpro-import-btn"
              className="border-purple-600 text-purple-700 hover:bg-purple-50 font-semibold h-11 px-5">
              {syncing ? <Loader2 className="w-4 h-4 mr-2 animate-spin"/> : <AppIcon name="upload" size={16} className="mr-2" decorative/>}
              Import from Simpro
            </Button>
          ) : (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <Button variant="outline" disabled data-testid="simpro-import-btn"
                      className="border-[#1F2A33] text-[#1F2A33] font-semibold h-11 px-5 opacity-50 cursor-not-allowed">
                      <AppIcon name="upload" size={16} className="mr-2" decorative/> Import from Simpro
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {simproEnabled ? "Configure Simpro credentials in Settings → Integrations" : "Enable Simpro in Settings → Integrations to import"}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          <Button onClick={() => navigate("/customers/new")} data-testid="new-customer-btn"
            className="bg-[#F5C518] text-[#1F2A33] font-bold hover:bg-[#E0B416] h-11 px-6">
            <AppIcon name="add" size={16} className="mr-1" decorative/> New customer
          </Button>
        </div>
      </div>

      {simproConfigured && simpro.last_sync_status === "ok" && simpro.last_sync_at && (
        <div className="bg-green-50 border border-green-200 text-green-800 text-xs px-4 py-2 rounded" data-testid="customers-banner-live">
          <span className="font-bold">LIVE</span> · Last Simpro import {formatDateTime(simpro.last_sync_at)} · {simpro.last_sync_customers_count || 0} customers
        </div>
      )}

      <form onSubmit={onSearchSubmit} className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 max-w-md">
          <AppIcon name="search" size={16} decorative/>
          <Input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search company, contact, ABN…" className="pl-9 h-10"
            data-testid="customers-search-input" />
        </div>
        <Button type="submit" variant="outline" data-testid="customers-search-btn">Search</Button>
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
          <SelectTrigger className="w-44 h-10" data-testid="status-filter"><SelectValue/></SelectTrigger>
          <SelectContent>
            <SelectItem value="active" data-testid="status-filter-active">Active</SelectItem>
            <SelectItem value="inactive" data-testid="status-filter-inactive">Inactive</SelectItem>
            <SelectItem value="deleted" data-testid="status-filter-deleted">Deleted</SelectItem>
            <SelectItem value="all" data-testid="status-filter-all">All</SelectItem>
          </SelectContent>
        </Select>
      </form>

      {error && <div className="text-sm text-red-700">{error}</div>}

      <section className="bg-white border border-gray-200 rounded overflow-hidden">
        {!data ? (
          <div className="p-6 flex items-center gap-2 text-gray-500 text-sm"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
        ) : data.items.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500" data-testid="customers-empty">No customers match this filter.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[#3A6B8C] text-white uppercase text-[10px] tracking-wider">
                <tr>
                  <th className="px-4 py-3 text-left">Company</th>
                  <th className="px-4 py-3 text-left">ABN</th>
                  <th className="px-4 py-3 text-left">Contact</th>
                  <th className="px-4 py-3 text-left">State</th>
                  <th className="px-4 py-3 text-left">Created</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody data-testid="customers-table-body">
                {data.items.map((c) => {
                  const isDeleted = !!c.deleted_at;
                  return (
                    <tr key={c.id} className={`border-t border-gray-200 hover:bg-gray-50 ${isDeleted ? "opacity-60" : ""}`}
                        data-testid={`customer-row-${c.id}`}>
                      <td className="px-4 py-3">
                        <Link to={`/customers/${c.id}`} className="font-semibold text-[#1F2A33] hover:text-[#3A6B8C]"
                          data-testid={`customer-link-${c.id}`}>{c.company_name}</Link>
                        {c.source === "SIMPRO" && (
                          <span className="ml-2 text-[10px] font-bold uppercase tracking-wider bg-purple-100 text-purple-800 px-1.5 py-0.5 rounded"
                                data-testid={`simpro-chip-${c.id}`}>Simpro</span>
                        )}
                        {isDeleted && (
                          <span className="ml-2 text-[10px] font-bold uppercase tracking-wider bg-red-100 text-red-800 px-1.5 py-0.5 rounded"
                                data-testid={`deleted-badge-${c.id}`}>deleted</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-700 tabular-nums">{c.abn || "—"}</td>
                      <td className="px-4 py-3 text-gray-700">{c.contact_name}<div className="text-xs text-gray-500">{c.contact_email}</div></td>
                      <td className="px-4 py-3 text-gray-700">{c.billing_address?.state || "—"}</td>
                      <td className="px-4 py-3 text-xs text-gray-500">{formatDateTime(c.created_at)}</td>
                      <td className="px-4 py-3">
                        <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${c.active ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-500"}`}>
                          {c.active ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <DeleteRowActions entity="customers" row={c}
                          label={(r) => r.company_name}
                          canDelete={canDelete} isSuperAdmin={isSuperAdmin}
                          onChanged={load} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {data.total > data.page_size && (
              <div className="flex justify-between items-center px-4 py-3 border-t border-gray-200 text-sm text-gray-600">
                <span>Page {data.page} of {Math.ceil(data.total / data.page_size)} · {data.total} total</span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Prev</Button>
                  <Button variant="outline" size="sm" disabled={page * data.page_size >= data.total} onClick={() => setPage(p => p + 1)}>Next</Button>
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      <Dialog open={!!syncResult} onOpenChange={(v) => !v && setSyncResult(null)}>
        <DialogContent data-testid="simpro-sync-result">
          <DialogHeader>
            <DialogTitle className="inline-flex items-center gap-2">
              <AppIcon name={syncResult?.error ? "warning" : "success"} size={22} decorative/>
              {syncResult?.error ? "Simpro import failed" : "Simpro import complete"}
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
