import "@/App.css";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./contexts/AuthContext";
import ProtectedRoute from "./components/ProtectedRoute";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import CalculatorPage from "./pages/Calculator";
import PricingSettings from "./pages/PricingSettings";
import UsersPage from "./pages/Users";

function App() {
  return (
    <div className="App">
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route
              element={
                <ProtectedRoute>
                  <Layout />
                </ProtectedRoute>
              }
            >
              <Route path="/" element={<Dashboard />} />
              <Route path="/calculator" element={<CalculatorPage />} />
              <Route
                path="/settings/pricing"
                element={
                  <ProtectedRoute adminOnly>
                    <PricingSettings />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/users"
                element={
                  <ProtectedRoute adminOnly>
                    <UsersPage />
                  </ProtectedRoute>
                }
              />
            </Route>
            <Route path="*" element={<Login />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </div>
  );
}

export default App;
