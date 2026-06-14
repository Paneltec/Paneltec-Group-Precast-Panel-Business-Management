import { useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, Download, FileSearch } from "lucide-react";
import { api, formatApiErrorDetail, tokenStore } from "../lib/api";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Toaster, toast } from "sonner";
import { formatDateTime } from "../lib/format";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";

const ACTIONS = ["created","updated","soft_deleted","hard_deleted","restored","status_changed",
  "login_success","login_failed","password_changed","password_reset","permission_changed",
  "quote_sent","quote_viewed","quote_accepted","quote_rejected","quote_revised",
  "invoice_issued","invoice_paid","invoice_pushed_xero","email_sent","settings_changed"];
const ENTITIES = ["customer","project","quote","job","invoice","vehicle","employee","user",
  "pricing_settings","company_settings","integration_settings","system"];

const ACTION_COLOR = {
  created:"bg-green-100 text-green-800", updated:"bg-blue-100 text-blue-800",
  soft_deleted:"bg-red-100 text-red-700", hard_deleted:"bg-red-200 text-red-900",
  restored:"bg-emerald-100 text-emerald-800", status_changed:"bg-purple-100 text-purple-800",
  login_success:"bg-gray-100 text-gray-700", login_failed:"bg-orange-100 text-orange-800",
  password_changed:"bg-indigo-100 text-indigo-800", password_reset:"bg-indigo-100 text-indigo-800",
  permission_changed:"bg-pink-100 text-pink-800",
  quote_sent:"bg-sky-100 text-sky-800", quote_viewed:"bg-cyan-100 text-cyan-800",
  quote_accepted:"bg-emerald-100 text-emerald-800", quote_rejected:"bg-red-100 text-red-800",
  quote_revised:"bg-amber-100 text-amber-800",
  invoice_issued:"bg-yellow-100 text-yellow-800", invoice_paid:"bg-green-100 text-green-800",
  invoice_pushed_xero:"bg-violet-100 text-violet-800",
  email_sent:"bg-blue-100 text-blue-800", settings_changed:"bg-slate-100 text-slate-800",
};

export default function AuditPage() {
  const [items, setItems] = useState(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const perPage = 50;
  const [action, setAction] = useState("");
  const [entityType, setEntityType] = useState("");
  const [search, setSearch] = useState("");
  const [drawer, setDrawer] = useState(null);

  const load = async () => {
    setItems(null);
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("per_page", String(perPage));
      if (action) params.set("action", action);
      if (entityType) params.set("entity_type", entityType);
      if (search) params.set("search", search);
      const { data } = await api.get(`/audit?${params}`);
      setItems(data.items);
      setTotal(data.total);
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [page, action, entityType]);

  const csvExport = () => {
    const params = new URLSearchParams();
    if (action) params.set("action", action);
    if (entityType) params.set("entity_type", entityType);
    if (search) params.set("search", search);
    const token = tokenStore.get();
    // browser can't add Authorization header for direct GET; fetch + blob it
    fetch(`${process.env.REACT_APP_BACKEND_URL}/api/audit/export.csv?${params}`,
        { headers: { Authorization: `Bearer ${token}` }})
      .then(r => r.blob())
      .then(blob => {
        const u = URL.createObjectURL(blob);
        const a = document.createElement("a"); a.href = u; a.download = "audit.csv"; a.click();
        URL.revokeObjectURL(u);
      })
      .catch(e => toast.error(e.message));
  };

  const totalPages = Math.max(1, Math.ceil(total / perPage));

  return (
    <div className="space-y-5" data-testid="audit-page">
      <Toaster richColors position="top-right" />
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <div className="overline">Super Admin</div>
          <h1 className="text-3xl md:text-4xl font-black tracking-tighter text-[#1F2A33] inline-flex items-center gap-2">
            <FileSearch className="w-8 h-8 text-[#3A6B8C]"/> Audit Trail
          </h1>
          <p className="text-sm text-gray-500 mt-1">Every business-critical action across the platform. Filter, inspect, export.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={load} data-testid="audit-refresh">
            <RefreshCw className="w-4 h-4 mr-2"/> Refresh
          </Button>
          <Button onClick={csvExport} className="bg-[#F5C518] text-[#1F2A33] font-bold hover:bg-[#E0B416]" data-testid="audit-csv-export">
            <Download className="w-4 h-4 mr-2"/> Export CSV
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 items-center bg-white border border-gray-200 rounded p-3">
        <Input placeholder="Search entity label / actor email" value={search}
          onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (setPage(1), load())}
          className="w-72" data-testid="audit-search"/>
        <Select value={action || "all"} onValueChange={(v) => { setAction(v === "all" ? "" : v); setPage(1); }}>
          <SelectTrigger className="w-52" data-testid="audit-action-filter"><SelectValue placeholder="Action"/></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All actions</SelectItem>
            {ACTIONS.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={entityType || "all"} onValueChange={(v) => { setEntityType(v === "all" ? "" : v); setPage(1); }}>
          <SelectTrigger className="w-52" data-testid="audit-entity-filter"><SelectValue placeholder="Entity"/></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All entities</SelectItem>
            {ENTITIES.map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="ml-auto text-xs text-gray-500">{total.toLocaleString()} events</div>
      </div>

      <div className="bg-white border border-gray-200 rounded overflow-hidden">
        {items === null ? (
          <div className="p-6 flex items-center gap-2 text-sm text-gray-500"><Loader2 className="w-4 h-4 animate-spin"/> Loading…</div>
        ) : items.length === 0 ? (
          <div className="p-6 text-sm text-gray-500">No events match the filters.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[#3A6B8C] text-white uppercase text-[10px] tracking-wider">
                <tr>
                  <th className="px-3 py-2.5 text-left">When</th>
                  <th className="px-3 py-2.5 text-left">Actor</th>
                  <th className="px-3 py-2.5 text-left">Action</th>
                  <th className="px-3 py-2.5 text-left">Entity</th>
                  <th className="px-3 py-2.5 text-left">Label</th>
                  <th className="px-3 py-2.5 text-left">Summary</th>
                </tr>
              </thead>
              <tbody data-testid="audit-table">
                {items.map((e) => (
                  <tr key={e.id} onClick={() => setDrawer(e)}
                    className="border-t border-gray-200 hover:bg-gray-50 cursor-pointer"
                    data-testid={`audit-row-${e.id}`}>
                    <td className="px-3 py-2 text-xs text-gray-600">{formatDateTime(e.timestamp)}</td>
                    <td className="px-3 py-2 text-xs">
                      <div className="font-medium text-[#1F2A33]">{e.actor_name || e.actor_email || "System"}</div>
                      <div className="text-gray-400">{e.actor_email}</div>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${ACTION_COLOR[e.action] || "bg-gray-100 text-gray-700"}`}>{e.action}</span>
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-600">{e.entity_type}</td>
                    <td className="px-3 py-2 text-xs font-mono">{e.entity_label}</td>
                    <td className="px-3 py-2 text-xs text-gray-500 max-w-md truncate">
                      {e.changes ? Object.keys(e.changes).slice(0,3).join(", ") : (e.metadata && Object.keys(e.metadata).length ? JSON.stringify(e.metadata).slice(0,80) : "—")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      <div className="flex justify-between items-center text-xs text-gray-500">
        <div>Page {page} of {totalPages}</div>
        <div className="flex gap-1">
          <Button variant="outline" size="sm" disabled={page<=1} onClick={() => setPage(p=>p-1)} data-testid="audit-prev">Prev</Button>
          <Button variant="outline" size="sm" disabled={page>=totalPages} onClick={() => setPage(p=>p+1)} data-testid="audit-next">Next</Button>
        </div>
      </div>

      <Dialog open={!!drawer} onOpenChange={(v) => { if (!v) setDrawer(null); }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto" data-testid="audit-detail-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${ACTION_COLOR[drawer?.action] || "bg-gray-100 text-gray-700"}`}>{drawer?.action}</span>
              <span className="font-mono">{drawer?.entity_label}</span>
            </DialogTitle>
          </DialogHeader>
          {drawer && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div><div className="overline">When</div><div className="font-mono text-xs">{drawer.timestamp}</div></div>
                <div><div className="overline">Actor</div><div>{drawer.actor_name} <span className="text-gray-400">({drawer.actor_email})</span></div></div>
                <div><div className="overline">Entity Type</div><div>{drawer.entity_type}</div></div>
                <div><div className="overline">Entity ID</div><div className="font-mono text-[11px]">{drawer.entity_id || "—"}</div></div>
              </div>
              {drawer.changes && (
                <div>
                  <div className="overline mb-1">Changes</div>
                  <pre className="bg-gray-50 border border-gray-200 rounded p-3 text-[11px] overflow-x-auto">{JSON.stringify(drawer.changes, null, 2)}</pre>
                </div>
              )}
              {drawer.metadata && Object.keys(drawer.metadata).length > 0 && (
                <div>
                  <div className="overline mb-1">Metadata</div>
                  <pre className="bg-gray-50 border border-gray-200 rounded p-3 text-[11px] overflow-x-auto">{JSON.stringify(drawer.metadata, null, 2)}</pre>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
