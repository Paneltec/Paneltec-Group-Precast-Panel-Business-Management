import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import Forbidden from "../pages/Forbidden";

export default function ProtectedRoute({ children, adminOnly = false, permission = null, superAdminOnly = false }) {
  const { user, loading, isSuperAdmin, hasPerm } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F5F6F7]">
        <div data-testid="auth-loading" className="text-[#1F2A33] text-sm font-medium">Loading…</div>
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  // Block everything except the change-password screen while password change is forced.
  if (user.must_change_password && !location.pathname.startsWith("/force-password-change")) {
    return <Navigate to="/force-password-change" replace />;
  }
  if (superAdminOnly && !isSuperAdmin) {
    return <Forbidden requiredLabel="super admin" />;
  }
  if (adminOnly && !isSuperAdmin) {
    return <Forbidden requiredLabel="super admin" />;
  }
  if (permission && !hasPerm(permission)) {
    return <Forbidden requiredLabel={permission} />;
  }
  return children;
}
