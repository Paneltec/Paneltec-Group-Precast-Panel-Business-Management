import { Link } from "react-router-dom";
import { ArrowRight, Calculator, FileText, Briefcase, Receipt, UserSquare2 } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";

const KPI_PLACEHOLDERS = [
  { label: "Active Quotes", value: "—", note: "Coming Phase 2", icon: FileText },
  { label: "Open Jobs", value: "—", note: "Coming Phase 3", icon: Briefcase },
  { label: "Customers", value: "—", note: "Coming Phase 2", icon: UserSquare2 },
  { label: "Invoices Outstanding", value: "—", note: "Coming Phase 4", icon: Receipt },
];

export default function Dashboard() {
  const { user } = useAuth();
  return (
    <div className="max-w-7xl space-y-8" data-testid="dashboard-page">
      {/* Welcome card */}
      <section
        className="relative overflow-hidden bg-white border border-gray-200 rounded"
        data-testid="welcome-card"
      >
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-0">
          <div className="lg:col-span-3 p-8 lg:p-10">
            <div className="overline mb-3">Welcome back</div>
            <h1 className="text-3xl md:text-4xl font-black tracking-tighter text-[#1F2A33] mb-3">
              G'day, {user?.name?.split(" ")[0] || "team"}.
            </h1>
            <p className="text-sm text-gray-600 leading-relaxed max-w-lg">
              The Paneltec MVP is online. Phase&nbsp;1 ships the precast panel calculator,
              pricing controls and user administration. Quotes, jobs, invoicing and fleet
              tools roll out across phases 2–4.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                to="/calculator"
                data-testid="open-calculator-cta"
                className="inline-flex items-center gap-2 bg-[#F5C518] text-[#1F2A33] font-bold px-5 py-2.5 rounded hover:bg-[#E0B416] transition-colors"
              >
                <Calculator className="w-4 h-4" />
                Open Calculator
                <ArrowRight className="w-4 h-4" />
              </Link>
              <Link
                to={user?.role === "admin" ? "/settings/pricing" : "/calculator"}
                className="inline-flex items-center gap-2 border border-[#1F2A33] text-[#1F2A33] font-semibold px-5 py-2.5 rounded hover:bg-gray-50 transition-colors"
                data-testid="dashboard-secondary-cta"
              >
                {user?.role === "admin" ? "Edit pricing" : "View calculator"}
              </Link>
            </div>
          </div>
          <div
            className="hidden lg:block lg:col-span-2 relative"
            style={{
              backgroundImage:
                "linear-gradient(to right, #ffffff 0%, rgba(255,255,255,0.4) 35%, rgba(255,255,255,0) 100%), url('https://images.pexels.com/photos/4170184/pexels-photo-4170184.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940')",
              backgroundSize: "cover",
              backgroundPosition: "center",
            }}
          >
            <div className="absolute top-6 right-6 bg-[#1F2A33] text-[#F5C518] text-[10px] font-bold uppercase tracking-[0.22em] px-3 py-1 rounded">
              Phase 1 Live
            </div>
          </div>
        </div>
      </section>

      {/* KPIs */}
      <section>
        <div className="overline mb-3">Operations snapshot</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4" data-testid="kpi-grid">
          {KPI_PLACEHOLDERS.map((k) => (
            <div
              key={k.label}
              className="bg-white border border-gray-200 rounded p-5"
              data-testid={`kpi-${k.label.toLowerCase().replace(/\s+/g, "-")}`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase tracking-wider text-gray-500 font-bold">{k.label}</span>
                <k.icon className="w-4 h-4 text-[#3A6B8C]" />
              </div>
              <div className="mt-3 text-3xl font-black text-[#1F2A33] tracking-tighter tabular-nums">{k.value}</div>
              <div className="mt-1 text-[10px] uppercase tracking-wider text-gray-400">{k.note}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Phase roadmap */}
      <section className="bg-white border border-gray-200 rounded p-6">
        <div className="overline mb-3">Rollout roadmap</div>
        <ol className="grid grid-cols-1 md:grid-cols-4 gap-4 text-sm">
          {[
            { ph: "Phase 1", state: "Live", items: "Calculator · Pricing · Users", live: true },
            { ph: "Phase 2", state: "Next", items: "Customers · Quotes" },
            { ph: "Phase 3", state: "Planned", items: "Jobs · Production scheduling" },
            { ph: "Phase 4", state: "Planned", items: "Invoices · Fleet · Integrations" },
          ].map((p) => (
            <li key={p.ph} className="border border-gray-200 rounded p-4">
              <div className="flex items-center justify-between">
                <span className="font-bold text-[#1F2A33]">{p.ph}</span>
                <span
                  className={`text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded ${
                    p.live ? "bg-[#F5C518] text-[#1F2A33]" : "bg-gray-100 text-gray-500"
                  }`}
                >
                  {p.state}
                </span>
              </div>
              <p className="mt-2 text-xs text-gray-600">{p.items}</p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
