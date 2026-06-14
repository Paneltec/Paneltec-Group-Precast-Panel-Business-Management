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
import Vehicles from "./pages/Vehicles";
import Employees from "./pages/Employees";
import IntegrationSettings from "./pages/IntegrationSettings";
import CustomerPrint from "./pages/CustomerPrint";
import ProjectPrint from "./pages/ProjectPrint";
import JobPrint from "./pages/JobPrint";

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
                <Route path="/quotes/:id/print" element={<ProtectedRoute><QuotePrint /></ProtectedRoute>} />
                <Route path="/invoices/:id/print" element={<ProtectedRoute><InvoicePrint /></ProtectedRoute>} />
                <Route path="/customers/:id/print" element={<ProtectedRoute><CustomerPrint /></ProtectedRoute>} />
                <Route path="/projects/:id/print" element={<ProtectedRoute><ProjectPrint /></ProtectedRoute>} />
                <Route path="/jobs/:id/print" element={<ProtectedRoute><JobPrint /></ProtectedRoute>} />
                <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
                  <Route path="/" element={<Dashboard />} />
                  <Route path="/calculator" element={<CalculatorPage />} />
                  <Route path="/customers" element={<CustomersList />} />
                  <Route path="/customers/new" element={<CustomerForm />} />
                  <Route path="/customers/:id" element={<CustomerForm />} />
                  <Route path="/quotes" element={<QuotesList />} />
                  <Route path="/quotes/new" element={<QuoteEditor />} />
                  <Route path="/quotes/:id" element={<QuoteDetail />} />
                  <Route path="/quotes/:id/edit" element={<QuoteEditor />} />
                  <Route path="/jobs" element={<JobsList />} />
                  <Route path="/jobs/:id" element={<JobDetail />} />
                  <Route path="/invoices" element={<InvoicesList />} />
                  <Route path="/invoices/:id" element={<InvoiceDetail />} />
                  <Route path="/vehicles" element={<Vehicles />} />
                  <Route path="/employees" element={<Employees />} />
                  <Route path="/settings/pricing" element={<ProtectedRoute adminOnly><PricingSettings /></ProtectedRoute>} />
                  <Route path="/settings/company" element={<ProtectedRoute adminOnly><CompanySettings /></ProtectedRoute>} />
                  <Route path="/settings/integrations" element={<ProtectedRoute adminOnly><IntegrationSettings /></ProtectedRoute>} />
                  <Route path="/users" element={<ProtectedRoute adminOnly><UsersPage /></ProtectedRoute>} />
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
