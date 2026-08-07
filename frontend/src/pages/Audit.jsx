import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Loader2, ArrowRight, ExternalLink, X, Eye, EyeOff, ChevronDown, ChevronRight } from "lucide-react";
import AppIcon from "../components/AppIcon";
import { api, formatApiErrorDetail, tokenStore } from "../lib/api";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { Checkbox } from "../components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Toaster, toast } from "sonner";
import { formatDateTime } from "../lib/format";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "../components/ui/sheet";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../components/ui/tooltip";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "../components/ui/alert-dialog";
import { useAuth } from "../contexts/AuthContext";
import UserBadge from "../components/UserBadge";

const ACTIONS = ["created","updated","soft_deleted","hard_deleted","restored","status_changed",
  "login_success","login_failed","login_rate_limited","password_changed","password_reset","permission_changed",
  "quote_sent","quote_viewed","quote_accepted","quote_rejected","quote_revised",
  "invoice_issued","invoice_paid","invoice_pushed_xero","email_sent","settings_changed",
  "audit_row_hidden","audit_row_unhidden"];
const ENTITIES = ["customer","project","quote","job","invoice","vehicle","employee","user",
  "pricing_settings","company_settings","integration_settings","system","audit_event","admin_settings","compliance_form"];

const ACTION_ICON = {
  created:"created", updated:"updated", soft_deleted:"soft_deleted", hard_deleted:"hard_deleted",
  restored:"restored", status_changed:"status_changed",
  login_success:"login_success", login_failed:"login_failed", login_rate_limited:"login_failed",
  password_changed:"password_changed", password_reset:"password_reset",
  permission_changed:"permission_changed",
  quote_sent:"quote_sent", quote_viewed:"quote_viewed",
  quote_accepted:"quote_accepted", quote_rejected:"quote_rejected",
  quote_revised:"quote_revised",
  invoice_issued:"invoice_issued", invoice_paid:"invoice_paid",
  invoice_pushed_xero:"invoice_pushed_xero",
  email_sent:"email_sent", settings_changed:"settings_changed", viewed:"viewed",
  audit_row_hidden:"soft_deleted", audit_row_unhidden:"restored",
};

const ACTION_COLOR = {
  created:"bg-green-100 text-green-800", updated:"bg-blue-100 text-blue-800",
  soft_deleted:"bg-red-100 text-red-700", hard_deleted:"bg-red-200 text-red-900",
  restored:"bg-emerald-100 text-emerald-800", status_changed:"bg-purple-100 text-purple-800",
  login_success:"bg-gray-100 text-gray-700", login_failed:"bg-orange-100 text-orange-800",
  login_rate_limited:"bg-orange-200 text-orange-900",
  password_changed:"bg-indigo-100 text-indigo-800", password_reset:"bg-indigo-100 text-indigo-800",
  permission_changed:"bg-pink-100 text-pink-800",
  quote_sent:"bg-sky-100 text-sky-800", quote_viewed:"bg-cyan-100 text-cyan-800",
  quote_accepted:"bg-emerald-100 text-emerald-800", quote_rejected:"bg-red-100 text-red-800",
  quote_revised:"bg-amber-100 text-amber-800",
  invoice_issued:"bg-yellow-100 text-yellow-800", invoice_paid:"bg-green-100 text-green-800",
  invoice_pushed_xero:"bg-violet-100 text-violet-800",
  email_sent:"bg-blue-100 text-blue-800", settings_changed:"bg-slate-100 text-slate-800",
  audit_row_hidden:"bg-zinc-200 text-zinc-800", audit_row_unhidden:"bg-zinc-100 text-zinc-700",
};

const META_ACTIONS = new Set(["audit_row_hidden", "audit_row_unhidden"]);

const ENTITY_ROUTE = {
  customer: (id) => `/customers/${id}`,
  project:  () => `/customers`,
  quote:    (id) => `/quotes/${id}`,
  job:      (id) => `/jobs/${id}`,
  invoice:  (id) => `/invoices/${id}`,
  vehicle:  (id) => `/vehicles/${id}`,
  employee: (id) => `/employees/${id}`,
  user:     () => `/users`,
};

const ENTITY_FETCH = {
  customer: (id) => `/customers/${id}`,
  project:  (id) => `/projects/${id}`,
  quote:    (id) => `/quotes/${id}`,
  job:      (id) => `/jobs/${id}`,
  invoice:  (id) => `/invoices/${id}`,
  vehicle:  (id) => `/vehicles/${id}`,
  employee: (id) => `/employees/${id}`,
  user:     (id) => `/users/${id}/references`,
};

function parseUserAgent(ua) {
  if (!ua) return null;
  const browser =
    /Edg\/([\d.]+)/.exec(ua)?.[0]?.replace("Edg/", "Edge ") ||
    /OPR\/([\d.]+)/.exec(ua)?.[0]?.replace("OPR/", "Opera ") ||
    /Chrome\/([\d.]+)/.exec(ua)?.[0]?.replace("Chrome/", "Chrome ") ||
    /Firefox\/([\d.]+)/.exec(ua)?.[0]?.replace("Firefox/", "Firefox ") ||
    /Safari\/([\d.]+)/.exec(ua)?.[0]?.replace("Safari/", "Safari ") || null;
  return browser;
}

function relativeTime(iso) {
  if (!iso) return "";
  const d = new Date(iso); const now = new Date();
  const diff = (now - d) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff/3600)}h ago`;
  const days = Math.floor(diff/86400);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString("en-AU", { day: "2-digit", month: "short" });
}

function compactTimestamp(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleString("en-AU", {
    day: "2-digit", month: "short",
    ...(sameYear ? {} : { year: "2-digit" }),
    hour: "2-digit", minute: "2-digit",
    hour12: false,
  });
}

function truncateMiddle(s, front = 6, back = 4) {
  if (!s) return "";
  if (s.length <= front + back + 1) return s;
  return `${s.slice(0, front)}…${s.slice(-back)}`;
}

function PrettyDiff({ changes }) {
  if (!changes || Object.keys(changes).length === 0) {
    return <div className="text-xs text-gray-400 italic" data-testid="drawer-changes-empty">No field-level changes recorded.</div>;
  }
  return (
    <div className="space-y-2" data-testid="drawer-changes">
      {Object.entries(changes).map(([key, v]) => {
        if (v && typeof v === "object" && "from" in v && "to" in v) {
          const renderVal = (val) => {
            if (val === null || val === undefined) return <em className="text-gray-400">null</em>;
            if (typeof val === "boolean") return val ? "true" : "false";
            if (typeof val === "object") return JSON.stringify(val);
            return String(val);
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

function summariseRow(e) {
  if (e.changes && Object.keys(e.changes).length) {
    return Object.keys(e.changes).slice(0, 3).join(", ");
  }
  if (e.metadata && Object.keys(e.metadata).length) {
    const md = e.metadata;
    // Prefer reason > ip > any first key
    for (const k of ["reason", "ip", "status"]) {
      if (md[k] !== undefined) return `${k}=${String(md[k]).slice(0, 40)}`;
    }
    return truncateMiddle(JSON.stringify(md), 40, 8);
  }
  return "—";
}

export default function AuditPage() {
  const { user } = useAuth();
  const isSuperAdmin = !!user?.is_super_admin;

  const [items, setItems] = useState(null);
  const [total, setTotal] = useState(0);
  const [drawer, setDrawer] = useState(null);
  const [entityExists, setEntityExists] = useState(null);
  const [params, setParams] = useSearchParams();

  const [checkedIds, setCheckedIds] = useState(new Set());
  const [expandedMeta, setExpandedMeta] = useState(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmConsent, setConfirmConsent] = useState(false);
  const [hiding, setHiding] = useState(false);

  // URL-bound filter state
  const page = parseInt(params.get("page") || "1", 10);
  const action = params.get("action") || "";
  const entityType = params.get("entity_type") || "";
  const search = params.get("search") || "";
  const dateFrom = params.get("date_from") || defaultDate(-30);
  const dateTo = params.get("date_to") || defaultDate(0);
  const focusId = params.get("focus") || "";
  const showHidden = params.get("show_hidden") === "1" && isSuperAdmin;
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
    setCheckedIds(new Set());
    try {
      const qp = new URLSearchParams();
      qp.set("page", String(page));
      qp.set("per_page", String(perPage));
      if (action) qp.set("action", action);
      if (entityType) qp.set("entity_type", entityType);
      if (search) qp.set("search", search);
      if (dateFrom) qp.set("date_from", new Date(`${dateFrom}T00:00:00Z`).toISOString());
      if (dateTo)   qp.set("date_to",   new Date(`${dateTo}T23:59:59.999Z`).toISOString());
      if (showHidden) qp.set("show_hidden", "true");
      const { data } = await api.get(`/audit?${qp}`);
      setItems(data.items); setTotal(data.total);
      if (focusId && !drawer) {
        const target = data.items.find((e) => e.id === focusId);
        if (target) setDrawer(target);
        else {
          try { const { data: ev } = await api.get(`/audit/${focusId}`); setDrawer(ev); } catch (_) { /* silent */ }
        }
      }
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ },
    [page, action, entityType, search, dateFrom, dateTo, showHidden]);

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

  // Selection helpers — meta rows are never selectable
  const selectableIds = useMemo(() =>
    (items || []).filter(e => !META_ACTIONS.has(e.action)).map(e => e.id),
    [items]);
  const allSelected = selectableIds.length > 0 && selectableIds.every(id => checkedIds.has(id));
  const someSelected = selectableIds.some(id => checkedIds.has(id));

  const toggleAll = () => {
    if (allSelected) setCheckedIds(new Set());
    else setCheckedIds(new Set(selectableIds));
  };
  const toggleOne = (id) => {
    const next = new Set(checkedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setCheckedIds(next);
  };
  const toggleMetaExpand = (id) => {
    const next = new Set(expandedMeta);
    if (next.has(id)) next.delete(id); else next.add(id);
    setExpandedMeta(next);
  };

  const doHide = async () => {
    setHiding(true);
    try {
      const ids = Array.from(checkedIds);
      const { data } = await api.post("/audit/hide", { event_ids: ids });
      toast.success(`Hidden ${data.hidden} event${data.hidden === 1 ? "" : "s"} · meta-audit written.`);
      setCheckedIds(new Set());
      setConfirmConsent(false);
      setConfirmOpen(false);
      await load();
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message);
    } finally {
      setHiding(false);
    }
  };

  const doUnhide = async (eventId) => {
    try {
      await api.post("/audit/unhide", { event_ids: [eventId] });
      toast.success("Row un-hidden · meta-audit written.");
      await load();
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message);
    }
  };

  const selectedCount = checkedIds.size;

  return (
    <TooltipProvider>
    <div className="space-y-5 pb-24" data-testid="audit-page">
      <Toaster richColors position="top-right" />
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <div className="overline">Super Admin</div>
          <h1 className="text-3xl md:text-4xl font-black tracking-tighter text-[#1F2A33] inline-flex items-center gap-2">
            <AppIcon name="audit" size={32} decorative/> Audit Trail
          </h1>
          <p className="text-sm text-gray-500 mt-1">Every business-critical action across the platform. Filter, inspect, export.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {isSuperAdmin && (
            <Button variant="outline" onClick={() => setFilter({ show_hidden: showHidden ? null : "1", page: 1 })}
                    data-testid="audit-toggle-hidden"
                    className={showHidden ? "bg-zinc-100 border-zinc-400 text-zinc-900" : ""}>
              {showHidden ? <><Eye className="w-4 h-4 mr-2"/> Showing hidden rows</> : <><EyeOff className="w-4 h-4 mr-2"/> Show hidden rows</>}
            </Button>
          )}
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

      {/* ===== Table ===== */}
      <div className="bg-white border border-gray-200 rounded overflow-hidden">
        {items === null ? (
          <div className="p-6 flex items-center gap-2 text-sm text-gray-500"><Loader2 className="w-4 h-4 animate-spin"/> Loading…</div>
        ) : items.length === 0 ? (
          <div className="p-6 text-sm text-gray-500" data-testid="audit-empty">No events match the filters.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm table-fixed min-w-[900px]" data-testid="audit-table-el">
              <colgroup>
                {isSuperAdmin && <col style={{ width: "44px" }} />}
                <col style={{ width: "128px" }} />
                <col style={{ width: "180px" }} />
                <col style={{ width: "180px" }} />
                <col style={{ width: "110px" }} />
                <col />
                <col style={{ width: "220px" }} />
              </colgroup>
              <thead className="bg-[#3A6B8C] text-white uppercase text-[10px] tracking-wider select-none">
                <tr>
                  {isSuperAdmin && (
                    <th className="px-3 py-2.5 text-left">
                      <Checkbox
                        checked={allSelected ? true : (someSelected ? "indeterminate" : false)}
                        onCheckedChange={toggleAll}
                        data-testid="audit-check-all"
                        aria-label="Select all"
                        className="border-white/40 data-[state=checked]:bg-white data-[state=checked]:text-[#3A6B8C] data-[state=indeterminate]:bg-white data-[state=indeterminate]:text-[#3A6B8C]"/>
                    </th>
                  )}
                  <th className="px-3 py-2.5 text-left">When</th>
                  <th className="px-3 py-2.5 text-left">Actor</th>
                  <th className="px-3 py-2.5 text-left">Action</th>
                  <th className="px-3 py-2.5 text-left">Entity</th>
                  <th className="px-3 py-2.5 text-left">Label</th>
                  <th className="px-3 py-2.5 text-left">Summary</th>
                </tr>
              </thead>
              <tbody data-testid="audit-table">
                {items.map((e) => {
                  const isMeta = META_ACTIONS.has(e.action);
                  const isHidden = !!e.hidden_from_view;
                  const checked = checkedIds.has(e.id);
                  return (
                    <tr key={e.id}
                        className={`border-t border-gray-200 hover:bg-gray-50 cursor-pointer ${isHidden ? "opacity-60 bg-zinc-50/70" : ""} ${checked ? "bg-yellow-50/60" : ""}`}
                        data-testid={`audit-row-${e.id}`}
                        onClick={(ev) => {
                          // Ignore clicks originating from the checkbox cell or its children
                          if (ev.target.closest('[data-cell="check"]')) return;
                          setDrawer(e);
                        }}>
                      {isSuperAdmin && (
                        <td data-cell="check" className="px-3 py-2 align-middle">
                          {isMeta ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="inline-flex items-center justify-center w-5 h-5 text-[9px] font-bold uppercase tracking-wider text-zinc-500 bg-zinc-100 border border-zinc-300 rounded"
                                      data-testid={`audit-meta-pill-${e.id}`}>M</span>
                              </TooltipTrigger>
                              <TooltipContent>Meta-audit event — immutable, cannot be hidden.</TooltipContent>
                            </Tooltip>
                          ) : (
                            <Checkbox checked={checked} onCheckedChange={() => toggleOne(e.id)}
                                       data-testid={`audit-check-${e.id}`} aria-label="Select row"/>
                          )}
                        </td>
                      )}
                      <td className="px-3 py-2 text-xs text-gray-600 whitespace-nowrap">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span>{compactTimestamp(e.timestamp)}</span>
                          </TooltipTrigger>
                          <TooltipContent><span className="font-mono text-[11px]">{e.timestamp}</span></TooltipContent>
                        </Tooltip>
                        <div className="text-[10px] text-gray-400">{relativeTime(e.timestamp)}</div>
                      </td>
                      <td className="px-3 py-2 text-xs min-w-0">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="min-w-0">
                              <div className="font-medium text-[#1F2A33] truncate" data-testid={`audit-actor-${e.id}`}>{e.actor_name || e.actor_email || "System"}</div>
                              <div className="text-gray-400 text-[10px] truncate">{e.actor_email}</div>
                            </div>
                          </TooltipTrigger>
                          <TooltipContent><div className="text-xs">{e.actor_name || "System"}<br/><span className="text-gray-300">{e.actor_email}</span></div></TooltipContent>
                        </Tooltip>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded inline-flex items-center gap-1 ${ACTION_COLOR[e.action] || "bg-gray-100 text-gray-700"}`}>
                          <AppIcon name={ACTION_ICON[e.action] || "info"} size={14} decorative/>
                          <span className="truncate max-w-[120px]">{e.action}</span>
                        </span>
                        {isHidden && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="ml-1 text-[9px] uppercase tracking-wider bg-zinc-200 text-zinc-800 px-1 py-0.5 rounded" data-testid={`audit-hidden-pill-${e.id}`}>hidden</span>
                            </TooltipTrigger>
                            <TooltipContent>Hidden by user_id={e.hidden_by_user_id?.slice(0,8) || "?"} at {compactTimestamp(e.hidden_at)}</TooltipContent>
                          </Tooltip>
                        )}
                        {isMeta && (
                          <span className="ml-1 text-[9px] uppercase tracking-wider bg-zinc-100 text-zinc-700 border border-zinc-300 px-1 py-0.5 rounded">meta</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-600 truncate">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span>{e.entity_type}</span>
                          </TooltipTrigger>
                          <TooltipContent>{e.entity_id ? <span className="font-mono">{e.entity_id}</span> : "no entity id"}</TooltipContent>
                        </Tooltip>
                      </td>
                      <td className="px-3 py-2 text-xs font-mono truncate">
                        <Tooltip>
                          <TooltipTrigger asChild><span className="truncate inline-block max-w-full align-bottom">{e.entity_label || "—"}</span></TooltipTrigger>
                          <TooltipContent><span className="font-mono text-[11px] break-all">{e.entity_label}</span></TooltipContent>
                        </Tooltip>
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-500 truncate">
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            className="text-gray-400 hover:text-[#1F2A33] shrink-0"
                            onClick={(ev) => { ev.stopPropagation(); toggleMetaExpand(e.id); }}
                            aria-label="Expand metadata"
                            data-testid={`audit-expand-${e.id}`}>
                            {expandedMeta.has(e.id) ? <ChevronDown className="w-3.5 h-3.5"/> : <ChevronRight className="w-3.5 h-3.5"/>}
                          </button>
                          <span className="truncate">{summariseRow(e)}</span>
                          {isHidden && isSuperAdmin && !isMeta && (
                            <button
                              type="button"
                              onClick={(ev) => { ev.stopPropagation(); doUnhide(e.id); }}
                              className="ml-auto text-[10px] uppercase tracking-wider text-emerald-700 hover:underline shrink-0"
                              data-testid={`audit-unhide-${e.id}`}>Un-hide</button>
                          )}
                        </div>
                        {expandedMeta.has(e.id) && (
                          <pre className="mt-1 text-[10px] leading-tight bg-gray-50 border border-gray-200 rounded p-1.5 whitespace-pre-wrap break-words max-h-40 overflow-y-auto">
{JSON.stringify({ changes: e.changes || null, metadata: e.metadata || null }, null, 2)}
                          </pre>
                        )}
                      </td>
                    </tr>
                  );
                })}
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

      {/* ===== Floating action bar (super admin, ≥1 selected) ===== */}
      {isSuperAdmin && selectedCount > 0 && (
        <div className="fixed left-1/2 -translate-x-1/2 bottom-6 z-40 bg-[#1F2A33] text-white shadow-2xl rounded-full px-5 py-3 flex items-center gap-3 border border-black/20"
             data-testid="audit-bulk-bar">
          <span className="text-sm font-bold" data-testid="audit-bulk-count">{selectedCount} selected</span>
          <Button size="sm" onClick={() => { setConfirmConsent(false); setConfirmOpen(true); }}
                  className="bg-[#F5C518] text-[#1F2A33] font-bold hover:bg-[#E0B416]"
                  data-testid="audit-bulk-hide-btn">
            <EyeOff className="w-4 h-4 mr-1.5"/> Hide selected
          </Button>
          <Button size="sm" variant="outline" onClick={() => setCheckedIds(new Set())}
                  className="border-white/30 bg-transparent text-white hover:bg-white/10 hover:text-white"
                  data-testid="audit-bulk-clear-btn">Clear</Button>
        </div>
      )}

      {/* ===== Confirm dialog ===== */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent data-testid="audit-hide-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>Hide {selectedCount} audit event{selectedCount === 1 ? "" : "s"}?</AlertDialogTitle>
            <AlertDialogDescription>
              These rows will be flagged <strong>hidden</strong> but retained in the database for
              compliance. A meta-audit entry will be written for each. Only Super Admins can view
              hidden rows via the toggle above.
              <br/><br/>
              <span className="text-[11px] text-gray-500">
                Compliance note (Tasmania AU — AS 3850 / NCC 2022): hidden rows remain in the database
                and are exportable via <code>Export CSV</code> if requested by auditors.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <label className="flex items-start gap-2 text-sm py-2 select-none cursor-pointer">
            <Checkbox checked={confirmConsent} onCheckedChange={(v) => setConfirmConsent(!!v)}
                       data-testid="audit-hide-consent"/>
            <span>I understand this action is logged and non-destructive.</span>
          </label>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="audit-hide-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={doHide}
              disabled={!confirmConsent || hiding}
              className="bg-[#F5C518] text-[#1F2A33] font-bold hover:bg-[#E0B416] disabled:opacity-50"
              data-testid="audit-hide-confirm-btn">
              {hiding ? <><Loader2 className="w-4 h-4 mr-2 animate-spin"/>Hiding…</> : "Hide events"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
                {drawer.hidden_from_view && (
                  <div className="bg-zinc-100 border border-zinc-300 rounded p-3 text-xs">
                    <div className="font-bold uppercase tracking-wider text-zinc-800 mb-1">Row hidden from default view</div>
                    <div className="text-zinc-700">
                      Hidden by user <span className="font-mono">{drawer.hidden_by_user_id?.slice(0,12)}…</span> at {formatDateTime(drawer.hidden_at)}.
                      This row remains in the database and CSV exports.
                    </div>
                  </div>
                )}

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

                <section data-testid="drawer-changes-section">
                  <div className="text-[10px] uppercase tracking-wider font-bold text-[#3A6B8C] mb-1.5">Changes</div>
                  <PrettyDiff changes={drawer.changes} />
                </section>

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

export { UserBadge };
