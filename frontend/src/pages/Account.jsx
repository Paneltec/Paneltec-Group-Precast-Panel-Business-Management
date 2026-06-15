import { useEffect, useState } from "react";
import { Loader2, Save, KeyRound, ShieldCheck } from "lucide-react";
import AppIcon from "../components/AppIcon";
import { api, formatApiErrorDetail } from "../lib/api";
import { useAuth } from "../contexts/AuthContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Toaster, toast } from "sonner";
import { formatDateTime } from "../lib/format";

export default function AccountPage() {
  const { user, refresh } = useAuth();
  const [name, setName] = useState(user?.name || "");
  const [currentPwd, setCurrentPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirm, setConfirm] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPwd, setSavingPwd] = useState(false);
  const [catalogue, setCatalogue] = useState(null);

  useEffect(() => {
    api.get("/permissions/catalogue").then(({ data }) => setCatalogue(data)).catch(() => {});
  }, []);

  useEffect(() => { setName(user?.name || ""); }, [user]);

  if (!user) return null;

  const saveProfile = async (e) => {
    e.preventDefault();
    if (name.trim() === user.name) return;
    setSavingProfile(true);
    try {
      await api.patch("/users/me", { name: name.trim() });
      await refresh();
      toast.success("Profile updated");
    } catch (err) {
      toast.error(formatApiErrorDetail(err.response?.data?.detail) || err.message);
    } finally { setSavingProfile(false); }
  };

  const savePassword = async (e) => {
    e.preventDefault();
    if (newPwd !== confirm) { toast.error("Passwords don't match"); return; }
    setSavingPwd(true);
    try {
      await api.patch("/users/me", { current_password: currentPwd, new_password: newPwd });
      setCurrentPwd(""); setNewPwd(""); setConfirm("");
      toast.success("Password updated");
    } catch (err) {
      toast.error(formatApiErrorDetail(err.response?.data?.detail) || err.message);
    } finally { setSavingPwd(false); }
  };

  return (
    <div className="max-w-3xl space-y-6" data-testid="account-page">
      <Toaster richColors position="top-right" />
      <div>
        <div className="overline">My account</div>
        <h1 className="text-3xl md:text-4xl font-black tracking-tighter text-[#1F2A33]">Profile & security</h1>
        <p className="text-sm text-gray-500 mt-1">Update your display name and password. Email and role are managed by your super admin.</p>
      </div>

      {/* Profile */}
      <section className="bg-white border border-gray-200 rounded p-6 space-y-4">
        <h2 className="text-sm font-bold uppercase tracking-[0.15em] text-[#3A6B8C]">Profile</h2>
        <form onSubmit={saveProfile} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label className="text-xs uppercase tracking-wider text-[#3A6B8C] font-bold">Display name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} data-testid="account-name" />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-[#3A6B8C] font-bold">Email</Label>
            <Input value={user.email} disabled data-testid="account-email" className="bg-gray-50"/>
            <p className="text-[11px] text-gray-400 mt-1">Read-only. Ask a super admin to change your email.</p>
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-[#3A6B8C] font-bold">Role label</Label>
            <Input value={user.role_label || "—"} disabled data-testid="account-role-label" className="bg-gray-50"/>
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-[#3A6B8C] font-bold">Last login</Label>
            <Input value={user.last_login_at ? formatDateTime(user.last_login_at) : "—"} disabled data-testid="account-last-login" className="bg-gray-50"/>
          </div>
          <div className="md:col-span-2 flex justify-end">
            <Button type="submit" disabled={savingProfile || name.trim() === user.name} data-testid="account-save-profile"
              className="bg-[#F5C518] text-[#1F2A33] font-bold hover:bg-[#E0B416]">
              {savingProfile ? <><Loader2 className="w-4 h-4 mr-2 animate-spin"/> Saving…</> : <><AppIcon name="save" size={16} className="mr-2" decorative/> Save profile</>}
            </Button>
          </div>
        </form>
      </section>

      {/* Password */}
      <section className="bg-white border border-gray-200 rounded p-6 space-y-4">
        <h2 className="text-sm font-bold uppercase tracking-[0.15em] text-[#3A6B8C]">Change password</h2>
        <form onSubmit={savePassword} className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Input type="password" placeholder="Current password" required value={currentPwd} onChange={(e) => setCurrentPwd(e.target.value)} data-testid="account-current-pwd"/>
          <Input type="password" placeholder="New password (min 8)" required minLength={8} value={newPwd} onChange={(e) => setNewPwd(e.target.value)} data-testid="account-new-pwd"/>
          <Input type="password" placeholder="Confirm new" required minLength={8} value={confirm} onChange={(e) => setConfirm(e.target.value)} data-testid="account-confirm-pwd"/>
          <div className="md:col-span-3 flex justify-end">
            <Button type="submit" disabled={savingPwd} data-testid="account-save-pwd"
              className="bg-[#1F2A33] text-white font-bold hover:bg-[#3A6B8C]">
              {savingPwd ? <><Loader2 className="w-4 h-4 mr-2 animate-spin"/> Updating…</> : <><AppIcon name="password_changed" size={16} className="mr-2" decorative/> Update password</>}
            </Button>
          </div>
        </form>
      </section>

      {/* Permission summary */}
      <section className="bg-white border border-gray-200 rounded p-6 space-y-4">
        <h2 className="text-sm font-bold uppercase tracking-[0.15em] text-[#3A6B8C] flex items-center gap-2"><AppIcon name="roles_permissions" size={16} decorative/> What you can do</h2>
        {user.is_super_admin ? (
          <div className="rounded bg-[#F5C518]/15 border border-[#F5C518] text-[#1F2A33] text-sm px-4 py-3 font-semibold" data-testid="account-super-banner">
            You are a Super Admin — you can do everything across all modules.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 text-sm" data-testid="account-perm-grid">
            {(catalogue?.modules || []).map((m) => {
              const granted = m.permissions.filter((p) => user.permissions?.[p]);
              if (granted.length === 0) return null;
              return (
                <div key={m.key} className="border border-gray-200 rounded px-3 py-2">
                  <div className="text-[11px] uppercase tracking-wider text-[#3A6B8C] font-bold mb-1">{m.label}</div>
                  <div className="flex flex-wrap gap-1">
                    {granted.map((p) => (
                      <span key={p} className="text-[10px] bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded font-mono">{p.split(".")[1]}</span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
