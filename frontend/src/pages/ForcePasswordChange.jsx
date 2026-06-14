import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, KeyRound, LogOut } from "lucide-react";
import { api, formatApiErrorDetail } from "../lib/api";
import { useAuth } from "../contexts/AuthContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";

export default function ForcePasswordChange() {
  const { user, logout, refresh } = useAuth();
  const navigate = useNavigate();
  const [currentPwd, setCurrentPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const onSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (newPwd !== confirm) { setError("New passwords don't match"); return; }
    if (newPwd.length < 8) { setError("New password must be at least 8 characters"); return; }
    setSubmitting(true);
    try {
      await api.post("/auth/change-password", { current_password: currentPwd, new_password: newPwd });
      await refresh();
      navigate("/");
    } catch (err) {
      setError(formatApiErrorDetail(err.response?.data?.detail) || err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const onLogout = async () => { await logout(); navigate("/login"); };

  return (
    <div className="min-h-screen bg-[#1F2A33] flex items-center justify-center p-4" data-testid="force-password-change-page">
      <div className="w-full max-w-md bg-white rounded-xl shadow-xl border border-gray-200 p-8">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-11 h-11 rounded-full bg-[#F5C518] text-[#1F2A33] flex items-center justify-center">
            <KeyRound className="w-5 h-5" />
          </div>
          <div>
            <div className="overline text-[#3A6B8C]">Action required</div>
            <h1 className="text-xl font-black tracking-tight text-[#1F2A33]">Change your password</h1>
          </div>
        </div>
        <p className="text-sm text-gray-600 mb-5">
          Hi <strong>{user?.name}</strong> — your account has been flagged for a password change. Set a new password to continue.
        </p>
        <form onSubmit={onSubmit} className="space-y-3">
          <div>
            <Label className="text-xs uppercase tracking-wider text-[#3A6B8C] font-bold">Current password</Label>
            <Input type="password" required value={currentPwd} onChange={(e) => setCurrentPwd(e.target.value)} data-testid="fpc-current" />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-[#3A6B8C] font-bold">New password</Label>
            <Input type="password" required minLength={8} value={newPwd} onChange={(e) => setNewPwd(e.target.value)} data-testid="fpc-new" />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-[#3A6B8C] font-bold">Confirm new password</Label>
            <Input type="password" required minLength={8} value={confirm} onChange={(e) => setConfirm(e.target.value)} data-testid="fpc-confirm" />
          </div>
          {error && <div className="text-sm text-red-700" data-testid="fpc-error">{error}</div>}
          <div className="flex items-center justify-between gap-3 pt-2">
            <button type="button" onClick={onLogout} className="text-xs text-gray-500 hover:text-[#1F2A33] inline-flex items-center gap-1" data-testid="fpc-logout">
              <LogOut className="w-3 h-3" /> Log out instead
            </button>
            <Button type="submit" disabled={submitting} data-testid="fpc-submit"
              className="bg-[#F5C518] text-[#1F2A33] font-bold hover:bg-[#E0B416] h-10 px-6">
              {submitting ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Updating…</> : "Update password"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
