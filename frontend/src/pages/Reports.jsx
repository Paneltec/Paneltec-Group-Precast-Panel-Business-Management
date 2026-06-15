import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Users, FileText, Briefcase, Receipt, Truck, Wrench, TrendingUp, BarChart3, Download, Database, AlertTriangle, Loader2 } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { api, tokenStore, API_BASE } from "../lib/api";
import { formatAUD } from "../lib/format";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../components/ui/tabs";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Checkbox } from "../components/ui/checkbox";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "../components/ui/select";

const CARDS = [
  { key:"customers", title:"Customers", desc:"Top accounts, growth, activity",      icon:Users,      perm:"customers.view",  kpi:(k)=>[`Active: ${k.active_customers}`, `Top: ${formatAUD(k.top_customer_revenue_aud||0)}`]},
  { key:"quotes",    title:"Quotes",    desc:"Pipeline, win rate, value over time", icon:FileText,   perm:"quotes.view",     kpi:(k)=>[`Sent: ${k.quotes_sent}`, `Win: ${k.win_rate_pct}%`]},
  { key:"jobs",      title:"Jobs",      desc:"Throughput, cycle time, on-time %",   icon:Briefcase,  perm:"jobs.view",       kpi:(k)=>[`Active: ${k.active_jobs}`, `On-time: ${k.on_time_delivery_pct}%`]},
  { key:"invoices",  title:"Invoices",  desc:"Outstanding, aging, days-to-pay",     icon:Receipt,    perm:"invoices.view",   kpi:(k)=>[`Outstanding: ${formatAUD(k.total_outstanding_aud||0)}`, `Overdue: ${k.overdue_count}`]},
  { key:"vehicles",  title:"Vehicles",  desc:"Fleet utilisation",                   icon:Truck,      perm:"vehicles.view",   kpi:(k)=>[`Total: ${k.total_vehicles}`, `Active: ${k.active_vehicles}`]},
  { key:"employees", title:"Employees", desc:"Workload & assignment trends",        icon:Wrench,     perm:"employees.view",  kpi:(k)=>[`Active: ${k.active_employees}`, `Assignments: ${k.total_assignments}`]},
  { key:"margin",    title:"Pricing & Margin", desc:"Margin by panel, finish, month — INTERNAL", icon:TrendingUp, perm:"pricing.view_costs", kpi:(k)=>[`Avg ${k.avg_margin_pct}%`, `Quoted: ${formatAUD(k.total_quoted_margin_aud||0)}`]},
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
          <BarChart3 className="w-8 h-8 text-[#3A6B8C]"/> Reports
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
            <div className="p-8 bg-white border border-gray-200 rounded text-center text-sm text-gray-500">
              <Download className="w-10 h-10 mx-auto text-[#3A6B8C] mb-3"/>
              Coming in Pass 3 — long-lived API tokens for Power BI, Excel Power Query, Tableau.
            </div>
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
        <Database className="w-6 h-6 text-[#3A6B8C] shrink-0 mt-1"/>
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
          {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin"/> : <Download className="w-4 h-4 mr-2"/>}
          {loading ? "Preparing CSV…" : "Download CSV"}
        </Button>
        {result && !result.capped && (
          <div className="text-xs text-green-700 font-semibold" data-testid="export-result-ok">
            Download complete — {(result.size/1024).toFixed(1)} KB.
          </div>
        )}
        {result && result.capped && (
          <div className="text-xs text-amber-700 font-semibold inline-flex items-center gap-1" data-testid="export-result-capped">
            <AlertTriangle className="w-4 h-4"/> Export capped at 100,000 rows — refine your date range to get more.
          </div>
        )}
        {error && <div className="text-xs text-red-700 font-semibold" data-testid="export-error">{error}</div>}
      </div>
    </div>
  );
}
