import { useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { ChevronDown, Menu, X } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import AppIcon from "./AppIcon";

// Sidebar items — each gated by a permission OR superAdminOnly.
// `icon` is now a Fluent Emoji concept key (see /components/icon-map.json).
const NAV_ITEMS = [
  { to: "/", label: "Dashboard", icon: "dashboard", testid: "nav-dashboard" },
  { to: "/calculator", label: "Calculator", icon: "calculator", testid: "nav-calculator" },
  { to: "/customers", label: "Customers", icon: "customers", perm: "customers.view", testid: "nav-customers" },
  { to: "/projects", label: "Projects", icon: "projects", perm: "projects.view", testid: "nav-projects", hidden: true /* no dedicated list yet */ },
  { to: "/quotes", label: "Quotes", icon: "quotes", perm: "quotes.view", testid: "nav-quotes" },
  { to: "/jobs", label: "Jobs", icon: "jobs", perm: "jobs.view", testid: "nav-jobs" },
  { to: "/invoices", label: "Invoices", icon: "invoices", perm: "invoices.view", testid: "nav-invoices" },
  { to: "/forms", label: "Compliance Forms", icon: "compliance_forms", perm: "forms.view", testid: "nav-forms" },
  { to: "/forms/templates", label: "Form Templates", icon: "settings", perm: "forms.template_manage", testid: "nav-form-templates" },
  { to: "/vehicles", label: "Vehicles", icon: "vehicles", perm: "vehicles.view", testid: "nav-vehicles" },
  { to: "/employees", label: "Employees", icon: "employees", perm: "employees.view", testid: "nav-employees" },
  { to: "/settings/pricing", label: "Pricing", icon: "pricing", perm: "pricing.view", testid: "nav-settings" },
  { to: "/settings/company", label: "Company", icon: "company", perm: "company.view", testid: "nav-company-settings" },
  { to: "/settings/integrations", label: "Integrations", icon: "integrations", perm: "integrations.view", testid: "nav-integrations" },
  { to: "/users", label: "Users", icon: "users", perm: "users.view", testid: "nav-users" },
  { to: "/admin/audit", label: "Audit Trail", icon: "audit", perm: "audit.view", testid: "nav-audit" },
  { to: "/reports", label: "Reports", icon: "reports", testid: "nav-reports" },
  { to: "/help", label: "Help", icon: "help", testid: "nav-help" },
];

export default function Layout() {
  const { user, logout, hasPerm } = useAuth();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  const visibleNav = NAV_ITEMS.filter((i) => !i.hidden).filter((i) => !i.perm || hasPerm(i.perm));

  return (
    <div className="min-h-screen bg-[#F5F6F7]">
      {/* Sidebar — desktop */}
      <aside
        data-testid="sidebar"
        className={`fixed top-0 left-0 h-screen w-64 bg-[#1F2A33] text-white flex flex-col z-40 no-print transform transition-transform xl:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full xl:translate-x-0"
        }`}
      >
        <div className="px-6 pt-7 pb-6 border-b border-white/10">
          <Link to="/" className="block" data-testid="brand-link">
            <div className="brand-wordmark text-2xl text-white leading-none">Paneltec</div>
            <div className="brand-wordmark text-2xl text-[#F5C518] leading-none">Group</div>
            <div className="mt-2 text-[10px] uppercase tracking-[0.22em] text-white/50">Precast Panel Mgmt</div>
          </Link>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-5">
          <div className="px-3 mb-2 overline text-white/40">Main</div>
          <ul className="space-y-1">
            {visibleNav.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.to === "/"}
                  data-testid={item.testid}
                  onClick={() => setMobileOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3 py-2.5 rounded text-sm font-medium transition-colors ${
                      isActive
                        ? "bg-[#3A6B8C] text-white"
                        : "text-white/80 hover:bg-white/10 hover:text-white"
                    }`
                  }
                >
                  <AppIcon name={item.icon} size={20} decorative />
                  <span>{item.label}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <div className="px-5 py-4 border-t border-white/10 text-[11px] text-white/40">
          v1.0 · Phase 11
        </div>
      </aside>

      {/* Backdrop for mobile */}
      {mobileOpen && (
        <div className="fixed inset-0 bg-black/40 z-30 xl:hidden no-print"
          onClick={() => setMobileOpen(false)}/>
      )}

      <div className="xl:ml-64">
        {/* Header */}
        <header className="app-header h-16 bg-white border-b border-gray-200 flex items-center justify-between px-4 sm:px-8 sticky top-0 z-20 no-print">
          <div className="flex items-center gap-3">
            <button onClick={() => setMobileOpen((v) => !v)}
              className="xl:hidden p-2 rounded hover:bg-gray-100"
              data-testid="mobile-menu-toggle" aria-label="Toggle navigation">
              {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
            <div className="hidden sm:block">
              <div className="overline">Paneltec Group</div>
              <div className="text-sm font-semibold text-[#1F2A33]">Precast Panel Business Management</div>
            </div>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button data-testid="user-menu-trigger"
                className="flex items-center gap-2 px-3 py-1.5 rounded hover:bg-gray-50 border border-transparent hover:border-gray-200 transition">
                <div className="w-8 h-8 rounded bg-[#1F2A33] text-[#F5C518] flex items-center justify-center text-xs font-bold">
                  {user?.name?.charAt(0)?.toUpperCase() || "U"}
                </div>
                <div className="hidden sm:block text-left">
                  <div className="text-sm font-semibold text-[#1F2A33] leading-tight">{user?.name}</div>
                  <div className="text-[10px] uppercase tracking-wider text-[#3A6B8C] font-bold">
                    {user?.is_super_admin ? "Super Admin" : (user?.role_label || "Staff")}
                  </div>
                </div>
                <ChevronDown className="w-4 h-4 text-gray-500" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>
                <div className="text-sm">{user?.name}</div>
                <div className="text-xs text-gray-500 font-normal">{user?.email}</div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => navigate("/account")} data-testid="account-menu-link"
                className="cursor-pointer">
                <AppIcon name="account" size={16} className="mr-2" decorative /> My account
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem data-testid="logout-btn" onClick={handleLogout}
                className="text-red-600 focus:text-red-700 cursor-pointer">
                <AppIcon name="logout" size={16} className="mr-2" decorative /> Logout
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        <main className="app-main p-4 sm:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
