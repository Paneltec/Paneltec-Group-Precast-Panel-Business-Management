import "@/App.css";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./contexts/AuthContext";
import ProtectedRoute from "./components/ProtectedRoute";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import CalculatorPage from "./pages/Calculator";
import PricingSettings from "./pages/PricingSettings";
import CompanySettings from "./pages/CompanySettings";
import UsersPage from "./pages/Users";
import CustomersList from "./pages/CustomersList";
import CustomerForm from "./pages/CustomerForm";
import QuotesList from "./pages/QuotesList";
import QuoteEditor from "./pages/QuoteEditor";
import QuoteDetail from "./pages/QuoteDetail";
import QuotePrint from "./pages/QuotePrint";
import PublicQuote from "./pages/PublicQuote";
import JobsList from "./pages/JobsList";
import JobDetail from "./pages/JobDetail";
import InvoicesList from "./pages/InvoicesList";
import InvoiceDetail from "./pages/InvoiceDetail";
import InvoicePrint from "./pages/InvoicePrint";
import Vehicles, { VehicleForm } from "./pages/Vehicles";
import Employees, { EmployeeForm } from "./pages/Employees";
import IntegrationSettings from "./pages/IntegrationSettings";
import CustomerPrint from "./pages/CustomerPrint";
import ProjectPrint from "./pages/ProjectPrint";
import JobPrint from "./pages/JobPrint";
import Account from "./pages/Account";
import ForcePasswordChange from "./pages/ForcePasswordChange";
import Forbidden from "./pages/Forbidden";
import Audit from "./pages/Audit";
import Reports from "./pages/Reports";
import ReportDetail from "./pages/ReportDetail";
import Help from "./pages/Help";
import HelpPrint from "./pages/HelpPrint";

function App() {
  return (
    <div className="App">
      <BrowserRouter>
        <Routes>
          <Route path="/q/:token" element={<PublicQuote />} />
          <Route path="*" element={
            <AuthProvider>
              <Routes>
                <Route path="/login" element={<Login />} />
                <Route path="/force-password-change" element={<ProtectedRoute><ForcePasswordChange /></ProtectedRoute>} />
                <Route path="/forbidden" element={<Forbidden />} />
                <Route path="/quotes/:id/print" element={<ProtectedRoute permission="quotes.view"><QuotePrint /></ProtectedRoute>} />
                <Route path="/invoices/:id/print" element={<ProtectedRoute permission="invoices.view"><InvoicePrint /></ProtectedRoute>} />
                <Route path="/customers/:id/print" element={<ProtectedRoute permission="customers.view"><CustomerPrint /></ProtectedRoute>} />
                <Route path="/projects/:id/print" element={<ProtectedRoute permission="projects.view"><ProjectPrint /></ProtectedRoute>} />
                <Route path="/jobs/:id/print" element={<ProtectedRoute permission="jobs.view"><JobPrint /></ProtectedRoute>} />
                <Route path="/help/print" element={<ProtectedRoute><HelpPrint /></ProtectedRoute>} />
                <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
                  <Route path="/" element={<Dashboard />} />
                  <Route path="/account" element={<Account />} />
                  <Route path="/calculator" element={<CalculatorPage />} />
                  <Route path="/customers" element={<ProtectedRoute permission="customers.view"><CustomersList /></ProtectedRoute>} />
                  <Route path="/customers/new" element={<ProtectedRoute permission="customers.create"><CustomerForm /></ProtectedRoute>} />
                  <Route path="/customers/:id" element={<ProtectedRoute permission="customers.view"><CustomerForm /></ProtectedRoute>} />
                  <Route path="/quotes" element={<ProtectedRoute permission="quotes.view"><QuotesList /></ProtectedRoute>} />
                  <Route path="/quotes/new" element={<ProtectedRoute permission="quotes.create"><QuoteEditor /></ProtectedRoute>} />
                  <Route path="/quotes/:id" element={<ProtectedRoute permission="quotes.view"><QuoteDetail /></ProtectedRoute>} />
                  <Route path="/quotes/:id/edit" element={<ProtectedRoute permission="quotes.edit"><QuoteEditor /></ProtectedRoute>} />
                  <Route path="/jobs" element={<ProtectedRoute permission="jobs.view"><JobsList /></ProtectedRoute>} />
                  <Route path="/jobs/:id" element={<ProtectedRoute permission="jobs.view"><JobDetail /></ProtectedRoute>} />
                  <Route path="/invoices" element={<ProtectedRoute permission="invoices.view"><InvoicesList /></ProtectedRoute>} />
                  <Route path="/invoices/:id" element={<ProtectedRoute permission="invoices.view"><InvoiceDetail /></ProtectedRoute>} />
                  <Route path="/vehicles" element={<ProtectedRoute permission="vehicles.view"><Vehicles /></ProtectedRoute>} />
                  <Route path="/vehicles/new" element={<ProtectedRoute permission="vehicles.create"><VehicleForm /></ProtectedRoute>} />
                  <Route path="/vehicles/:id" element={<ProtectedRoute permission="vehicles.view"><VehicleForm /></ProtectedRoute>} />
                  <Route path="/employees" element={<ProtectedRoute permission="employees.view"><Employees /></ProtectedRoute>} />
                  <Route path="/employees/new" element={<ProtectedRoute permission="employees.create"><EmployeeForm /></ProtectedRoute>} />
                  <Route path="/employees/:id" element={<ProtectedRoute permission="employees.view"><EmployeeForm /></ProtectedRoute>} />
                  <Route path="/settings/pricing" element={<ProtectedRoute permission="pricing.view"><PricingSettings /></ProtectedRoute>} />
                  <Route path="/settings/company" element={<ProtectedRoute permission="company.view"><CompanySettings /></ProtectedRoute>} />
                  <Route path="/settings/integrations" element={<ProtectedRoute permission="integrations.view"><IntegrationSettings /></ProtectedRoute>} />
                  <Route path="/users" element={<ProtectedRoute permission="users.view"><UsersPage /></ProtectedRoute>} />
                  <Route path="/admin/audit" element={<ProtectedRoute permission="audit.view"><Audit /></ProtectedRoute>} />
                  <Route path="/reports" element={<ProtectedRoute><Reports /></ProtectedRoute>} />
                  <Route path="/reports/:key" element={<ProtectedRoute><ReportDetail /></ProtectedRoute>} />
                  <Route path="/help" element={<Help />} />
                </Route>
                <Route path="*" element={<Login />} />
              </Routes>
            </AuthProvider>
          } />
        </Routes>
      </BrowserRouter>
    </div>
  );
}

export default App;
