import { Link } from "react-router-dom";
import { ShieldAlert, ArrowLeft } from "lucide-react";
import AppIcon from "../components/AppIcon";

export default function Forbidden({ requiredLabel = "" }) {
  return (
    <div className="min-h-screen bg-[#F5F6F7] flex items-center justify-center p-4" data-testid="forbidden-page">
      <div className="bg-white border border-gray-200 rounded-xl max-w-md w-full p-8 text-center shadow-sm">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-[#F5C518]/20 text-[#1F2A33] mb-4">
          <AppIcon name="shield" size={28} decorative/>
        </div>
        <div className="overline text-[#3A6B8C] mb-1">403 · Access denied</div>
        <h1 className="text-2xl font-black tracking-tight text-[#1F2A33] mb-2">You don't have access to this page</h1>
        <p className="text-sm text-gray-500 mb-1">
          Your role doesn't grant access here. If you believe this is wrong, ask a super admin to update your permissions.
        </p>
        {requiredLabel && (
          <p className="text-xs text-gray-400 mb-6" data-testid="forbidden-required">
            Required: <code className="bg-gray-100 px-1.5 py-0.5 rounded">{requiredLabel}</code>
          </p>
        )}
        <Link to="/" data-testid="forbidden-back-home"
          className="inline-flex items-center gap-2 px-4 py-2 rounded bg-[#1F2A33] text-white text-sm font-semibold hover:bg-[#3A6B8C] transition">
          <ArrowLeft className="w-4 h-4"/> Back to dashboard
        </Link>
      </div>
    </div>
  );
}
