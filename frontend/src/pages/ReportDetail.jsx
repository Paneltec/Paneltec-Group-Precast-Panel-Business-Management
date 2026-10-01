import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Download, Lock, Loader2 } from "lucide-react";
import AppIcon from "../components/AppIcon";
import { BarChart, Bar, LineChart, Line, PieChart, Pie, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, Legend } from "recharts";
import { api, tokenStore } from "../lib/api";
import { useAuth } from "../contexts/AuthContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "../components/ui/dialog";
import { formatAUD } from "../lib/format";
import { toast } from "sonner";
import ReportRowActions, { evaluateLock as evaluateLockUnsafe } from "../components/ReportRowActions";

// Phase 11.3 — Report keys that expose Edit/Delete row actions.
// Audit Trail and Margin are intentionally excluded.
const ROW_ACTION_BY_KEY = {
  customers:          { entity: "customers",         editPerm: "customers.edit", deletePerm: "customers.delete" },
  quotes:             { entity: "quotes",            editPerm: "quotes.edit",    deletePerm: "quotes.delete" },
  jobs:               { entity: "jobs",              editPerm: "jobs.edit",      deletePerm: "jobs.delete" },
  invoices:           { entity: "invoices",          editPerm: "invoices.create",deletePerm: "invoices.delete" },
  vehicles:           { entity: "vehicles",          editPerm: "vehicles.edit",  deletePerm: "vehicles.delete" },
  employees:          { entity: "employees",         editPerm: "employees.edit", deletePerm: "employees.delete" },
  projects:           { entity: "projects",          editPerm: "projects.edit",  deletePerm: "projects.delete" },
  compliance:         { entity: "compliance-forms",  editPerm: "forms.edit",     deletePerm: "forms.delete" },
  "compliance-forms": { entity: "compliance-forms",  editPerm: "forms.edit",     deletePerm: "forms.delete" },
};

const PALETTE = ["#3A6B8C", "#F5C518", "#1F2A33", "#7B9BB0", "#E0B416", "#5A8AA0", "#A53F2B"];

function marginCls(p) { return p >= 30 ? "text-green-700" : p >= 15 ? "text-amber-700" : "text-red-700"; }

function Kpi({ label, value, cls = "" }) {
  return (
    <div className="bg-white border border-gray-200 rounded p-4">
      <div className="text-[10px] uppercase tracking-wider font-bold text-gray-500">{label}</div>
      <div className={`mt-2 text-2xl font-black tracking-tighter tabular-nums ${cls || "text-[#1F2A33]"}`}>{value}</div>
    </div>
  );
}

function ChartCard({ title, children }) {
  return (
    <div className="bg-white border border-gray-200 rounded p-4">
      <div className="text-[10px] uppercase tracking-wider font-bold text-[#3A6B8C] mb-2">{title}</div>
      <div style={{ width: "100%", height: 240 }}>
        <ResponsiveContainer>{children}</ResponsiveContainer>
      </div>
    </div>
  );
}

function defaultDate(days) { const d = new Date(); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10); }

export default function ReportDetail() {
  const { key } = useParams();
  const { hasPerm, isSuperAdmin } = useAuth();
  const rowActionCfg = ROW_ACTION_BY_KEY[key];
  const canEditRows   = !!rowActionCfg && (isSuperAdmin || hasPerm(rowActionCfg.editPerm));
  const canDeleteRows = !!rowActionCfg && (isSuperAdmin || hasPerm(rowActionCfg.deletePerm));
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [dateFrom, setDateFrom] = useState(defaultDate(-90));
  const [dateTo, setDateTo] = useState(defaultDate(0));

  // Phase 11.1 — NCR Pack export
  const [ncrCount, setNcrCount] = useState(0);
  const [ncrOpen, setNcrOpen] = useState(false);
  const [ncrDateFrom, setNcrDateFrom] = useState(defaultDate(-90));
  const [ncrDateTo, setNcrDateTo] = useState(defaultDate(0));
  const [ncrRecipient, setNcrRecipient] = useState("");
  const [ncrSubject, setNcrSubject] = useState("");
  const [ncrBody, setNcrBody] = useState("");
  const [ncrBusy, setNcrBusy] = useState(false);
  const [ncrResult, setNcrResult] = useState(null); // {mode:"email"|"download"|"empty", ...}

  // Phase 11.4 — bulk-select
  const [selected, setSelected] = useState(new Set());
  const [bulkConfirm, setBulkConfirm] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const clearSelection = () => setSelected(new Set());
  const toggleRow = (id) => { const n = new Set(selected); if (n.has(id)) n.delete(id); else n.add(id); setSelected(n); };
  const toggleAllVisible = () => {
    if (!data?.table?.rows) return;
    const eligibleIds = data.table.rows
      .filter(r => r._id && !evaluateLockUnsafe(r).locked)
      .map(r => r._id);
    if (eligibleIds.every(id => selected.has(id))) clearSelection();
    else setSelected(new Set([...selected, ...eligibleIds]));
  };
  const runBulkDelete = async () => {
    setBulkBusy(true);
    const ids = Array.from(selected);
    let deleted = 0, skippedLocked = 0, failed = 0;
    for (const id of ids) {
      const row = data.table.rows.find(r => r._id === id);
      if (!row) { failed++; continue; }
      if (evaluateLockUnsafe(row).locked) { skippedLocked++; continue; }
      try { await api.delete(`/${row._entity}/${id}`); deleted++; }
      catch (_e) { failed++; }
    }
    setBulkBusy(false); setBulkConfirm(false); clearSelection();
    const parts = [`${deleted} deleted`];
    if (skippedLocked) parts.push(`${skippedLocked} skipped (locked)`);
    if (failed) parts.push(`${failed} failed`);
    (failed ? toast.error : toast.success)(parts.join(", "));
    load();
  };

  const load = async () => {
    setData(null); setErr("");
    try {
      const { data } = await api.get(`/reports/${key}`, { params: { date_from: dateFrom, date_to: dateTo } });
      setData(data);
      if (key === "compliance") {
        try {
          const r = await api.get("/compliance-forms/ncr-export/preview",
            { params: { date_from: dateFrom, date_to: dateTo } });
          setNcrCount(r.data.count || 0);
        } catch (_e) { setNcrCount(0); }
      }
    } catch (e) { setErr(e.response?.data?.detail || e.message); }
  };
  useEffect(() => { load(); }, [key, dateFrom, dateTo]); // eslint-disable-line react-hooks/exhaustive-deps

  const csvUrl = `${process.env.REACT_APP_BACKEND_URL}/api/reports/${key}/export.csv?date_from=${dateFrom}&date_to=${dateTo}`;
  const downloadCsv = async () => {
    const r = await fetch(csvUrl, { headers: { Authorization: `Bearer ${tokenStore.get()}` } });
    const blob = await r.blob();
    const u = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = u; a.download = `${key}-report.csv`; a.click();
    URL.revokeObjectURL(u);
  };

  const isMargin = key === "margin";

  return (
    <div className="max-w-7xl space-y-5" data-testid={`report-${key}-page`}>
      <Link to="/reports" className="inline-flex items-center text-xs font-bold uppercase tracking-wider text-[#3A6B8C] hover:text-[#1F2A33]">
        <ArrowLeft className="w-3 h-3 mr-1"/> Back to reports
      </Link>
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <div className="overline">{isMargin ? "Internal · Margin" : "Report"}</div>
          <h1 className="text-3xl font-black tracking-tighter text-[#1F2A33] inline-flex items-center gap-2 capitalize">
            {isMargin && <AppIcon name="locked" size={24} decorative/>} {key} report
          </h1>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-gray-500 font-bold block">From</label>
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-40 h-9" data-testid="report-date-from"/>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-gray-500 font-bold block">To</label>
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-40 h-9" data-testid="report-date-to"/>
          </div>
          <Button onClick={downloadCsv} data-testid="report-csv-btn" className="bg-[#F5C518] text-[#1F2A33] font-bold hover:bg-[#E0B416] h-9">
            <AppIcon name="download" size={16} className="mr-2" decorative/> Export CSV
          </Button>
          {key === "compliance" && (
            ncrCount > 0 ? (
              <Button onClick={() => { setNcrDateFrom(dateFrom); setNcrDateTo(dateTo); setNcrResult(null); setNcrOpen(true); }}
                      data-testid="export-ncr-pack-btn"
                      className="bg-red-600 text-white font-bold hover:bg-red-700 h-9">
                <AppIcon name="warning" size={16} className="mr-2" decorative/>
                Export NCR Pack ({ncrCount})
              </Button>
            ) : (
              <Button disabled
                      data-testid="export-ncr-pack-btn-disabled"
                      title="No NCR-flagged forms in the selected date range"
                      className="h-9">
                <AppIcon name="warning" size={16} className="mr-2" decorative/>
                No NCRs to export
              </Button>
            )
          )}
        </div>
      </div>

      {err && <div className="text-sm text-red-700">{err}</div>}
      {!data && !err && <div className="p-6 flex items-center gap-2 text-gray-500 text-sm"><Loader2 className="w-4 h-4 animate-spin"/> Loading…</div>}

      {data && (
        <>
          {/* KPI tiles */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" data-testid="report-kpis">
            {key === "customers" && (
              <>
                <Kpi label="Active customers" value={data.kpis.active_customers}/>
                <Kpi label="New in range" value={data.kpis.new_in_range}/>
                <Kpi label="Avg quotes/customer" value={data.kpis.avg_quotes_per_customer}/>
                <Kpi label="Top customer revenue" value={formatAUD(data.kpis.top_customer_revenue_aud)}/>
              </>
            )}
            {key === "quotes" && (
              <>
                <Kpi label="Quotes sent" value={data.kpis.quotes_sent}/>
                <Kpi label="Total quoted value" value={formatAUD(data.kpis.total_quoted_aud)}/>
                <Kpi label="Win rate" value={`${data.kpis.win_rate_pct}%`}/>
                <Kpi label="Avg days to accept" value={data.kpis.avg_days_to_accept}/>
              </>
            )}
            {key === "jobs" && (
              <>
                <Kpi label="Active jobs" value={data.kpis.active_jobs}/>
                <Kpi label="Completed in range" value={data.kpis.completed_in_range}/>
                <Kpi label="Avg cycle (days)" value={data.kpis.avg_cycle_days}/>
                <Kpi label="On-time delivery" value={`${data.kpis.on_time_delivery_pct}%`}/>
              </>
            )}
            {key === "vehicles" && (
              <>
                <Kpi label="Total vehicles" value={data.kpis.total_vehicles}/>
                <Kpi label="Active vehicles" value={data.kpis.active_vehicles}/>
                <Kpi label="Fleet capacity (t)" value={data.kpis.total_capacity_tonnes}/>
                <Kpi label="Most-used vehicle" value={data.kpis.most_used_vehicle}/>
              </>
            )}
            {key === "employees" && (
              <>
                <Kpi label="Active employees" value={data.kpis.active_employees}/>
                <Kpi label="Total assignments" value={data.kpis.total_assignments}/>
                <Kpi label="Avg per employee" value={data.kpis.avg_assignments_per_employee}/>
                <Kpi label="Most active" value={data.kpis.most_active_employee}/>
              </>
            )}
            {key === "invoices" && (
              <>
                <Kpi label="Total outstanding" value={formatAUD(data.kpis.total_outstanding_aud)} />
                <Kpi label="Paid in range" value={formatAUD(data.kpis.paid_in_range_aud)} />
                <Kpi label="Avg days to pay" value={data.kpis.avg_days_to_pay} />
                <Kpi label="Overdue count" value={data.kpis.overdue_count} cls={data.kpis.overdue_count>0?"text-red-700":""}/>
              </>
            )}
            {key === "margin" && (
              <>
                <Kpi label="Avg margin %" value={`${data.kpis.avg_margin_pct}%`} cls={marginCls(data.kpis.avg_margin_pct)}/>
                <Kpi label="Highest-margin panel" value={data.kpis.highest_margin_panel}/>
                <Kpi label="Total quoted margin" value={formatAUD(data.kpis.total_quoted_margin_aud)}/>
                <Kpi label="Total cost" value={formatAUD(data.kpis.total_cost_aud)}/>
              </>
            )}
            {key === "compliance" && (
              <>
                <Kpi label="Hold-Point compliance"
                     value={`${data.kpis.hold_point_compliance_pct ?? 0}%`}
                     cls={(data.kpis.hold_point_compliance_pct ?? 0) >= 95 ? "text-green-700"
                            : (data.kpis.hold_point_compliance_pct ?? 0) >= 80 ? "text-amber-700" : "text-red-700"}/>
                <Kpi label="NCR rate"
                     value={`${data.kpis.ncr_rate_pct ?? 0}%`}
                     cls={(data.kpis.ncr_rate_pct ?? 0) === 0 ? "text-green-700"
                            : (data.kpis.ncr_rate_pct ?? 0) <= 5 ? "text-amber-700" : "text-red-700"}/>
                <Kpi label="Avg sign-off latency" value={`${data.kpis.avg_signoff_latency_days ?? 0} days`}/>
                <Kpi label="Photo coverage" value={`${data.kpis.photo_coverage_pct ?? 0}%`}
                     cls={(data.kpis.photo_coverage_pct ?? 0) >= 80 ? "text-green-700" : "text-amber-700"}/>
              </>
            )}
          </div>

          {/* Charts */}
          {key === "customers" && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <ChartCard title="Top 10 customers by quoted value">
                <BarChart data={data.charts.top_customers_by_quoted} layout="vertical" margin={{left:90}}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eee"/><XAxis type="number" tickFormatter={v=>`$${(v/1000).toFixed(0)}k`}/>
                  <YAxis dataKey="customer" type="category" width={150} tick={{fontSize:11}}/><Tooltip formatter={v=>formatAUD(v)}/>
                  <Bar dataKey="total_quoted" fill="#3A6B8C"/>
                </BarChart>
              </ChartCard>
              <ChartCard title="New customers per month (12 mo)">
                <LineChart data={data.charts.new_customers_per_month}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eee"/><XAxis dataKey="month"/><YAxis/><Tooltip/>
                  <Line type="monotone" dataKey="new_customers" stroke="#1F2A33" strokeWidth={2}/>
                </LineChart>
              </ChartCard>
            </div>
          )}
          {key === "quotes" && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <ChartCard title="Win rate trend (6 mo)">
                <LineChart data={data.charts.win_rate_trend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eee"/><XAxis dataKey="month"/><YAxis unit="%"/><Tooltip/>
                  <Line type="monotone" dataKey="win_rate" stroke="#3A6B8C" strokeWidth={2}/>
                </LineChart>
              </ChartCard>
              <ChartCard title="Funnel">
                <BarChart data={data.charts.funnel}><CartesianGrid strokeDasharray="3 3" stroke="#eee"/>
                  <XAxis dataKey="stage"/><YAxis/><Tooltip/><Bar dataKey="count" fill="#F5C518"/>
                </BarChart>
              </ChartCard>
              <ChartCard title="Quote value by month (stacked)">
                <BarChart data={data.charts.value_by_month_stacked}><CartesianGrid strokeDasharray="3 3" stroke="#eee"/>
                  <XAxis dataKey="month"/><YAxis tickFormatter={v=>`$${(v/1000).toFixed(0)}k`}/><Tooltip formatter={v=>formatAUD(v)}/><Legend/>
                  <Bar dataKey="draft" stackId="a" fill="#7B9BB0"/><Bar dataKey="sent" stackId="a" fill="#F5C518"/>
                  <Bar dataKey="accepted" stackId="a" fill="#3A6B8C"/><Bar dataKey="rejected" stackId="a" fill="#A53F2B"/>
                </BarChart>
              </ChartCard>
            </div>
          )}
          {key === "jobs" && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <ChartCard title="Jobs by status">
                <PieChart><Pie data={data.charts.by_status} dataKey="count" nameKey="status" outerRadius={80} label>
                  {data.charts.by_status.map((_, i) => <Cell key={i} fill={PALETTE[i%PALETTE.length]}/>)}
                </Pie><Tooltip/><Legend/></PieChart>
              </ChartCard>
              <ChartCard title="Completed per month">
                <BarChart data={data.charts.completed_per_month}><CartesianGrid strokeDasharray="3 3" stroke="#eee"/>
                  <XAxis dataKey="month"/><YAxis/><Tooltip/><Bar dataKey="completed" fill="#3A6B8C"/>
                </BarChart>
              </ChartCard>
              <ChartCard title="Cycle time histogram">
                <BarChart data={data.charts.cycle_histogram}><CartesianGrid strokeDasharray="3 3" stroke="#eee"/>
                  <XAxis dataKey="bucket"/><YAxis/><Tooltip/><Bar dataKey="count" fill="#F5C518"/>
                </BarChart>
              </ChartCard>
            </div>
          )}
          {key === "vehicles" && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <ChartCard title="Assignments per vehicle">
                <BarChart data={data.charts.assignments_per_vehicle}><CartesianGrid strokeDasharray="3 3" stroke="#eee"/>
                  <XAxis dataKey="vehicle"/><YAxis/><Tooltip/><Bar dataKey="assignments" fill="#3A6B8C"/>
                </BarChart>
              </ChartCard>
              <ChartCard title="Status distribution">
                <PieChart><Pie data={data.charts.status_distribution} dataKey="count" nameKey="status" outerRadius={80} label>
                  {data.charts.status_distribution.map((_, i) => <Cell key={i} fill={PALETTE[i%PALETTE.length]}/>)}
                </Pie><Tooltip/><Legend/></PieChart>
              </ChartCard>
            </div>
          )}
          {key === "employees" && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <ChartCard title="Assignments per employee">
                <BarChart data={data.charts.assignments_per_employee}><CartesianGrid strokeDasharray="3 3" stroke="#eee"/>
                  <XAxis dataKey="employee" tick={{fontSize:10}}/><YAxis/><Tooltip/><Bar dataKey="assignments" fill="#3A6B8C"/>
                </BarChart>
              </ChartCard>
              <ChartCard title="Role distribution">
                <PieChart><Pie data={data.charts.role_distribution} dataKey="count" nameKey="role" outerRadius={80} label>
                  {data.charts.role_distribution.map((_, i) => <Cell key={i} fill={PALETTE[i%PALETTE.length]}/>)}
                </Pie><Tooltip/><Legend/></PieChart>
              </ChartCard>
            </div>
          )}
          {key === "invoices" && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <ChartCard title="Aging buckets ($)">
                <BarChart data={data.charts.aging_buckets} layout="vertical" margin={{left:30}}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eee"/>
                  <XAxis type="number" tickFormatter={v => `$${(v/1000).toFixed(0)}k`}/>
                  <YAxis dataKey="bucket" type="category" width={60}/>
                  <Tooltip formatter={(v) => formatAUD(v)}/>
                  <Bar dataKey="amount_aud" fill="#3A6B8C"/>
                </BarChart>
              </ChartCard>
              <ChartCard title="Issued vs Paid by month">
                <BarChart data={data.charts.issued_vs_paid}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eee"/>
                  <XAxis dataKey="month"/><YAxis tickFormatter={v=>`$${(v/1000).toFixed(0)}k`}/>
                  <Tooltip formatter={v=>formatAUD(v)}/><Legend/>
                  <Bar dataKey="issued" stackId="a" fill="#F5C518"/>
                  <Bar dataKey="paid" stackId="a" fill="#3A6B8C"/>
                </BarChart>
              </ChartCard>
              <ChartCard title="Avg days-to-pay trend">
                <LineChart data={data.charts.avg_days_to_pay_trend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eee"/>
                  <XAxis dataKey="month"/><YAxis/><Tooltip/>
                  <Line type="monotone" dataKey="avg_days" stroke="#1F2A33" strokeWidth={2}/>
                </LineChart>
              </ChartCard>
            </div>
          )}

          {key === "margin" && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <ChartCard title="Avg margin % by panel type">
                <BarChart data={data.charts.avg_margin_pct_by_panel} layout="vertical" margin={{left:90}}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eee"/>
                  <XAxis type="number" unit="%"/><YAxis dataKey="key" type="category" width={150} tick={{fontSize:11}}/>
                  <Tooltip/>
                  <Bar dataKey="avg_margin_pct" fill="#3A6B8C">
                    {data.charts.avg_margin_pct_by_panel.map((r,i) => <Cell key={i} fill={r.avg_margin_pct>=30?"#22c55e":r.avg_margin_pct>=15?"#f59e0b":"#dc2626"}/>)}
                  </Bar>
                </BarChart>
              </ChartCard>
              <ChartCard title="Avg margin % by finish">
                <BarChart data={data.charts.avg_margin_pct_by_finish} layout="vertical" margin={{left:90}}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eee"/>
                  <XAxis type="number" unit="%"/><YAxis dataKey="key" type="category" width={150} tick={{fontSize:11}}/>
                  <Tooltip/>
                  <Bar dataKey="avg_margin_pct">
                    {data.charts.avg_margin_pct_by_finish.map((r,i) => <Cell key={i} fill={PALETTE[i%PALETTE.length]}/>)}
                  </Bar>
                </BarChart>
              </ChartCard>
              <ChartCard title="Margin trend (6 months)">
                <LineChart data={data.charts.margin_trend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eee"/>
                  <XAxis dataKey="month"/><YAxis unit="%"/><Tooltip/>
                  <Line type="monotone" dataKey="avg_margin_pct" stroke="#1F2A33" strokeWidth={2}/>
                </LineChart>
              </ChartCard>
            </div>
          )}

          {key === "compliance" && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <ChartCard title="Forms created per month (last 6)">
                <BarChart data={data.charts.by_type_per_month.rows}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eee"/>
                  <XAxis dataKey="month"/><YAxis allowDecimals={false}/><Tooltip/><Legend/>
                  <Bar dataKey="Pre-Pour"    stackId="a" fill="#3A6B8C"/>
                  <Bar dataKey="Post-Pour"   stackId="a" fill="#F5C518"/>
                  <Bar dataKey="Certificate" stackId="a" fill="#1F2A33"/>
                </BarChart>
              </ChartCard>
              <ChartCard title="Hold-points missing by stage">
                <BarChart data={data.charts.missing_by_stage.rows}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eee"/>
                  <XAxis dataKey="stage"/><YAxis allowDecimals={false}/><Tooltip/>
                  <Bar dataKey="missing">
                    {data.charts.missing_by_stage.rows.map((r,i) => (
                      <Cell key={i} fill={r.missing === 0 ? "#22c55e" : r.missing < 3 ? "#f59e0b" : "#dc2626"}/>
                    ))}
                  </Bar>
                </BarChart>
              </ChartCard>
            </div>
          )}

          {/* Table */}
          <div className="bg-white border border-gray-200 rounded overflow-x-auto" data-testid="report-table">
            <table className="w-full text-sm">
              <thead className="bg-[#3A6B8C] text-white uppercase text-[10px] tracking-wider">
                <tr>
                  {rowActionCfg && canDeleteRows && (
                    <th className="px-3 py-2 w-8 text-center">
                      <input type="checkbox"
                        aria-label="Select all visible"
                        data-testid="bulk-select-all"
                        onChange={toggleAllVisible}
                        checked={(() => {
                          const eligible = (data.table.rows || []).filter(r => r._id && !evaluateLockUnsafe(r).locked);
                          return eligible.length > 0 && eligible.every(r => selected.has(r._id));
                        })()}
                      />
                    </th>
                  )}
                  {(data.table.columns ?? []).map(c => <th key={c} className="px-3 py-2 text-left">{c.replace(/_/g," ")}</th>)}
                  {rowActionCfg && (canEditRows || canDeleteRows) && <th className="px-3 py-2 text-right w-24">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {(data.table.rows ?? []).map((r, i) => {
                  const locked = rowActionCfg ? evaluateLockUnsafe(r).locked : false;
                  return (
                  <tr key={r._id || i} className="border-t border-gray-200 hover:bg-gray-50">
                    {rowActionCfg && canDeleteRows && (
                      <td className="px-3 py-2 text-center">
                        <input type="checkbox"
                          data-testid={`bulk-select-${r._id}`}
                          disabled={locked || !r._id}
                          checked={r._id ? selected.has(r._id) : false}
                          onChange={() => r._id && toggleRow(r._id)}
                          title={locked ? "Locked — cannot bulk-delete" : ""}
                        />
                      </td>
                    )}
                    {data.table.columns.map(c => {
                      const v = r[c];
                      const colored = c === "avg_margin_pct" && typeof v === "number";
                      const display = typeof v === "number" && c.includes("aud") ? formatAUD(v) : String(v ?? "");
                      return <td key={c}
                                  title={typeof v === "string" ? v : undefined}
                                  className={`px-3 py-2 tabular-nums ${colored ? marginCls(v) : ""}`}>
                        {display}
                      </td>;
                    })}
                    {rowActionCfg && (canEditRows || canDeleteRows) && (
                      <td className="px-3 py-2 text-right" data-testid={`row-actions-cell-${r._id || i}`}>
                        <ReportRowActions row={r} canEdit={canEditRows} canDelete={canDeleteRows} onDeleted={load}/>
                      </td>
                    )}
                  </tr>);
                })}
                {data.table.rows.length === 0 && <tr><td colSpan={(data.table.columns.length) + (rowActionCfg ? 1 : 0) + (rowActionCfg && canDeleteRows ? 1 : 0)} className="p-6 text-center text-sm text-gray-500">No data</td></tr>}
              </tbody>
            </table>
          </div>

          {/* Phase 11.4 — Floating bulk-action bar */}
          {selected.size > 0 && rowActionCfg && canDeleteRows && (
            <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 max-w-2xl w-[calc(100%-2rem)]"
                 data-testid="bulk-action-bar">
              <div className="bg-[#1F2A33] text-white rounded-lg shadow-2xl flex items-center gap-3 px-4 py-3">
                <span className="text-sm font-semibold" data-testid="bulk-selected-count">{selected.size} selected</span>
                <div className="flex-1"/>
                <Button variant="outline" onClick={clearSelection}
                        className="bg-transparent border-gray-500 text-white hover:bg-gray-700 h-9"
                        data-testid="bulk-clear-btn">Clear</Button>
                <Button onClick={() => setBulkConfirm(true)} disabled={bulkBusy}
                        className="bg-red-600 hover:bg-red-700 h-9" data-testid="bulk-delete-btn">
                  {bulkBusy ? <Loader2 className="w-4 h-4 mr-2 animate-spin"/> : <AppIcon name="delete" size={16} className="mr-1" decorative/>}
                  Soft-delete selected
                </Button>
              </div>
            </div>
          )}

          <Dialog open={bulkConfirm} onOpenChange={(v) => !v && setBulkConfirm(false)}>
            <DialogContent data-testid="bulk-delete-dialog" className="max-w-md">
              <DialogHeader>
                <DialogTitle className="text-red-700 inline-flex items-center gap-2">
                  <AppIcon name="delete" size={22} decorative/> Delete {selected.size} record{selected.size !== 1 ? "s" : ""}?
                </DialogTitle>
                <DialogDescription className="pt-2 text-sm text-gray-700">
                  They'll be hidden from all reports but retained in the audit trail. Locked rows in the selection will be skipped automatically.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="gap-2">
                <Button variant="outline" onClick={() => setBulkConfirm(false)} disabled={bulkBusy}
                        data-testid="bulk-delete-cancel">Cancel</Button>
                <Button onClick={runBulkDelete} disabled={bulkBusy}
                        className="bg-red-600 text-white hover:bg-red-700"
                        data-testid="bulk-delete-confirm">
                  {bulkBusy ? <Loader2 className="w-4 h-4 mr-2 animate-spin"/> : <AppIcon name="delete" size={16} className="mr-2" decorative/>}
                  Delete {selected.size}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}

      {/* Phase 11.1 — Export NCR Pack dialog */}
      <Dialog open={ncrOpen} onOpenChange={(v) => { if (!v) { setNcrOpen(false); setNcrResult(null); } }}>
        <DialogContent data-testid="ncr-export-dialog" className="max-w-lg">
          {!ncrResult ? (
            <>
              <DialogHeader>
                <DialogTitle className="inline-flex items-center gap-2 text-red-700">
                  <AppIcon name="warning" size={22} decorative/> Export NCR Pack
                </DialogTitle>
                <DialogDescription>
                  Bundle every NCR-flagged compliance form (completed in this range) into a single merged PDF.
                  Up to 100 forms.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3 py-2">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-[10px] uppercase tracking-wider font-bold text-gray-500">Date from</Label>
                    <Input type="date" value={ncrDateFrom} onChange={(e) => setNcrDateFrom(e.target.value)} data-testid="ncr-date-from"/>
                  </div>
                  <div>
                    <Label className="text-[10px] uppercase tracking-wider font-bold text-gray-500">Date to</Label>
                    <Input type="date" value={ncrDateTo} onChange={(e) => setNcrDateTo(e.target.value)} data-testid="ncr-date-to"/>
                  </div>
                </div>
                <div>
                  <Label className="text-[10px] uppercase tracking-wider font-bold text-gray-500">Recipient (optional)</Label>
                  <Input type="email" value={ncrRecipient} onChange={(e) => setNcrRecipient(e.target.value)}
                         placeholder="qa@client.example.com" data-testid="ncr-recipient"/>
                  <div className="text-[11px] text-gray-500 mt-1">
                    Leave blank to download the PDF. If filled, fires a <span className="font-bold uppercase">MOCKED</span> email preview with the PDF attached.
                  </div>
                </div>
                {ncrRecipient && (
                  <>
                    <div>
                      <Label className="text-[10px] uppercase tracking-wider font-bold text-gray-500">Subject (optional)</Label>
                      <Input value={ncrSubject} onChange={(e) => setNcrSubject(e.target.value)}
                             placeholder="Paneltec NCR Pack — …" data-testid="ncr-subject"/>
                    </div>
                    <div>
                      <Label className="text-[10px] uppercase tracking-wider font-bold text-gray-500">Body (optional)</Label>
                      <Textarea value={ncrBody} onChange={(e) => setNcrBody(e.target.value)} rows={3}
                                placeholder="Please find attached…" data-testid="ncr-body"/>
                    </div>
                  </>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setNcrOpen(false)} disabled={ncrBusy}>Cancel</Button>
                <Button onClick={async () => {
                  setNcrBusy(true);
                  try {
                    if (ncrRecipient.trim()) {
                      const r = await api.post("/compliance-forms/ncr-export", {
                        date_from: ncrDateFrom, date_to: ncrDateTo,
                        recipient: ncrRecipient.trim(),
                        subject: ncrSubject.trim() || undefined,
                        body: ncrBody.trim() || undefined,
                      });
                      if (r.data?.count === 0) {
                        toast.info(r.data.message || "No NCR-flagged forms in that range");
                        setNcrResult({ mode: "empty", message: r.data.message });
                      } else {
                        setNcrResult({ mode: "email", ...r.data });
                      }
                    } else {
                      // First check via JSON (so we can detect the empty case)
                      const probe = await api.get("/compliance-forms/ncr-export/preview",
                        { params: { date_from: ncrDateFrom, date_to: ncrDateTo } });
                      if (!probe.data.count) {
                        toast.info("No NCR-flagged forms in that range");
                        setNcrResult({ mode: "empty", message: "No NCR-flagged forms in that range" });
                      } else {
                        // PDF download
                        const r = await fetch(
                          `${process.env.REACT_APP_BACKEND_URL}/api/compliance-forms/ncr-export`,
                          { method: "POST",
                            headers: { "Content-Type": "application/json",
                                       "Authorization": `Bearer ${tokenStore.get()}` },
                            body: JSON.stringify({ date_from: ncrDateFrom, date_to: ncrDateTo }) });
                        if (!r.ok) throw new Error(`HTTP ${r.status}`);
                        const blob = await r.blob();
                        const fname = `paneltec_ncr_pack_${ncrDateFrom}_to_${ncrDateTo}.pdf`;
                        const pdfBlob = new Blob([blob], { type: "application/pdf" });
                        const u = URL.createObjectURL(pdfBlob);
                        const w = window.open(u, "_blank");
                        if (!w) {
                          // Popup blocked — fall back to download
                          const a = document.createElement("a"); a.href = u; a.download = fname; document.body.appendChild(a); a.click(); a.remove();
                          toast.error("Popup blocked — PDF downloaded instead. Allow popups from this site to view inline.");
                        } else {
                          toast.success(`Opened ${fname}`);
                        }
                        setTimeout(() => URL.revokeObjectURL(u), 5000);
                        setNcrResult({ mode: "download", filename: fname, count: probe.data.count });
                      }
                    }
                  } catch (e) {
                    toast.error(e.response?.data?.detail || e.message || "Export failed");
                  } finally { setNcrBusy(false); }
                }}
                disabled={ncrBusy}
                className="bg-red-600 text-white hover:bg-red-700"
                data-testid="ncr-export-confirm">
                  {ncrBusy ? <Loader2 className="w-4 h-4 mr-2 animate-spin"/> : <AppIcon name="download" size={14} decorative className="mr-2"/>}
                  {ncrRecipient.trim() ? "Send (MOCKED)" : "Download PDF"}
                </Button>
              </DialogFooter>
            </>
          ) : ncrResult.mode === "empty" ? (
            <>
              <DialogHeader>
                <DialogTitle className="inline-flex items-center gap-2"><AppIcon name="info" size={22} decorative/> Nothing to export</DialogTitle>
                <DialogDescription>{ncrResult.message}</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button onClick={() => setNcrOpen(false)} data-testid="ncr-close-empty">Close</Button>
              </DialogFooter>
            </>
          ) : ncrResult.mode === "download" ? (
            <>
              <DialogHeader>
                <DialogTitle className="inline-flex items-center gap-2 text-green-700"><AppIcon name="success" size={22} decorative/> NCR Pack downloaded</DialogTitle>
                <DialogDescription>
                  {ncrResult.count} non-conformance form{ncrResult.count !== 1 ? "s" : ""} bundled into
                  <code className="bg-gray-100 px-1.5 py-0.5 rounded mx-1 text-xs">{ncrResult.filename}</code>
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button onClick={() => setNcrOpen(false)} data-testid="ncr-close-download" className="bg-[#1F2A33] text-white hover:bg-[#3A6B8C]">Close</Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle className="inline-flex items-center gap-2 text-amber-700">
                  <AppIcon name="email" size={22} decorative/> Email queued
                  <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-amber-100 text-amber-800">MOCKED</span>
                </DialogTitle>
                <DialogDescription>
                  Preview of the email that would be sent (no real outbound mail in this environment).
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-2 text-sm bg-gray-50 border border-gray-200 rounded p-3" data-testid="ncr-email-preview">
                <div><span className="text-[10px] uppercase tracking-wider font-bold text-gray-500">To:</span> {ncrResult.preview.to}</div>
                <div><span className="text-[10px] uppercase tracking-wider font-bold text-gray-500">From:</span> {ncrResult.preview.from}</div>
                <div><span className="text-[10px] uppercase tracking-wider font-bold text-gray-500">Subject:</span> {ncrResult.preview.subject}</div>
                <div className="whitespace-pre-wrap text-gray-800 border-t border-gray-200 pt-2">{ncrResult.preview.body}</div>
                <div className="border-t border-gray-200 pt-2">
                  <div className="text-[10px] uppercase tracking-wider font-bold text-gray-500">Attachment:</div>
                  <code className="text-xs bg-white px-2 py-1 rounded border inline-block mt-1">{ncrResult.preview.attachments[0]}</code>
                </div>
                <div className="border-t border-gray-200 pt-2 text-[11px] text-gray-600">
                  Forms included ({ncrResult.preview.form_count}): {ncrResult.preview.form_numbers.join(", ")}
                </div>
              </div>
              <DialogFooter>
                <Button onClick={() => setNcrOpen(false)} data-testid="ncr-close-email" className="bg-[#1F2A33] text-white hover:bg-[#3A6B8C]">Close</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
