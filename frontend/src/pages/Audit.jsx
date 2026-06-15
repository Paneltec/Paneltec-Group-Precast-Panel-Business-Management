import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Loader2, RefreshCw, Download, FileSearch, ArrowRight, ExternalLink, X } from "lucide-react";
import AppIcon from "../components/AppIcon";
import { api, formatApiErrorDetail, tokenStore } from "../lib/api";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Toaster, toast } from "sonner";
import { formatDateTime } from "../lib/format";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "../components/ui/sheet";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../components/ui/tooltip";
import UserBadge from "../components/UserBadge";

const ACTIONS = ["created","updated","soft_deleted","hard_deleted","restored","status_changed",
  "login_success","login_failed","password_changed","password_reset","permission_changed",
  "quote_sent","quote_viewed","quote_accepted","quote_rejected","quote_revised",
  "invoice_issued","invoice_paid","invoice_pushed_xero","email_sent","settings_changed"];
const ENTITIES = ["customer","project","quote","job","invoice","vehicle","employee","user",
  "pricing_settings","company_settings","integration_settings","system"];

const ACTION_ICON = {
  created:"created", updated:"updated", soft_deleted:"soft_deleted", hard_deleted:"hard_deleted",
  restored:"restored", status_changed:"status_changed",
  login_success:"login_success", login_failed:"login_failed",
  password_changed:"password_changed", password_reset:"password_reset",
  permission_changed:"permission_changed",
  quote_sent:"quote_sent", quote_viewed:"quote_viewed",
  quote_accepted:"quote_accepted", quote_rejected:"quote_rejected",
  quote_revised:"quote_revised",
  invoice_issued:"invoice_issued", invoice_paid:"invoice_paid",
  invoice_pushed_xero:"invoice_pushed_xero",
  email_sent:"email_sent", settings_changed:"settings_changed", viewed:"viewed",
};

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

const ENTITY_ROUTE = {
  customer: (id) => `/customers/${id}`,
  project:  (id) => `/customers`,            // projects live under their customer page
  quote:    (id) => `/quotes/${id}`,
  job:      (id) => `/jobs/${id}`,
  invoice:  (id) => `/invoices/${id}`,
  vehicle:  (id) => `/vehicles/${id}`,
  employee: (id) => `/employees/${id}`,
  user:     (id) => `/users`,
};

const ENTITY_FETCH = {
  customer: (id) => `/customers/${id}`,
  project:  (id) => `/projects/${id}`,
  quote:    (id) => `/quotes/${id}`,
  job:      (id) => `/jobs/${id}`,
  invoice:  (id) => `/invoices/${id}`,
  vehicle:  (id) => `/vehicles/${id}`,
  employee: (id) => `/employees/${id}`,
  user:     (id) => `/users/${id}/references`, // /users/{id} has no GET, use refs as existence probe
};

// Tiny UA → readable name parser (no dep)
function parseUserAgent(ua) {
  if (!ua) return null;
  const browser =
    /Edg\/([\d.]+)/.exec(ua)?.[0]?.replace("Edg/", "Edge ") ||
    /OPR\/([\d.]+)/.exec(ua)?.[0]?.replace("OPR/", "Opera ") ||
    /Chrome\/([\d.]+)/.exec(ua)?.[0]?.replace("Chrome/", "Chrome ") ||
    /Firefox\/([\d.]+)/.exec(ua)?.[0]?.replace("Firefox/", "Firefox ") ||
    /Safari\/([\d.]+)/.exec(ua)?.[0]?.replace("Safari/", "Safari ") ||
    "Unknown browser";
  const os =
    (/Mac OS X ([\d_]+)/.exec(ua) ? "macOS " + RegExp.$1.replace(/_/g, ".") : null) ||
    (/Windows NT ([\d.]+)/.exec(ua) ? "Windows " + RegExp.$1 : null) ||
    (/Android ([\d.]+)/.exec(ua) ? "Android " + RegExp.$1 : null) ||
    (/iPhone OS ([\d_]+)/.exec(ua) ? "iOS " + RegExp.$1.replace(/_/g, ".") : null) ||
    (/Linux/.exec(ua) ? "Linux" : null) ||
    "Unknown OS";
  return `${browser.split(".")[0]} on ${os}`;
}

function relativeTime(iso) {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  const abs = Math.abs(diff);
  const m = Math.round(abs / 60000);
  const h = Math.round(abs / 3600000);
  const d = Math.round(abs / 86400000);
  const past = diff >= 0;
  const fmt = (n, unit) => `${n} ${unit}${n === 1 ? "" : "s"} ${past ? "ago" : "from now"}`;
  if (m < 1) return "just now";
  if (m < 60) return fmt(m, "min");
  if (h < 24) return fmt(h, "hour");
  if (d < 30) return fmt(d, "day");
  return new Date(iso).toLocaleDateString("en-AU");
}

function isScalarDiff(v) {
  return v && typeof v === "object" && !Array.isArray(v) && "from" in v && "to" in v
    && (typeof v.from !== "object" || v.from === null)
    && (typeof v.to   !== "object" || v.to   === null);
}
function isAddedRemovedDiff(v) {
  return v && typeof v === "object" && !Array.isArray(v) && ("added" in v || "removed" in v);
}

function PrettyDiff({ changes }) {
  if (!changes || (typeof changes === "object" && Object.keys(changes).length === 0)) {
    return <div className="text-xs text-gray-400">No changes recorded.</div>;
  }
  return (
    <div className="space-y-3 text-sm">
      {Object.entries(changes).map(([key, v]) => {
        if (isAddedRemovedDiff(v)) {
          const added = v.added || [];
          const removed = v.removed || [];
          return (
            <div key={key} className="bg-gray-50 border border-gray-200 rounded p-3" data-testid={`diff-${key}`}>
              <div className="text-[10px] uppercase tracking-wider font-bold text-[#3A6B8C] mb-1.5">{key}</div>
              <div className="space-y-0.5 font-mono text-[11px]">
                {added.map((k, i) => (<div key={`a${i}`} className="text-green-700"><span className="bg-green-100 px-1 rounded">+ {String(k)}</span></div>))}
                {removed.map((k, i) => (<div key={`r${i}`} className="text-red-700"><span className="bg-red-100 px-1 rounded">− {String(k)}</span></div>))}
              </div>
            </div>
          );
        }
        if (isScalarDiff(v)) {
          const renderVal = (val) => {
            const s = val === null || val === undefined ? "∅" : String(val);
            return s.length > 80 ? (
              <Tooltip>
                <TooltipTrigger asChild><span className="truncate inline-block max-w-[18ch] align-bottom underline decoration-dotted">{s.slice(0, 78)}…</span></TooltipTrigger>
                <TooltipContent className="max-w-md break-words">{s}</TooltipContent>
              </Tooltip>
            ) : s;
          };
          return (
            <div key={key} className="bg-gray-50 border border-gray-200 rounded p-3 flex items-center gap-2" data-testid={`diff-${key}`}>
              <div className="text-[10px] uppercase tracking-wider font-bold text-[#3A6B8C] w-32 shrink-0">{key}</div>
              <div className="font-mono text-[11px] flex-1 flex items-center gap-2 flex-wrap">
                <span className="bg-red-100 text-red-700 px-1.5 py-0.5 rounded line-through">{renderVal(v.from)}</span>
                <ArrowRight className="w-3 h-3 text-gray-400 shrink-0"/>
                <span className="bg-green-100 text-green-800 px-1.5 py-0.5 rounded">{renderVal(v.to)}</span>
              </div>
            </div>
          );
        }
        // fallback: dump as compact JSON
        return (
          <div key={key} className="bg-gray-50 border border-gray-200 rounded p-3" data-testid={`diff-${key}`}>
            <div className="text-[10px] uppercase tracking-wider font-bold text-[#3A6B8C] mb-1.5">{key}</div>
            <pre className="text-[11px] font-mono overflow-x-auto">{JSON.stringify(v, null, 2)}</pre>
          </div>
        );
      })}
    </div>
  );
}

function initialsOf(name, email) {
  const s = (name || email || "?").trim();
  const parts = s.split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return s.slice(0, 2).toUpperCase();
}

function defaultDate(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export default function AuditPage() {
  const [items, setItems] = useState(null);
  const [total, setTotal] = useState(0);
  const [drawer, setDrawer] = useState(null);
  const [entityExists, setEntityExists] = useState(null); // for "Open <entity>" guard
  const [params, setParams] = useSearchParams();

  // ----- URL-bound filter state -----
  const page = parseInt(params.get("page") || "1", 10);
  const action = params.get("action") || "";
  const entityType = params.get("entity_type") || "";
  const search = params.get("search") || "";
  const dateFrom = params.get("date_from") || defaultDate(-30);
  const dateTo = params.get("date_to") || defaultDate(0);
  const focusId = params.get("focus") || "";
  const perPage = 50;

  const setFilter = (patch) => {
    const next = new URLSearchParams(params);
    Object.entries(patch).forEach(([k, v]) => {
      if (v === "" || v === null || v === undefined) next.delete(k);
      else next.set(k, String(v));
    });
    setParams(next, { replace: false });
  };

  const [searchInput, setSearchInput] = useState(search);
  useEffect(() => { setSearchInput(search); }, [search]);

  const load = async () => {
    setItems(null);
    try {
      const qp = new URLSearchParams();
      qp.set("page", String(page));
      qp.set("per_page", String(perPage));
      if (action) qp.set("action", action);
      if (entityType) qp.set("entity_type", entityType);
      if (search) qp.set("search", search);
      // Treat the date inputs as ISO date strings; broaden to full day on `to`
      if (dateFrom) qp.set("date_from", new Date(`${dateFrom}T00:00:00Z`).toISOString());
      if (dateTo)   qp.set("date_to",   new Date(`${dateTo}T23:59:59.999Z`).toISOString());
      const { data } = await api.get(`/audit?${qp}`);
      setItems(data.items); setTotal(data.total);
      // If ?focus=<eventId> is set, auto-open that event's drawer
      if (focusId && !drawer) {
        const target = data.items.find((e) => e.id === focusId);
        if (target) setDrawer(target);
        else {
          // Try direct fetch (could be on a different page)
          try { const { data: ev } = await api.get(`/audit/${focusId}`); setDrawer(ev); } catch (_) {}
        }
      }
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ },
    [page, action, entityType, search, dateFrom, dateTo]);

  // Check entity existence when drawer opens
  useEffect(() => {
    if (!drawer) { setEntityExists(null); return; }
    if (!drawer.entity_id || !ENTITY_FETCH[drawer.entity_type]) { setEntityExists(false); return; }
    setEntityExists(null);
    api.get(ENTITY_FETCH[drawer.entity_type](drawer.entity_id))
      .then(() => setEntityExists(true))
      .catch(() => setEntityExists(false));
    // eslint-disable-next-line
  }, [drawer?.id]);

  const csvExport = () => {
    const qp = new URLSearchParams();
    if (action) qp.set("action", action);
    if (entityType) qp.set("entity_type", entityType);
    if (search) qp.set("search", search);
    if (dateFrom) qp.set("date_from", new Date(`${dateFrom}T00:00:00Z`).toISOString());
    if (dateTo)   qp.set("date_to",   new Date(`${dateTo}T23:59:59.999Z`).toISOString());
    const token = tokenStore.get();
    fetch(`${process.env.REACT_APP_BACKEND_URL}/api/audit/export.csv?${qp}`,
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

  const closeDrawer = () => { setDrawer(null); if (focusId) setFilter({ focus: null }); };

  const drawerEntityHref = useMemo(() => {
    if (!drawer || !drawer.entity_id) return null;
    const make = ENTITY_ROUTE[drawer.entity_type];
    return make ? make(drawer.entity_id) : null;
  }, [drawer]);

  return (
    <TooltipProvider>
    <div className="space-y-5" data-testid="audit-page">
      <Toaster richColors position="top-right" />
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <div className="overline">Super Admin</div>
          <h1 className="text-3xl md:text-4xl font-black tracking-tighter text-[#1F2A33] inline-flex items-center gap-2">
            <AppIcon name="audit" size={32} decorative/> Audit Trail
          </h1>
          <p className="text-sm text-gray-500 mt-1">Every business-critical action across the platform. Filter, inspect, export.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={load} data-testid="audit-refresh">
            <AppIcon name="refresh" size={16} className="mr-2" decorative/> Refresh
          </Button>
          <Button onClick={csvExport} className="bg-[#F5C518] text-[#1F2A33] font-bold hover:bg-[#E0B416]" data-testid="audit-csv-export">
            <AppIcon name="download" size={16} className="mr-2" decorative/> Export CSV
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 items-center bg-white border border-gray-200 rounded p-3">
        <Input placeholder="Search entity label / actor email" value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && setFilter({ search: searchInput || null, page: 1 })}
          className="w-64" data-testid="audit-search"/>
        <Select value={action || "all"} onValueChange={(v) => setFilter({ action: v === "all" ? null : v, page: 1 })}>
          <SelectTrigger className="w-48" data-testid="audit-action-filter"><SelectValue placeholder="Action"/></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All actions</SelectItem>
            {ACTIONS.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={entityType || "all"} onValueChange={(v) => setFilter({ entity_type: v === "all" ? null : v, page: 1 })}>
          <SelectTrigger className="w-48" data-testid="audit-entity-filter"><SelectValue placeholder="Entity"/></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All entities</SelectItem>
            {ENTITIES.map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}
          </SelectContent>
        </Select>

        {/* Date range */}
        <div className="flex items-center gap-1.5 ml-1">
          <label className="text-[10px] uppercase tracking-wider text-gray-500 font-bold">From</label>
          <Input type="date" value={dateFrom} onChange={(e) => setFilter({ date_from: e.target.value || null, page: 1 })}
                 className="w-40 h-9" data-testid="audit-date-from"/>
          <label className="text-[10px] uppercase tracking-wider text-gray-500 font-bold ml-1">To</label>
          <Input type="date" value={dateTo} onChange={(e) => setFilter({ date_to: e.target.value || null, page: 1 })}
                 className="w-40 h-9" data-testid="audit-date-to"/>
          <Button variant="ghost" size="sm" data-testid="audit-clear-dates"
                  onClick={() => setFilter({ date_from: null, date_to: null, page: 1 })}>
            <X className="w-3.5 h-3.5 mr-1"/> Clear dates
          </Button>
        </div>

        <div className="ml-auto text-xs text-gray-500" data-testid="audit-total">{total.toLocaleString()} events</div>
      </div>

      <div className="bg-white border border-gray-200 rounded overflow-hidden">
        {items === null ? (
          <div className="p-6 flex items-center gap-2 text-sm text-gray-500"><Loader2 className="w-4 h-4 animate-spin"/> Loading…</div>
        ) : items.length === 0 ? (
          <div className="p-6 text-sm text-gray-500" data-testid="audit-empty">No events match the filters.</div>
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
                {(items ?? []).map((e) => (
                  <tr key={e.id} onClick={() => setDrawer(e)}
                    className="border-t border-gray-200 hover:bg-gray-50 cursor-pointer"
                    data-testid={`audit-row-${e.id}`}>
                    <td className="px-3 py-2 text-xs text-gray-600">{formatDateTime(e.timestamp)}</td>
                    <td className="px-3 py-2 text-xs">
                      <div className="font-medium text-[#1F2A33]">{e.actor_name || e.actor_email || "System"}</div>
                      <div className="text-gray-400">{e.actor_email}</div>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded inline-flex items-center gap-1 ${ACTION_COLOR[e.action] || "bg-gray-100 text-gray-700"}`}><AppIcon name={ACTION_ICON[e.action] || "info"} size={14} decorative/>{e.action}</span>
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

      <div className="flex justify-between items-center text-xs text-gray-500">
        <div>Page {page} of {totalPages}</div>
        <div className="flex gap-1">
          <Button variant="outline" size="sm" disabled={page<=1} onClick={() => setFilter({ page: page - 1 })} data-testid="audit-prev">Prev</Button>
          <Button variant="outline" size="sm" disabled={page>=totalPages} onClick={() => setFilter({ page: page + 1 })} data-testid="audit-next">Next</Button>
        </div>
      </div>

      {/* ===== Right-side drawer ===== */}
      <Sheet open={!!drawer} onOpenChange={(v) => { if (!v) closeDrawer(); }}>
        <SheetContent side="right" data-testid="audit-detail-drawer"
                      className="w-full sm:max-w-[520px] overflow-y-auto p-0">
          {drawer && (
            <div className="flex flex-col h-full">
              <SheetHeader className="p-5 border-b border-gray-200 bg-gray-50">
                <SheetTitle className="flex items-center gap-2 text-base">
                  <span className={`text-[11px] font-bold uppercase tracking-wider px-2 py-1 rounded inline-flex items-center gap-1.5 ${ACTION_COLOR[drawer.action] || "bg-gray-100 text-gray-700"}`}
                        data-testid="drawer-action-badge"><AppIcon name={ACTION_ICON[drawer.action] || "info"} size={16} decorative/>{drawer.action}</span>
                  <span className="font-mono text-[#1F2A33] truncate">{drawer.entity_label || "—"}</span>
                </SheetTitle>
                <SheetDescription className="text-xs">
                  <span className="text-gray-700 font-semibold">{formatDateTime(drawer.timestamp)}</span>
                  <span className="text-gray-400"> · {relativeTime(drawer.timestamp)}</span>
                </SheetDescription>
              </SheetHeader>

              <div className="p-5 space-y-5 text-sm">
                {/* Actor */}
                <section>
                  <div className="text-[10px] uppercase tracking-wider font-bold text-[#3A6B8C] mb-1.5">Actor</div>
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-[#3A6B8C] text-white flex items-center justify-center text-xs font-bold tracking-wider">
                      {initialsOf(drawer.actor_name, drawer.actor_email)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-[#1F2A33] truncate" data-testid="drawer-actor-name">
                        {drawer.actor_name || "System"}
                      </div>
                      <div className="text-xs text-gray-500 truncate">{drawer.actor_email}</div>
                    </div>
                  </div>
                </section>

                {/* Entity */}
                <section>
                  <div className="text-[10px] uppercase tracking-wider font-bold text-[#3A6B8C] mb-1.5">Entity</div>
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div>
                      <span className="text-[10px] uppercase tracking-wider bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded mr-2">{drawer.entity_type}</span>
                      <span className="font-mono text-[12px] text-[#1F2A33]">{drawer.entity_label || "—"}</span>
                      {drawer.entity_id && <div className="text-[10px] font-mono text-gray-400 mt-1">{drawer.entity_id}</div>}
                    </div>
                    {drawerEntityHref ? (
                      entityExists === false ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span>
                              <Button size="sm" variant="outline" disabled data-testid="drawer-open-entity-btn"
                                      className="border-gray-200 text-gray-400 cursor-not-allowed">
                                <ExternalLink className="w-3.5 h-3.5 mr-1.5"/> Open {drawer.entity_type}
                              </Button>
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>Record no longer exists</TooltipContent>
                        </Tooltip>
                      ) : (
                        <a href={drawerEntityHref} data-testid="drawer-open-entity-btn"
                           className="inline-flex items-center text-xs font-bold uppercase tracking-wider text-[#3A6B8C] hover:text-[#1F2A33] border border-[#3A6B8C] rounded px-2.5 py-1.5">
                          <ExternalLink className="w-3.5 h-3.5 mr-1.5"/> Open {drawer.entity_type}
                        </a>
                      )
                    ) : null}
                  </div>
                </section>

                {/* Changes */}
                <section data-testid="drawer-changes-section">
                  <div className="text-[10px] uppercase tracking-wider font-bold text-[#3A6B8C] mb-1.5">Changes</div>
                  <PrettyDiff changes={drawer.changes} />
                </section>

                {/* Metadata */}
                {drawer.metadata && Object.keys(drawer.metadata).length > 0 && (
                  <section data-testid="drawer-metadata-section">
                    <div className="text-[10px] uppercase tracking-wider font-bold text-[#3A6B8C] mb-1.5">Metadata</div>
                    <div className="bg-gray-50 border border-gray-200 rounded p-3 space-y-1">
                      {Object.entries(drawer.metadata).map(([k, v]) => {
                        let display = String(v);
                        if (k === "user_agent" || k === "ua") {
                          const parsed = parseUserAgent(String(v));
                          if (parsed) display = parsed;
                        }
                        return (
                          <div key={k} className="text-xs flex gap-2">
                            <span className="text-[10px] uppercase tracking-wider font-bold text-gray-500 w-24 shrink-0">{k}</span>
                            <span className="text-[#1F2A33] font-mono break-all">{display}</span>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                )}
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
    </TooltipProvider>
  );
}

// Helper so `<UserBadge/>` is reachable for tree-shaking checks (not directly used here).
export { UserBadge };
