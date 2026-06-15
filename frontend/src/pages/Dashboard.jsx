import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Loader2, FileWarning, TrendingUp, Percent } from "lucide-react";
import AppIcon from "../components/AppIcon";
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
  soft_deleted:"bg-red-100 text-red-700", restored:"bg-emerald-100 text-emerald-800",
  status_changed:"bg-purple-100 text-purple-800", login_success:"bg-gray-100 text-gray-700",
  quote_sent:"bg-sky-100 text-sky-800", quote_accepted:"bg-emerald-100 text-emerald-800",
  quote_rejected:"bg-red-100 text-red-800", invoice_issued:"bg-yellow-100 text-yellow-800",
  invoice_paid:"bg-green-100 text-green-800", invoice_pushed_xero:"bg-violet-100 text-violet-800",
  email_sent:"bg-blue-100 text-blue-800",
};
const HUMAN_ACTION = {
  quote_sent:"quote sent", quote_accepted:"quote accepted", quote_rejected:"quote rejected",
  invoice_issued:"invoice issued", invoice_paid:"invoice paid",
  invoice_pushed_xero:"invoice pushed to Xero",
  status_changed:"status change", login_success:"login",
  created:"new record", soft_deleted:"deletion", restored:"restore", email_sent:"email sent",
};

function relTime(iso) {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff/60000), h = Math.round(diff/3600000), d = Math.round(diff/86400000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString("en-AU");
}

function summaryLine(today_summary) {
  const entries = Object.entries(today_summary || {}).filter(([, n]) => n > 0);
  if (!entries.length) return "No activity yet today";
  const order = ["quote_sent","quote_accepted","invoice_paid","invoice_issued","invoice_pushed_xero","status_changed","email_sent","login_success","created","soft_deleted","restored"];
  entries.sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
  const parts = entries.map(([k, n]) => `${n} ${HUMAN_ACTION[k] || k.replace(/_/g, " ")}${n === 1 ? "" : "s"}`);
  return `Today: ${parts.join(" · ")}`;
}

export default function Dashboard() {
  const { user, hasPerm, isSuperAdmin } = useAuth();
  const [kpis, setKpis] = useState(null);
  const [activity, setActivity] = useState(null);
  const canAudit = isSuperAdmin || hasPerm("audit.view");
  const canViewInvoices = isSuperAdmin || hasPerm("invoices.view");

  useEffect(() => {
    api.get("/dashboard/kpis").then((r) => setKpis(r.data)).catch(() => setKpis({ recent_quotes: [] }));
    if (canAudit) {
      api.get("/audit/recent?limit=10").then((r) => setActivity(r.data)).catch(() => setActivity({ items: [], today_summary: {} }));
    }
  }, [canAudit]);

  const kpiCards = kpis ? [
    { label: "Customers Active", value: kpis.customers_active, note: "All time", icon: "customers" },
    { label: "Quotes Sent", value: kpis.quotes_sent, note: "Awaiting decision", icon: "quote_sent" },
    { label: "Quotes Accepted", value: kpis.quotes_accepted, note: "All time", icon: "quote_accepted" },
    { label: "Quoted This Month", value: formatAUD(kpis.quoted_this_month_aud), note: "AUD inc GST", icon: "money", isCurrency: true },
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
                <AppIcon name="quotes" size={18} decorative /> New Quote <ArrowRight className="w-4 h-4" />
              </Link>
              <Link to="/calculator" data-testid="dash-calc-cta"
                className="inline-flex items-center gap-2 border border-[#1F2A33] text-[#1F2A33] font-semibold px-5 py-2.5 rounded hover:bg-gray-50 transition-colors">
                <AppIcon name="calculator" size={18} decorative /> Open Calculator
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

      {/* Recent Activity + Awaiting Xero (super-admin / audit-viewer ops row) */}
      {(canAudit || canViewInvoices) && (
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {canAudit && (
            <div className="bg-white border border-gray-200 rounded p-5 lg:col-span-2" data-testid="recent-activity-card">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <AppIcon name="audit" size={18} decorative/>
                  <h2 className="text-sm font-bold uppercase tracking-[0.15em] text-[#3A6B8C]">Recent Activity</h2>
                </div>
                <Link to="/admin/audit" className="text-xs font-bold uppercase tracking-wider text-[#3A6B8C] hover:text-[#1F2A33]" data-testid="recent-activity-view-all">
                  View all →
                </Link>
              </div>
              <div className="text-sm text-[#1F2A33] font-semibold mb-3" data-testid="recent-activity-summary">
                {!activity ? <Loader2 className="w-4 h-4 animate-spin inline" /> : summaryLine(activity.today_summary)}
              </div>
              <ol className="space-y-1" data-testid="recent-activity-list">
                {(activity?.items ?? []).slice(0, 10).map((e) => (
                  <li key={e.id}>
                    <Link to={`/admin/audit?focus=${e.id}`}
                          className="flex items-center gap-2 text-xs hover:bg-gray-50 -mx-2 px-2 py-1.5 rounded"
                          data-testid={`recent-activity-row-${e.id}`}>
                      <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0 inline-flex items-center gap-1 ${ACTION_COLOR[e.action] || "bg-gray-100 text-gray-700"}`}><AppIcon name={ACTION_ICON[e.action] || "info"} size={12} decorative/>{e.action}</span>
                      <span className="font-medium text-[#1F2A33] truncate max-w-[20ch]">{(e.actor_name || e.actor_email || "System").slice(0, 20)}</span>
                      <span className="text-gray-400">·</span>
                      <span className="font-mono text-gray-700 truncate flex-1">{e.entity_label || e.entity_type}</span>
                      <span className="text-gray-400 shrink-0">{relTime(e.timestamp)}</span>
                    </Link>
                  </li>
                ))}
                {activity?.items?.length === 0 && <li className="text-xs text-gray-400">No events yet.</li>}
              </ol>
            </div>
          )}
          {canViewInvoices && (
            <Link to="/invoices?xero_push_status=pending" data-testid="xero-pending-kpi-card"
                  className="block bg-white border border-gray-200 rounded p-5 hover:border-[#F5C518] hover:shadow-md transition-all group">
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase tracking-wider text-gray-500 font-bold">Invoices awaiting Xero push</span>
                <AppIcon name="xero_push" size={20} decorative/>
              </div>
              <div className="mt-3 text-4xl font-black text-[#1F2A33] tracking-tighter tabular-nums" data-testid="xero-pending-count">
                {kpis ? kpis.invoices_awaiting_xero_push ?? 0 : <Loader2 className="w-6 h-6 animate-spin"/>}
              </div>
              <div className="mt-1 text-[10px] uppercase tracking-wider text-gray-400">
                Issued · not yet pushed
              </div>
              <div className="mt-3 inline-flex items-center text-xs font-bold uppercase tracking-wider text-[#3A6B8C] group-hover:text-[#1F2A33]">
                Open list <ArrowRight className="w-3 h-3 ml-1"/>
              </div>
            </Link>
          )}
        </section>
      )}

      {/* Margin KPIs — gated on pricing.view_costs (presence of fields in API response) */}
      {kpis && kpis.quoted_margin_this_month_aud !== undefined && (
        <section className="grid grid-cols-1 sm:grid-cols-2 gap-4" data-testid="margin-kpi-row">
          <div className="bg-white border border-[#1F2A33]/20 rounded p-5" data-testid="kpi-margin-aud">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-wider text-gray-500 font-bold">This month — Quoted margin</span>
              <AppIcon name="live" size={16} decorative/>
            </div>
            <div className="mt-3 text-3xl font-black text-[#1F2A33] tracking-tighter tabular-nums" data-testid="kpi-margin-aud-value">
              {formatAUD(kpis.quoted_margin_this_month_aud ?? 0)}
            </div>
            <div className="mt-1 text-[10px] uppercase tracking-wider text-gray-400">Sent &amp; accepted quotes</div>
          </div>
          {(() => {
            const mp = kpis.quoted_margin_this_month_pct ?? 0;
            const cls = mp >= 30 ? "text-green-700" : mp >= 15 ? "text-amber-700" : "text-red-700";
            return (
              <div className="bg-white border border-[#1F2A33]/20 rounded p-5" data-testid="kpi-margin-pct">
                <div className="flex items-center justify-between">
                  <span className="text-xs uppercase tracking-wider text-gray-500 font-bold">This month — Avg margin %</span>
                  <AppIcon name="margin" size={16} decorative/>
                </div>
                <div className={`mt-3 text-3xl font-black tracking-tighter tabular-nums ${cls}`} data-testid="kpi-margin-pct-value">
                  {mp.toFixed(1)}%
                </div>
                <div className="mt-1 text-[10px] uppercase tracking-wider text-gray-400">Weighted by subtotal</div>
              </div>
            );
          })()}
        </section>
      )}

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
                    <AppIcon name={k.icon} size={28} decorative />
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
              {(kpis.recent_quotes ?? []).map((q) => (
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
