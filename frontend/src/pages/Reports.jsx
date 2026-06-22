import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Users, FileText, Briefcase, Receipt, Truck, Wrench, TrendingUp, BarChart3, Download, Database, AlertTriangle, Loader2, Plus, Copy, KeyRound, ShieldOff, Check } from "lucide-react";
import AppIcon from "../components/AppIcon";
import { useAuth } from "../contexts/AuthContext";
import { api, tokenStore, API_BASE } from "../lib/api";
import { formatAUD } from "../lib/format";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../components/ui/tabs";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Checkbox } from "../components/ui/checkbox";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "../components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "../components/ui/dialog";
import { toast } from "sonner";

const CARDS = [
  { key:"customers", title:"Customers", desc:"Top accounts, growth, activity",      icon:Users,      perm:"customers.view",  kpi:(k)=>[`Active: ${k.active_customers}`, `Top: ${formatAUD(k.top_customer_revenue_aud||0)}`]},
  { key:"quotes",    title:"Quotes",    desc:"Pipeline, win rate, value over time", icon:FileText,   perm:"quotes.view",     kpi:(k)=>[`Sent: ${k.quotes_sent}`, `Win: ${k.win_rate_pct}%`]},
  { key:"jobs",      title:"Jobs",      desc:"Throughput, cycle time, on-time %",   icon:Briefcase,  perm:"jobs.view",       kpi:(k)=>[`Active: ${k.active_jobs}`, `On-time: ${k.on_time_delivery_pct}%`]},
  { key:"invoices",  title:"Invoices",  desc:"Outstanding, aging, days-to-pay",     icon:Receipt,    perm:"invoices.view",   kpi:(k)=>[`Outstanding: ${formatAUD(k.total_outstanding_aud||0)}`, `Overdue: ${k.overdue_count}`]},
  { key:"vehicles",  title:"Vehicles",  desc:"Fleet utilisation",                   icon:Truck,      perm:"vehicles.view",   kpi:(k)=>[`Total: ${k.total_vehicles}`, `Active: ${k.active_vehicles}`]},
  { key:"employees", title:"Employees", desc:"Workload & assignment trends",        icon:Wrench,     perm:"employees.view",  kpi:(k)=>[`Active: ${k.active_employees}`, `Assignments: ${k.total_assignments}`]},
  { key:"margin",    title:"Pricing & Margin", desc:"Margin by panel, finish, month — INTERNAL", icon:TrendingUp, perm:"pricing.view_costs", kpi:(k)=>[`Avg ${k.avg_margin_pct}%`, `Quoted: ${formatAUD(k.total_quoted_margin_aud||0)}`]},
  { key:"compliance",title:"Compliance",desc:"QC forms, NCR rate, QA sign-off pipeline",icon:BarChart3,perm:"forms.view",kpi:(k)=>[`Awaiting QA: ${k.awaiting_qa_signoff||0}`,`NCR ${k.ncr_rate_pct||0}%`]},
];

export default function Reports() {
  const { hasPerm, isSuperAdmin } = useAuth();
  const [previews, setPreviews] = useState({});
  const visible = CARDS.filter(c => isSuperAdmin || hasPerm(c.perm));

  useEffect(() => {
    visible.forEach(c => {
      api.get(`/reports/${c.key}`).then(r => setPreviews(p => ({...p, [c.key]: r.data.kpis}))).catch(() => {});
    });
    // eslint-disable-next-line
  }, []);

  return (
    <div className="max-w-7xl space-y-6" data-testid="reports-page">
      <div>
        <div className="overline">Insights</div>
        <h1 className="text-3xl md:text-4xl font-black tracking-tighter text-[#1F2A33] inline-flex items-center gap-2">
          <AppIcon name="reports" size={32} decorative/> Reports
        </h1>
        <p className="text-sm text-gray-500 mt-1">Operational insights, data export, BI integration.</p>
      </div>

      <Tabs defaultValue="dashboards">
        <TabsList data-testid="reports-tabs">
          <TabsTrigger value="dashboards" data-testid="tab-dashboards">Dashboards</TabsTrigger>
          <TabsTrigger value="export" data-testid="tab-export" disabled={!isSuperAdmin}>Data Export</TabsTrigger>
          <TabsTrigger value="bi" data-testid="tab-bi" disabled={!isSuperAdmin}>Power BI Integration</TabsTrigger>
        </TabsList>

        <TabsContent value="dashboards" className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-4" data-testid="report-cards">
            {visible.map(c => {
              const Icon = c.icon;
              const k = previews[c.key];
              return (
                <Link key={c.key} to={`/reports/${c.key}`} data-testid={`report-card-${c.key}`}
                      className="bg-white border border-gray-200 rounded p-5 hover:border-[#F5C518] hover:shadow-md transition-all group">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="text-[10px] uppercase tracking-wider font-bold text-[#3A6B8C]">{c.title}</div>
                      <div className="text-sm text-gray-500 mt-1">{c.desc}</div>
                    </div>
                    <Icon className="w-5 h-5 text-[#3A6B8C]"/>
                  </div>
                  <div className="mt-3 space-y-1">
                    {k ? c.kpi(k).map((s, i) => (
                      <div key={i} className="text-xs font-semibold text-[#1F2A33] tabular-nums">{s}</div>
                    )) : <div className="text-xs text-gray-400">Loading…</div>}
                  </div>
                </Link>
              );
            })}
            {visible.length === 0 && (
              <div className="col-span-3 p-8 text-sm text-gray-500 text-center bg-white border border-gray-200 rounded">
                No reports available with your current permissions.
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="export" data-testid="export-tab-content">
          {!isSuperAdmin ? (
            <div className="p-8 bg-white border border-gray-200 rounded text-center text-sm text-gray-500">
              Data export is available to super admins only.
            </div>
          ) : (
            <DataExportForm/>
          )}
        </TabsContent>

        <TabsContent value="bi" data-testid="bi-tab-content">
          {!isSuperAdmin ? (
            <div className="p-8 bg-white border border-gray-200 rounded text-center text-sm text-gray-500">
              BI integration is available to super admins only.
            </div>
          ) : (
            <BiIntegrationPanel/>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

const EXPORT_MODULES = [
  { key: "customers", label: "Customers" },
  { key: "projects",  label: "Projects" },
  { key: "quotes",    label: "Quotes" },
  { key: "jobs",      label: "Jobs" },
  { key: "invoices",  label: "Invoices" },
  { key: "vehicles",  label: "Vehicles" },
  { key: "employees", label: "Employees" },
  { key: "audit",     label: "Audit Events" },
];

function defaultDate(days) {
  const d = new Date(); d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function DataExportForm() {
  const [module, setModule] = useState("customers");
  const [allTime, setAllTime] = useState(false);
  const [dateFrom, setDateFrom] = useState(defaultDate(-90));
  const [dateTo, setDateTo] = useState(defaultDate(0));
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const handleDownload = async () => {
    setLoading(true); setError(""); setResult(null);
    try {
      const params = new URLSearchParams();
      if (!allTime) {
        if (dateFrom) params.set("date_from", dateFrom);
        if (dateTo) params.set("date_to", dateTo);
      }
      if (includeDeleted) params.set("include_deleted", "true");
      const url = `${API_BASE}/data-export/${module}.csv?${params.toString()}`;
      const r = await fetch(url, { headers: { Authorization: `Bearer ${tokenStore.get()}` } });
      if (!r.ok) {
        const detail = await r.text();
        throw new Error(`${r.status}: ${detail.slice(0, 200)}`);
      }
      const capped = r.headers.get("X-Export-Capped") === "true";
      const blob = await r.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objUrl;
      const stamp = new Date().toISOString().slice(0, 10);
      a.download = `${module}-export-${stamp}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(objUrl);
      setResult({ ok: true, capped, size: blob.size });
    } catch (e) {
      setError(e.message || "Export failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white border border-gray-200 rounded p-6 space-y-5 mt-4" data-testid="data-export-form">
      <div className="flex items-start gap-3">
        <AppIcon name="audit" size={24} decorative/>
        <div>
          <div className="text-base font-bold text-[#1F2A33]">Bulk CSV Export</div>
          <p className="text-xs text-gray-500 mt-1">Stream-download a flattened CSV dump of any entity module. Capped at 100,000 rows per request — a trailing cap marker row is appended when triggered.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div>
          <Label className="text-[10px] uppercase tracking-wider font-bold text-gray-500">Module</Label>
          <Select value={module} onValueChange={setModule}>
            <SelectTrigger className="mt-1" data-testid="export-module-select"><SelectValue/></SelectTrigger>
            <SelectContent>
              {EXPORT_MODULES.map(m => (
                <SelectItem key={m.key} value={m.key} data-testid={`export-module-${m.key}`}>{m.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-[10px] uppercase tracking-wider font-bold text-gray-500">Date from</Label>
          <Input type="date" value={dateFrom} disabled={allTime}
                 onChange={(e) => setDateFrom(e.target.value)}
                 className="mt-1" data-testid="export-date-from"/>
        </div>
        <div>
          <Label className="text-[10px] uppercase tracking-wider font-bold text-gray-500">Date to</Label>
          <Input type="date" value={dateTo} disabled={allTime}
                 onChange={(e) => setDateTo(e.target.value)}
                 className="mt-1" data-testid="export-date-to"/>
        </div>
        <div className="space-y-3 pt-5">
          <label className="flex items-center gap-2 text-xs text-[#1F2A33] cursor-pointer">
            <Checkbox checked={allTime} onCheckedChange={(v) => setAllTime(!!v)} data-testid="export-all-time"/>
            <span>All time (ignore dates)</span>
          </label>
          <label className="flex items-center gap-2 text-xs text-[#1F2A33] cursor-pointer">
            <Checkbox checked={includeDeleted} onCheckedChange={(v) => setIncludeDeleted(!!v)} data-testid="export-include-deleted"/>
            <span>Include soft-deleted</span>
          </label>
        </div>
      </div>

      <div className="flex items-center gap-3 pt-2 border-t border-gray-100">
        <Button onClick={handleDownload} disabled={loading} data-testid="export-download-btn"
                className="bg-[#F5C518] text-[#1F2A33] font-bold hover:bg-[#E0B416]">
          {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin"/> : <AppIcon name="download" size={16} className="mr-2" decorative/>}
          {loading ? "Preparing CSV…" : "Download CSV"}
        </Button>
        {result && !result.capped && (
          <div className="text-xs text-green-700 font-semibold" data-testid="export-result-ok">
            Download complete — {(result.size/1024).toFixed(1)} KB.
          </div>
        )}
        {result && result.capped && (
          <div className="text-xs text-amber-700 font-semibold inline-flex items-center gap-1" data-testid="export-result-capped">
            <AppIcon name="warning" size={16} decorative/> Export capped at 100,000 rows — refine your date range to get more.
          </div>
        )}
        {error && <div className="text-xs text-red-700 font-semibold" data-testid="export-error">{error}</div>}
      </div>
    </div>
  );
}


// ===========================================================================
// Power BI Integration tab — Phase 8 Pass 3
// ===========================================================================
const BI_ENDPOINTS = [
  { key: "customers", path: "/api/reporting/v1/customers", sample: '{"items":[{"id":"…","company_name":"Harbour Construction"}], "total":42, "page":1, "per_page":100}' },
  { key: "quotes",    path: "/api/reporting/v1/quotes",    sample: '{"items":[{"id":"…","quote_number":"Q-2026-0001","total_aud":12450.00}], "total":18, "page":1, "per_page":100}' },
  { key: "jobs",      path: "/api/reporting/v1/jobs",      sample: '{"items":[{"id":"…","job_number":"J-2026-0001","status":"in_production"}], "total":7, "page":1, "per_page":100}' },
  { key: "invoices",  path: "/api/reporting/v1/invoices",  sample: '{"items":[{"id":"…","invoice_number":"INV-2026-0001","total":13695}], "total":12, "page":1, "per_page":100}' },
  { key: "vehicles",  path: "/api/reporting/v1/vehicles",  sample: '{"items":[{"id":"…","vehicle_code":"V-001"}], "total":6, "page":1, "per_page":100}' },
  { key: "employees", path: "/api/reporting/v1/employees", sample: '{"items":[{"id":"…","name":"Mark Henderson"}], "total":7, "page":1, "per_page":100}' },
];

function CopyButton({ value, testId }) {
  const [copied, setCopied] = useState(false);
  const handle = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true); setTimeout(() => setCopied(false), 1500);
    } catch { /* fallback */
      const ta = document.createElement("textarea"); ta.value = value;
      document.body.appendChild(ta); ta.select(); document.execCommand("copy");
      ta.remove(); setCopied(true); setTimeout(() => setCopied(false), 1500);
    }
  };
  return (
    <Button onClick={handle} size="sm" variant="outline" data-testid={testId}>
      {copied ? <Check className="w-4 h-4 mr-1"/> : <AppIcon name="copy" size={16} className="mr-1" decorative/>}
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

function BiIntegrationPanel() {
  const [tokens, setTokens] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [rawToken, setRawToken] = useState(null); // {name, token, prefix}
  const [revokingId, setRevokingId] = useState(null);
  const appUrl = process.env.REACT_APP_BACKEND_URL || "";

  const load = async () => {
    try { const r = await api.get("/reporting/tokens"); setTokens(r.data || []); }
    catch (e) { toast.error(e.response?.data?.detail || "Failed to load tokens"); setTokens([]); }
  };
  useEffect(() => { load(); }, []);

  const handleCreate = async () => {
    if (!newName.trim()) { toast.error("Token name is required"); return; }
    setCreating(true);
    try {
      const r = await api.post("/reporting/tokens", { name: newName.trim() });
      setRawToken({ name: r.data.name, token: r.data.token, prefix: r.data.token_prefix });
      setShowCreate(false); setNewName("");
      await load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to create token");
    } finally { setCreating(false); }
  };

  const handleRevoke = async (id, name) => {
    if (!window.confirm(`Revoke token "${name}"? Any BI tool using this token will lose access immediately.`)) return;
    setRevokingId(id);
    try {
      await api.post(`/reporting/tokens/${id}/revoke`);
      toast.success("Token revoked");
      await load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to revoke");
    } finally { setRevokingId(null); }
  };

  return (
    <div className="space-y-5 mt-4" data-testid="bi-integration-panel">
      {/* Section 1: Connection Guide */}
      <div className="bg-white border border-gray-200 rounded p-6 space-y-4">
        <div className="flex items-start gap-3">
          <AppIcon name="password_changed" size={24} decorative/>
          <div>
            <div className="text-base font-bold text-[#1F2A33]">Connect Power BI / Excel / Tableau</div>
            <p className="text-xs text-gray-500 mt-1">Long-lived API tokens give external BI tools read-only access to your data. Tokens are scoped to <code className="bg-gray-100 px-1 rounded">/api/reporting/v1/*</code> — they cannot read pricing/cost/margin internals.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="border border-gray-200 rounded p-4">
            <div className="text-[10px] uppercase tracking-wider font-bold text-[#3A6B8C] mb-2">Power BI Desktop</div>
            <ol className="text-xs text-gray-700 space-y-1.5 list-decimal ml-4">
              <li>Get Data → <strong>Web</strong> → <strong>Advanced</strong></li>
              <li>URL: <code className="bg-gray-100 px-1 rounded text-[11px]">{appUrl}/api/reporting/v1/customers</code></li>
              <li>HTTP Request Header Parameters → add <code className="bg-gray-100 px-1 rounded">X-BI-Token</code> with your raw token value</li>
              <li>OK → Anonymous auth → Load</li>
            </ol>
          </div>
          <div className="border border-gray-200 rounded p-4">
            <div className="text-[10px] uppercase tracking-wider font-bold text-[#3A6B8C] mb-2">Excel Power Query</div>
            <ol className="text-xs text-gray-700 space-y-1.5 list-decimal ml-4">
              <li>Data → From Web → Advanced</li>
              <li>Same URL as Power BI</li>
              <li>Add header <code className="bg-gray-100 px-1 rounded">X-BI-Token</code> = your token</li>
              <li>Load &amp; Transform → Close &amp; Load</li>
            </ol>
          </div>
          <div className="border border-gray-200 rounded p-4">
            <div className="text-[10px] uppercase tracking-wider font-bold text-[#3A6B8C] mb-2">Tableau (WDC)</div>
            <ol className="text-xs text-gray-700 space-y-1.5 list-decimal ml-4">
              <li>Connect → Web Data Connector</li>
              <li>Point at <code className="bg-gray-100 px-1 rounded text-[11px]">/api/reporting/v1/...</code></li>
              <li>Set the <code className="bg-gray-100 px-1 rounded">X-BI-Token</code> request header</li>
              <li>Iterate <code className="bg-gray-100 px-1 rounded">?page=N&amp;per_page=1000</code></li>
            </ol>
          </div>
        </div>

        <div>
          <div className="text-[10px] uppercase tracking-wider font-bold text-[#3A6B8C] mb-2">Available endpoints (read-only)</div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-[#3A6B8C] text-white uppercase text-[10px] tracking-wider">
                <tr><th className="px-3 py-2 text-left">Endpoint</th><th className="px-3 py-2 text-left">Sample response shape</th></tr>
              </thead>
              <tbody>
                {BI_ENDPOINTS.map(e => (
                  <tr key={e.key} className="border-t border-gray-200">
                    <td className="px-3 py-2 font-mono align-top whitespace-nowrap">{e.path}</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-gray-600 break-all">{e.sample}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-gray-600">
          <div className="bg-amber-50 border border-amber-200 rounded p-3">
            <div className="font-bold text-amber-900 mb-1">Token rotation</div>
            Rotate every 90 days; revoke immediately if compromised. Tokens are read-only — exposure risk is limited but real.
          </div>
          <div className="bg-blue-50 border border-blue-200 rounded p-3">
            <div className="font-bold text-blue-900 mb-1">Limits</div>
            Max <strong>1,000 rows</strong> per page. Use <code className="bg-white px-1 rounded">?page=N&amp;per_page=1000</code> to iterate. Add <code className="bg-white px-1 rounded">?date_from=YYYY-MM-DD</code> &amp; <code className="bg-white px-1 rounded">?date_to=YYYY-MM-DD</code> to filter.
          </div>
        </div>
      </div>

      {/* Section 2: Manage tokens */}
      <div className="bg-white border border-gray-200 rounded p-6 space-y-4" data-testid="bi-tokens-section">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="text-base font-bold text-[#1F2A33]">API Tokens</div>
            <p className="text-xs text-gray-500 mt-1">Manage long-lived tokens for BI tool connections. Max 20 active.</p>
          </div>
          <Button onClick={() => setShowCreate(true)} data-testid="bi-create-token-btn"
                  className="bg-[#F5C518] text-[#1F2A33] font-bold hover:bg-[#E0B416]">
            <AppIcon name="add" size={16} className="mr-1" decorative/> Generate new token
          </Button>
        </div>

        {tokens === null ? (
          <div className="flex items-center gap-2 text-gray-500 text-sm"><Loader2 className="w-4 h-4 animate-spin"/> Loading…</div>
        ) : tokens.length === 0 ? (
          <div className="p-6 text-center text-sm text-gray-500 border border-dashed border-gray-300 rounded">
            No tokens yet. Click "Generate new token" to create your first one.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="bi-tokens-table">
              <thead className="bg-[#3A6B8C] text-white uppercase text-[10px] tracking-wider">
                <tr>
                  <th className="px-3 py-2 text-left">Name</th>
                  <th className="px-3 py-2 text-left">Prefix</th>
                  <th className="px-3 py-2 text-left">Created by</th>
                  <th className="px-3 py-2 text-left">Created</th>
                  <th className="px-3 py-2 text-left">Last used</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {tokens.map(t => {
                  const revoked = !!t.revoked_at;
                  return (
                    <tr key={t.id} className={`border-t border-gray-200 ${revoked ? "text-gray-400 line-through" : ""}`}
                        data-testid={`bi-token-row-${t.id}`}>
                      <td className="px-3 py-2 font-semibold text-[#1F2A33]">{t.name}</td>
                      <td className="px-3 py-2 font-mono text-xs">{t.token_prefix}…</td>
                      <td className="px-3 py-2 text-xs text-gray-600">{t.created_by_name}</td>
                      <td className="px-3 py-2 text-xs text-gray-600">{(t.created_at || "").slice(0, 10)}</td>
                      <td className="px-3 py-2 text-xs text-gray-600">{t.last_used_at ? t.last_used_at.slice(0, 16).replace("T", " ") : "—"}</td>
                      <td className="px-3 py-2">
                        {revoked
                          ? <span className="text-[10px] font-bold uppercase tracking-wider bg-red-100 text-red-800 px-2 py-0.5 rounded">Revoked</span>
                          : <span className="text-[10px] font-bold uppercase tracking-wider bg-green-100 text-green-800 px-2 py-0.5 rounded">Active</span>}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {!revoked && (
                          <Button size="sm" variant="outline" onClick={() => handleRevoke(t.id, t.name)}
                                  disabled={revokingId === t.id} data-testid={`bi-revoke-${t.id}`}
                                  className="text-red-700 hover:bg-red-50 border-red-200">
                            <AppIcon name="locked" size={12} className="mr-1" decorative/> Revoke
                          </Button>
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

      {/* Create modal */}
      <Dialog open={showCreate} onOpenChange={(v) => { if (!creating) setShowCreate(v); }}>
        <DialogContent data-testid="bi-create-token-modal">
          <DialogHeader>
            <DialogTitle>Generate new BI API token</DialogTitle>
            <DialogDescription>Give it a memorable name — e.g. "Power BI - Sales Dashboard" or "Excel - Monthly Recap".</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="bi-token-name" className="text-xs uppercase tracking-wider font-bold text-gray-500">Token name</Label>
            <Input id="bi-token-name" value={newName} onChange={(e) => setNewName(e.target.value)}
                   maxLength={80} placeholder="Power BI - Sales Dashboard"
                   data-testid="bi-create-name-input"/>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)} disabled={creating} data-testid="bi-create-cancel">Cancel</Button>
            <Button onClick={handleCreate} disabled={creating}
                    className="bg-[#F5C518] text-[#1F2A33] font-bold hover:bg-[#E0B416]"
                    data-testid="bi-create-submit">
              {creating ? <Loader2 className="w-4 h-4 mr-2 animate-spin"/> : null}
              {creating ? "Generating…" : "Generate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Show-once raw token modal */}
      <Dialog open={!!rawToken} onOpenChange={(v) => { if (!v) setRawToken(null); }}>
        <DialogContent data-testid="bi-raw-token-modal" className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="inline-flex items-center gap-2">
              <AppIcon name="warning" size={20} decorative/> Save this token now
            </DialogTitle>
            <DialogDescription className="text-amber-700">
              This raw token value will <strong>never</strong> be shown again. Copy it now and paste it into your BI tool's credentials.
            </DialogDescription>
          </DialogHeader>
          {rawToken && (
            <div className="space-y-3 py-2">
              <div className="text-xs">
                <div className="text-[10px] uppercase tracking-wider font-bold text-gray-500 mb-1">Name</div>
                <div className="font-semibold text-[#1F2A33]">{rawToken.name}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider font-bold text-gray-500 mb-1">Raw token</div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 bg-gray-50 border border-gray-200 rounded p-3 font-mono text-[12px] break-all" data-testid="bi-raw-token-value">
                    {rawToken.token}
                  </code>
                  <CopyButton value={rawToken.token} testId="bi-raw-token-copy"/>
                </div>
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded p-3 text-xs text-amber-900">
                Treat this like a password. Anyone with this token can read your customers, quotes, jobs, invoices, vehicles &amp; employees. Cost &amp; margin data are filtered out.
              </div>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setRawToken(null)} data-testid="bi-raw-token-confirm"
                    className="bg-[#1F2A33] text-white hover:bg-[#3A6B8C]">
              I've saved it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
