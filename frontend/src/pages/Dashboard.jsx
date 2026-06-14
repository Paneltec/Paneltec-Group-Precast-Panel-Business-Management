import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Calculator, FileText, Briefcase, Receipt, UserSquare2, Loader2 } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { api } from "../lib/api";
import { formatAUD, formatDateTime } from "../lib/format";

const STATUS_STYLES = {
  draft: "bg-gray-100 text-gray-700",
  sent: "bg-blue-100 text-blue-800",
  accepted: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-700",
  expired: "bg-amber-100 text-amber-800",
};

export default function Dashboard() {
  const { user } = useAuth();
  const [kpis, setKpis] = useState(null);

  useEffect(() => {
    api.get("/dashboard/kpis").then((r) => setKpis(r.data)).catch(() => setKpis({ recent_quotes: [] }));
  }, []);

  const kpiCards = kpis ? [
    { label: "Customers Active", value: kpis.customers_active, note: "All time", icon: UserSquare2 },
    { label: "Quotes Sent", value: kpis.quotes_sent, note: "Awaiting decision", icon: FileText },
    { label: "Quotes Accepted", value: kpis.quotes_accepted, note: "All time", icon: Briefcase },
    { label: "Quoted This Month", value: formatAUD(kpis.quoted_this_month_aud), note: "AUD inc GST", icon: Receipt, isCurrency: true },
  ] : null;

  return (
    <div className="max-w-7xl space-y-8" data-testid="dashboard-page">
      {/* Welcome card */}
      <section className="relative overflow-hidden bg-white border border-gray-200 rounded" data-testid="welcome-card">
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-0">
          <div className="lg:col-span-3 p-8 lg:p-10">
            <div className="overline mb-3">Welcome back</div>
            <h1 className="text-3xl md:text-4xl font-black tracking-tighter text-[#1F2A33] mb-3">
              G'day, {user?.name?.split(" ")[0] || "team"}.
            </h1>
            <p className="text-sm text-gray-600 leading-relaxed max-w-lg">
              Phase 2 is live — customers, projects, quotes with magic-link approvals.
              Jobs, invoicing and fleet roll out in phases 3–4.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link to="/quotes/new" data-testid="dash-new-quote-cta"
                className="inline-flex items-center gap-2 bg-[#F5C518] text-[#1F2A33] font-bold px-5 py-2.5 rounded hover:bg-[#E0B416] transition-colors">
                <FileText className="w-4 h-4" /> New Quote <ArrowRight className="w-4 h-4" />
              </Link>
              <Link to="/calculator" data-testid="dash-calc-cta"
                className="inline-flex items-center gap-2 border border-[#1F2A33] text-[#1F2A33] font-semibold px-5 py-2.5 rounded hover:bg-gray-50 transition-colors">
                <Calculator className="w-4 h-4" /> Open Calculator
              </Link>
            </div>
          </div>
          <div className="hidden lg:block lg:col-span-2 relative"
            style={{
              backgroundImage:
                "linear-gradient(to right, #ffffff 0%, rgba(255,255,255,0.4) 35%, rgba(255,255,255,0) 100%), url('https://images.pexels.com/photos/4170184/pexels-photo-4170184.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940')",
              backgroundSize: "cover", backgroundPosition: "center",
            }}>
            <div className="absolute top-6 right-6 bg-[#1F2A33] text-[#F5C518] text-[10px] font-bold uppercase tracking-[0.22em] px-3 py-1 rounded">
              Phase 2 Live
            </div>
          </div>
        </div>
      </section>

      {/* KPIs */}
      <section>
        <div className="overline mb-3">Operations snapshot</div>
        {!kpis ? (
          <div className="flex items-center gap-2 text-gray-500 text-sm"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4" data-testid="kpi-grid">
              {kpiCards.map((k) => (
                <div key={k.label} className="bg-white border border-gray-200 rounded p-5"
                  data-testid={`kpi-${k.label.toLowerCase().replace(/\s+/g, "-")}`}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs uppercase tracking-wider text-gray-500 font-bold">{k.label}</span>
                    <k.icon className="w-4 h-4 text-[#3A6B8C]" />
                  </div>
                  <div className={`mt-3 ${k.isCurrency ? "text-2xl" : "text-3xl"} font-black text-[#1F2A33] tracking-tighter tabular-nums`}>
                    {k.value}
                  </div>
                  <div className="mt-1 text-[10px] uppercase tracking-wider text-gray-400">{k.note}</div>
                </div>
              ))}
            </div>
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <div className="bg-white border border-gray-200 rounded px-4 py-3 flex justify-between">
                <span className="text-gray-500">Drafts in progress</span>
                <span className="font-bold tabular-nums">{kpis.quotes_draft}</span>
              </div>
              <div className="bg-white border border-gray-200 rounded px-4 py-3 flex justify-between">
                <span className="text-gray-500">Accepted this month</span>
                <span className="font-bold tabular-nums">{formatAUD(kpis.accepted_this_month_aud)}</span>
              </div>
            </div>
          </>
        )}
      </section>

      {/* Recent quotes */}
      <section className="bg-white border border-gray-200 rounded p-6" data-testid="recent-quotes">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-bold uppercase tracking-[0.15em] text-[#3A6B8C]">Recent quotes</h2>
          <Link to="/quotes" className="text-xs font-bold uppercase tracking-wider text-[#3A6B8C] hover:text-[#1F2A33]">
            View all →
          </Link>
        </div>
        {!kpis?.recent_quotes?.length ? (
          <div className="text-sm text-gray-500">No quotes yet. <Link to="/quotes/new" className="text-[#3A6B8C] font-semibold">Create your first quote</Link>.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-[10px] uppercase tracking-wider text-gray-500 border-b border-gray-200">
              <tr><th className="text-left py-2">Quote #</th><th className="text-left">Customer</th><th className="text-left">Status</th><th className="text-right">Total</th><th className="text-right">Created</th></tr>
            </thead>
            <tbody>
              {kpis.recent_quotes.map((q) => (
                <tr key={q.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="py-2.5"><Link to={`/quotes/${q.id}`} className="font-semibold text-[#1F2A33] hover:text-[#3A6B8C]">{q.quote_number}</Link></td>
                  <td>{q.customer_company_name}</td>
                  <td><span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${STATUS_STYLES[q.status] || "bg-gray-100"}`}>{q.status}</span></td>
                  <td className="text-right tabular-nums font-semibold">{formatAUD(q.total)}</td>
                  <td className="text-right text-xs text-gray-500">{formatDateTime(q.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
