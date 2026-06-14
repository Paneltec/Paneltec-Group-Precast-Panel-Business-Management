import { useEffect, useMemo, useState } from "react";
import { Loader2, UserPlus, Search, KeyRound, ShieldCheck } from "lucide-react";
import { api, formatApiErrorDetail } from "../lib/api";
import { useAuth } from "../contexts/AuthContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Switch } from "../components/ui/switch";
import { Checkbox } from "../components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription,
} from "../components/ui/dialog";
import { Toaster, toast } from "sonner";
import { formatDateTime } from "../lib/format";

export default function UsersPage() {
  const { user: me, isSuperAdmin } = useAuth();
  const [users, setUsers] = useState(null);
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState("all"); // all | true | false
  const [catalogue, setCatalogue] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const load = async () => {
    try {
      const { data } = await api.get("/users");
      setUsers(data);
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message);
    }
  };
  useEffect(() => {
    load();
    api.get("/permissions/catalogue").then(({ data }) => setCatalogue(data)).catch(() => {});
  }, []);

  const filtered = useMemo(() => {
    if (!users) return [];
    return users.filter((u) => {
      if (activeFilter === "true" && !u.is_active) return false;
      if (activeFilter === "false" && u.is_active) return false;
      if (!search) return true;
      const s = search.toLowerCase();
      return u.email.toLowerCase().includes(s) || (u.name || "").toLowerCase().includes(s);
    });
  }, [users, search, activeFilter]);

  const toggleActive = async (u) => {
    try {
      await api.patch(`/users/${u.id}`, { is_active: !u.is_active });
      toast.success(`${u.email} ${!u.is_active ? "activated" : "deactivated"}`);
      load();
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message);
    }
  };

  return (
    <div className="max-w-7xl space-y-6" data-testid="users-page">
      <Toaster richColors position="top-right" />
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <div className="overline">Super Admin</div>
          <h1 className="text-3xl md:text-4xl font-black tracking-tighter text-[#1F2A33]">Users & Permissions</h1>
          <p className="text-sm text-gray-500 mt-1">Create staff accounts, fine-tune permissions, reset passwords.</p>
        </div>
        {isSuperAdmin && (
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button data-testid="open-create-user-btn"
                className="bg-[#F5C518] text-[#1F2A33] font-bold hover:bg-[#E0B416] h-11 px-6">
                <UserPlus className="w-4 h-4 mr-2" /> New user
              </Button>
            </DialogTrigger>
            <UserFormDialog catalogue={catalogue} mode="create"
              onDone={() => { setDialogOpen(false); load(); }} />
          </Dialog>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input className="pl-9 w-72" placeholder="Search name or email" value={search}
            onChange={(e) => setSearch(e.target.value)} data-testid="user-search"/>
        </div>
        <div className="inline-flex rounded border border-gray-200 bg-white p-0.5 text-xs">
          {[["all","All"],["true","Active"],["false","Inactive"]].map(([k,l]) => (
            <button key={k} onClick={() => setActiveFilter(k)} data-testid={`filter-${k}`}
              className={`px-3 py-1.5 rounded font-semibold ${activeFilter===k ? "bg-[#1F2A33] text-white" : "text-gray-600 hover:bg-gray-50"}`}>{l}</button>
          ))}
        </div>
      </div>

      <section className="bg-white border border-gray-200 rounded overflow-hidden">
        {!users ? (
          <div className="p-6 flex items-center gap-2 text-gray-500 text-sm">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading users…
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[#3A6B8C] text-white uppercase text-[10px] tracking-wider">
                <tr>
                  <th className="px-4 py-3 text-left">Name</th>
                  <th className="px-4 py-3 text-left">Email</th>
                  <th className="px-4 py-3 text-left">Role label</th>
                  <th className="px-4 py-3 text-left">Super admin</th>
                  <th className="px-4 py-3 text-left">Last login</th>
                  <th className="px-4 py-3 text-left">Created</th>
                  <th className="px-4 py-3 text-right">Active</th>
                </tr>
              </thead>
              <tbody data-testid="users-table-body">
                {filtered.map((u) => (
                  <tr key={u.id} data-testid={`user-row-${u.email}`}
                    className="border-t border-gray-200 hover:bg-gray-50 cursor-pointer"
                    onClick={() => isSuperAdmin && setEditing(u)}>
                    <td className="px-4 py-3 font-medium text-[#1F2A33]">{u.name}</td>
                    <td className="px-4 py-3 text-gray-700">{u.email}</td>
                    <td className="px-4 py-3 text-gray-600">{u.role_label || "—"}</td>
                    <td className="px-4 py-3">
                      {u.is_super_admin ? (
                        <span className="text-[10px] font-bold uppercase tracking-wider bg-[#F5C518] text-[#1F2A33] px-2 py-0.5 rounded inline-flex items-center gap-1">
                          <ShieldCheck className="w-3 h-3"/> Super
                        </span>
                      ) : (
                        <span className="text-[10px] text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{u.last_login_at ? formatDateTime(u.last_login_at) : "Never"}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{formatDateTime(u.created_at)}</td>
                    <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <Switch checked={u.is_active} onCheckedChange={() => toggleActive(u)}
                        disabled={u.id === me?.id || !isSuperAdmin}
                        data-testid={`user-active-${u.email}`}/>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Edit dialog */}
      {editing && (
        <Dialog open={!!editing} onOpenChange={(v) => { if (!v) setEditing(null); }}>
          <UserFormDialog catalogue={catalogue} mode="edit" initial={editing}
            onDone={() => { setEditing(null); load(); }} />
        </Dialog>
      )}
    </div>
  );
}

// -------------------------------------------------------------------------
// User create/edit dialog with full permission grid
// -------------------------------------------------------------------------
function UserFormDialog({ catalogue, mode, initial, onDone }) {
  const { user: me } = useAuth();
  const isEdit = mode === "edit";
  const [name, setName] = useState(initial?.name || "");
  const [email, setEmail] = useState(initial?.email || "");
  const [roleLabel, setRoleLabel] = useState(initial?.role_label || "");
  const [isSuper, setIsSuper] = useState(!!initial?.is_super_admin);
  const [perms, setPerms] = useState(initial?.permissions || {});
  const [password, setPassword] = useState("");
  const [mustChange, setMustChange] = useState(isEdit ? !!initial?.must_change_password : true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [resetReveal, setResetReveal] = useState(null); // {email, password}

  const togglePerm = (key) => setPerms((p) => ({ ...p, [key]: !p[key] }));
  const setAllInModule = (mod, on) => {
    setPerms((p) => {
      const next = { ...p };
      mod.permissions.forEach((k) => { next[k] = on; });
      return next;
    });
  };
  const applyPreset = (preset) => {
    if (preset.key === "clear") { setPerms({}); return; }
    const next = {};
    preset.permissions.forEach((k) => { next[k] = true; });
    setPerms(next);
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      // strip elevated perms client-side if not super (server enforces too)
      const cleanPerms = isSuper ? perms : Object.fromEntries(Object.entries(perms).filter(([k]) => !(catalogue?.elevated_permissions || []).includes(k)));
      if (isEdit) {
        const patch = {
          name: name.trim(),
          role_label: roleLabel.trim(),
          is_super_admin: isSuper,
          permissions: cleanPerms,
          must_change_password: mustChange,
        };
        await api.patch(`/users/${initial.id}`, patch);
        toast.success("User updated");
      } else {
        await api.post("/users", {
          name: name.trim(),
          email: email.trim().toLowerCase(),
          password,
          role_label: roleLabel.trim(),
          is_super_admin: isSuper,
          permissions: cleanPerms,
          must_change_password: mustChange,
        });
        toast.success(`User ${email} created`);
      }
      onDone?.();
    } catch (err) {
      setError(formatApiErrorDetail(err.response?.data?.detail) || err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const onResetPassword = async () => {
    const newPwd = prompt("Enter a temporary password for this user (min 8 chars):");
    if (!newPwd || newPwd.length < 8) return;
    try {
      const { data } = await api.post(`/users/${initial.id}/reset-password`,
        { new_password: newPwd, must_change_password: true });
      setResetReveal({ email: data.email, password: data.new_password });
      toast.success("Password reset — share securely.");
    } catch (err) {
      toast.error(formatApiErrorDetail(err.response?.data?.detail) || err.message);
    }
  };

  return (
    <DialogContent data-testid="user-form-dialog" className="max-w-3xl max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{isEdit ? `Edit ${initial.email}` : "New user"}</DialogTitle>
        <DialogDescription>
          {isEdit ? "Update profile, role label, super-admin flag and individual permissions." : "Create a new account. They'll log in with email + password and (optionally) be forced to change it."}
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={onSubmit} className="space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <Label className="text-xs uppercase tracking-wider text-[#3A6B8C] font-bold">Name</Label>
            <Input value={name} required onChange={(e) => setName(e.target.value)} data-testid="uf-name"/>
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-[#3A6B8C] font-bold">Email</Label>
            <Input type="email" value={email} required disabled={isEdit} onChange={(e) => setEmail(e.target.value)} data-testid="uf-email"/>
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-[#3A6B8C] font-bold">Role label (display only)</Label>
            <Input value={roleLabel} placeholder="e.g. Estimator, Production Manager" onChange={(e) => setRoleLabel(e.target.value)} data-testid="uf-role-label"/>
          </div>
          {!isEdit && (
            <div>
              <Label className="text-xs uppercase tracking-wider text-[#3A6B8C] font-bold">Temporary password (min 8)</Label>
              <Input type="text" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} data-testid="uf-password"/>
            </div>
          )}
        </div>

        <label className="flex items-start gap-3 p-3 bg-red-50 border border-red-200 rounded">
          <Checkbox checked={isSuper} onCheckedChange={setIsSuper} data-testid="uf-super-admin"
            disabled={isEdit && initial?.id === me?.id /* can't remove your own flag here */ && isSuper}/>
          <div>
            <div className="font-bold text-red-800 text-sm">Make this user a Super Admin</div>
            <div className="text-xs text-red-700 mt-0.5">
              Super admins bypass all permission checks and can manage other super admins, integrations, pricing, company settings, and other users.
              At least one active super admin is required.
            </div>
          </div>
        </label>

        <label className="flex items-center gap-3 text-sm">
          <Checkbox checked={mustChange} onCheckedChange={setMustChange} data-testid="uf-must-change"/>
          <span>Force password change on next login</span>
        </label>

        {/* Presets */}
        <div className="space-y-2">
          <div className="text-xs uppercase tracking-wider text-[#3A6B8C] font-bold">Quick presets</div>
          <div className="flex flex-wrap gap-2">
            {(catalogue?.presets || []).map((preset) => (
              <button type="button" key={preset.key} onClick={() => applyPreset(preset)}
                data-testid={`uf-preset-${preset.key}`}
                className="text-xs font-bold uppercase tracking-wider bg-[#3A6B8C] text-white px-3 py-1.5 rounded hover:bg-[#1F2A33]">
                {preset.label}
              </button>
            ))}
            <button type="button" onClick={() => applyPreset({ key: "clear", permissions: [] })}
              data-testid="uf-preset-clear"
              className="text-xs font-bold uppercase tracking-wider bg-gray-100 text-gray-700 px-3 py-1.5 rounded hover:bg-gray-200">
              Clear all
            </button>
          </div>
        </div>

        {/* Permission grid */}
        {!isSuper && (
          <div className="space-y-3">
            <div className="text-xs uppercase tracking-wider text-[#3A6B8C] font-bold">Permissions</div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {(catalogue?.modules || []).map((mod) => {
                const allOn = mod.permissions.every((k) => perms[k]);
                return (
                  <div key={mod.key} className="border border-gray-200 rounded p-3" data-testid={`uf-module-${mod.key}`}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="font-bold text-[#1F2A33] text-sm">{mod.label}</div>
                      <label className="text-[11px] text-gray-500 flex items-center gap-1">
                        <Checkbox checked={allOn} onCheckedChange={(v) => setAllInModule(mod, !!v)}
                          data-testid={`uf-module-all-${mod.key}`}/>
                        <span>All</span>
                      </label>
                    </div>
                    <div className="space-y-1.5">
                      {mod.permissions.map((k) => {
                        const elevated = (catalogue?.elevated_permissions || []).includes(k);
                        return (
                          <label key={k} className={`flex items-center gap-2 text-xs ${elevated ? "text-red-700" : "text-gray-700"}`}>
                            <Checkbox checked={!!perms[k]} onCheckedChange={() => togglePerm(k)}
                              data-testid={`uf-perm-${k}`}/>
                            <span className="font-mono">{k.split(".")[1]}</span>
                            {elevated && <span className="text-[9px] uppercase tracking-wider bg-red-100 text-red-700 px-1 rounded ml-auto">Super only</span>}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
            {Object.entries(perms).some(([k, v]) => v && (catalogue?.elevated_permissions || []).includes(k)) && (
              <div className="text-xs text-red-700 font-semibold">
                Elevated permissions selected — toggle Super Admin or these will be ignored on save.
              </div>
            )}
          </div>
        )}

        {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2" data-testid="uf-error">{error}</div>}

        {resetReveal && (
          <div className="bg-yellow-50 border border-yellow-300 rounded p-3 text-sm" data-testid="uf-reset-reveal">
            <div className="font-bold text-yellow-900">Temporary password for {resetReveal.email}</div>
            <code className="block mt-1 font-mono text-lg">{resetReveal.password}</code>
            <p className="text-[11px] text-yellow-800 mt-1">Share securely. The user will be forced to change on next login.</p>
          </div>
        )}

        <div className="flex items-center justify-between pt-3 border-t border-gray-200">
          {isEdit ? (
            <button type="button" onClick={onResetPassword} data-testid="uf-reset-password-btn"
              className="text-xs font-bold uppercase tracking-wider text-[#3A6B8C] hover:text-[#1F2A33] inline-flex items-center gap-1">
              <KeyRound className="w-3 h-3"/> Reset password
            </button>
          ) : <span />}
          <Button type="submit" disabled={submitting} data-testid="uf-submit"
            className="bg-[#F5C518] text-[#1F2A33] font-bold hover:bg-[#E0B416] h-10 px-6">
            {submitting ? <><Loader2 className="w-4 h-4 mr-2 animate-spin"/> Saving…</> : (isEdit ? "Save changes" : "Create user")}
          </Button>
        </div>
      </form>
    </DialogContent>
  );
}
