import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Download, Lock, Loader2 } from "lucide-react";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, Legend } from "recharts";
import { api, tokenStore } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { formatAUD } from "../lib/format";

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
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [dateFrom, setDateFrom] = useState(defaultDate(-90));
  const [dateTo, setDateTo] = useState(defaultDate(0));

  const load = async () => {
    setData(null); setErr("");
    try {
      const { data } = await api.get(`/reports/${key}`, { params: { date_from: dateFrom, date_to: dateTo } });
      setData(data);
    } catch (e) { setErr(e.response?.data?.detail || e.message); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [key, dateFrom, dateTo]);

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
            {isMargin && <Lock className="w-6 h-6 text-[#3A6B8C]"/>} {key} report
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
            <Download className="w-4 h-4 mr-2"/> Export CSV
          </Button>
        </div>
      </div>

      {err && <div className="text-sm text-red-700">{err}</div>}
      {!data && !err && <div className="p-6 flex items-center gap-2 text-gray-500 text-sm"><Loader2 className="w-4 h-4 animate-spin"/> Loading…</div>}

      {data && (
        <>
          {/* KPI tiles */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" data-testid="report-kpis">
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
          </div>

          {/* Charts */}
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

          {/* Table */}
          <div className="bg-white border border-gray-200 rounded overflow-x-auto" data-testid="report-table">
            <table className="w-full text-sm">
              <thead className="bg-[#3A6B8C] text-white uppercase text-[10px] tracking-wider">
                <tr>{(data.table.columns ?? []).map(c => <th key={c} className="px-3 py-2 text-left">{c.replace(/_/g," ")}</th>)}</tr>
              </thead>
              <tbody>
                {(data.table.rows ?? []).map((r, i) => (
                  <tr key={i} className="border-t border-gray-200 hover:bg-gray-50">
                    {data.table.columns.map(c => {
                      const v = r[c];
                      const colored = c === "avg_margin_pct" && typeof v === "number";
                      return <td key={c} className={`px-3 py-2 tabular-nums ${colored ? marginCls(v) : ""}`}>
                        {typeof v === "number" && c.includes("aud") ? formatAUD(v) : String(v ?? "")}
                      </td>;
                    })}
                  </tr>
                ))}
                {data.table.rows.length === 0 && <tr><td colSpan={data.table.columns.length} className="p-6 text-center text-sm text-gray-500">No data</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
