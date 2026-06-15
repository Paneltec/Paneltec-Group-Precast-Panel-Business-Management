import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Users, FileText, Briefcase, Receipt, Truck, Wrench, TrendingUp, BarChart3, Download, Database } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { api } from "../lib/api";
import { formatAUD } from "../lib/format";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../components/ui/tabs";

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
            <div className="p-8 bg-white border border-gray-200 rounded text-center text-sm text-gray-500">
              <Database className="w-10 h-10 mx-auto text-[#3A6B8C] mb-3"/>
              Coming in Pass 2 — bulk CSV export for any entity module.
            </div>
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
