import { useEffect, useMemo, useState } from "react";
import { Loader2, UserPlus, Search, KeyRound, ShieldCheck, Trash2, AlertTriangle, RotateCcw, Skull } from "lucide-react";
import AppIcon from "../components/AppIcon";
import { api, formatApiErrorDetail } from "../lib/api";
import { useAuth } from "../contexts/AuthContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Switch } from "../components/ui/switch";
import { Checkbox } from "../components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription, DialogFooter,
} from "../components/ui/dialog";
import { Toaster, toast } from "sonner";
import { formatDateTime } from "../lib/format";

export default function UsersPage() {
  const { user: me, isSuperAdmin } = useAuth();
  const [users, setUsers] = useState(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("active"); // active|inactive|deleted|all
  const [catalogue, setCatalogue] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);       // soft-delete confirmation
  const [permDeleteTarget, setPermDeleteTarget] = useState(null); // hard-delete confirmation
  const [restoreTarget, setRestoreTarget] = useState(null);     // restore confirmation

  const load = async (status = statusFilter) => {
    try {
      const { data } = await api.get(`/users?status=${status}`);
      setUsers(data);
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message);
    }
  };
  useEffect(() => {
    load(statusFilter);
    api.get("/permissions/catalogue").then(({ data }) => setCatalogue(data)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  const filtered = useMemo(() => {
    if (!users) return [];
    if (!search) return users;
    const s = search.toLowerCase();
    return users.filter((u) =>
      u.email.toLowerCase().includes(s) || (u.name || "").toLowerCase().includes(s)
    );
  }, [users, search]);

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
                <AppIcon name="add" size={16} className="mr-2" decorative/> New user
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
          <AppIcon name="search" size={16} decorative/>
          <Input className="pl-9 w-72" placeholder="Search name or email" value={search}
            onChange={(e) => setSearch(e.target.value)} data-testid="user-search"/>
        </div>
        <div className="inline-flex rounded border border-gray-200 bg-white p-0.5 text-xs">
          {[["active","Active"],["inactive","Inactive"],["deleted","Deleted"],["all","All"]].map(([k,l]) => (
            <button key={k} onClick={() => setStatusFilter(k)} data-testid={`filter-${k}`}
              className={`px-3 py-1.5 rounded font-semibold ${statusFilter===k ? "bg-[#1F2A33] text-white" : "text-gray-600 hover:bg-gray-50"}`}>{l}</button>
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
                  <th className="px-4 py-3 text-right">{statusFilter === "deleted" ? "Actions" : "Active"}</th>
                </tr>
              </thead>
              <tbody data-testid="users-table-body">
                {filtered.map((u) => {
                  const isDeleted = !!u.deleted_at;
                  return (
                  <tr key={u.id} data-testid={`user-row-${u.email}`}
                    className={`border-t border-gray-200 hover:bg-gray-50 ${!isDeleted && isSuperAdmin ? "cursor-pointer" : ""} ${isDeleted ? "opacity-60" : ""}`}
                    onClick={() => !isDeleted && isSuperAdmin && setEditing(u)}>
                    <td className="px-4 py-3 font-medium text-[#1F2A33]">
                      {u.name}
                      {isDeleted && <span className="ml-2 text-[10px] text-red-700 italic" data-testid={`deleted-tag-${u.email}`}>(deleted)</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-700">{u.email}</td>
                    <td className="px-4 py-3 text-gray-600">{u.role_label || "—"}</td>
                    <td className="px-4 py-3">
                      {u.is_super_admin ? (
                        <span className="text-[10px] font-bold uppercase tracking-wider bg-[#F5C518] text-[#1F2A33] px-2 py-0.5 rounded inline-flex items-center gap-1">
                          <AppIcon name="roles_permissions" size={12} decorative/> Super
                        </span>
                      ) : (
                        <span className="text-[10px] text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{u.last_login_at ? formatDateTime(u.last_login_at) : "Never"}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{formatDateTime(u.created_at)}</td>
                    <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      {isDeleted ? (
                        <div className="inline-flex gap-2 justify-end">
                          <button onClick={() => setRestoreTarget(u)} data-testid={`user-restore-${u.email}`}
                            className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-[#3A6B8C] hover:text-[#1F2A33]">
                            <AppIcon name="restore" size={12} decorative/> Restore
                          </button>
                          {isSuperAdmin && (
                            <button onClick={() => setPermDeleteTarget(u)} data-testid={`user-perm-delete-${u.email}`}
                              className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-red-900 hover:text-red-700">
                              <AppIcon name="hard_deleted" size={12} decorative/> Permanently
                            </button>
                          )}
                        </div>
                      ) : (
                        <div className="inline-flex gap-3 items-center justify-end">
                          <Switch checked={u.is_active} onCheckedChange={() => toggleActive(u)}
                            disabled={u.id === me?.id || !isSuperAdmin}
                            data-testid={`user-active-${u.email}`}/>
                          {isSuperAdmin && u.id !== me?.id && (
                            <button onClick={() => setDeleteTarget(u)} data-testid={`user-delete-${u.email}`}
                              title="Delete user"
                              className="text-red-600 hover:text-red-800 p-1 rounded hover:bg-red-50">
                              <AppIcon name="delete" size={16} decorative/>
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>);
                })}
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

      {/* Soft delete confirmation */}
      <DeleteConfirm
        target={deleteTarget} onClose={() => setDeleteTarget(null)}
        onConfirmed={() => { setDeleteTarget(null); load(); }} />

      {/* Permanent delete confirmation */}
      <PermDeleteConfirm
        target={permDeleteTarget} onClose={() => setPermDeleteTarget(null)}
        onConfirmed={() => { setPermDeleteTarget(null); load(); }} />

      {/* Restore confirmation */}
      <RestoreConfirm
        target={restoreTarget} onClose={() => setRestoreTarget(null)}
        onConfirmed={() => { setRestoreTarget(null); load(); }} />
    </div>
  );
}

// -------------------------------------------------------------------------
// Soft delete confirmation modal
// -------------------------------------------------------------------------
function DeleteConfirm({ target, onClose, onConfirmed }) {
  const [busy, setBusy] = useState(false);
  if (!target) return null;
  const submit = async () => {
    setBusy(true);
    try {
      await api.delete(`/users/${target.id}`);
      toast.success(`${target.email} soft-deleted`);
      onConfirmed?.();
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message);
    } finally { setBusy(false); }
  };
  return (
    <Dialog open={!!target} onOpenChange={(v) => { if (!v) onClose?.(); }}>
      <DialogContent data-testid="delete-confirm-dialog" className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-red-700 inline-flex items-center gap-2">
            <AppIcon name="delete" size={20} decorative/> Delete user?
          </DialogTitle>
          <DialogDescription className="pt-2 text-sm text-gray-700">
            This will soft-delete <strong>{target.name}</strong> ({target.email}). Their historical contributions
            (quotes, jobs, invoices) remain visible but marked as deleted. They will no longer be able to log in.
            You can restore them later from the <em>Deleted</em> filter.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} data-testid="delete-cancel">Cancel</Button>
          <Button onClick={submit} disabled={busy} className="bg-red-600 text-white hover:bg-red-700" data-testid="delete-confirm">
            {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin"/> : <AppIcon name="delete" size={16} className="mr-2" decorative/>} Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// -------------------------------------------------------------------------
// Permanent delete modal — fetches reference count, requires email confirmation
// -------------------------------------------------------------------------
function PermDeleteConfirm({ target, onClose, onConfirmed }) {
  const [refs, setRefs] = useState(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setTyped(""); setRefs(null);
    if (!target) return;
    api.get(`/users/${target.id}/references`)
      .then(({ data }) => setRefs(data))
      .catch((e) => toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message));
  }, [target]);

  if (!target) return null;
  const total = refs ? refs.total : null;
  const blocked = total === null || total > 0;
  const emailMatches = typed.trim().toLowerCase() === target.email.toLowerCase();

  const submit = async () => {
    setBusy(true);
    try {
      await api.delete(`/users/${target.id}?permanent=true`);
      toast.success(`${target.email} permanently deleted`);
      onConfirmed?.();
    } catch (e) {
      const d = e.response?.data?.detail;
      if (d && typeof d === "object" && d.references) {
        // server-side refs found that weren't in the prefetch — show them
        setRefs({ user_id: target.id, email: target.email, name: target.name, references: d.references, total: Object.values(d.references).reduce((a,b)=>a+b,0) });
        toast.error("Cannot permanently delete — historical references exist");
      } else {
        toast.error(formatApiErrorDetail(d) || e.message);
      }
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={!!target} onOpenChange={(v) => { if (!v) onClose?.(); }}>
      <DialogContent data-testid="perm-delete-confirm-dialog" className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-red-900 inline-flex items-center gap-2">
            <AppIcon name="warning" size={16} decorative/> Permanently delete user — irreversible
          </DialogTitle>
          <DialogDescription className="pt-2 text-sm text-gray-700">
            This permanently removes <strong>{target.name}</strong> ({target.email}) from the database.
            This action <strong>cannot</strong> be undone.
          </DialogDescription>
        </DialogHeader>

        {refs === null ? (
          <div className="flex items-center gap-2 text-sm text-gray-500 py-3"><Loader2 className="w-4 h-4 animate-spin"/> Counting references…</div>
        ) : total > 0 ? (
          <div className="bg-red-50 border border-red-200 rounded p-3 text-sm" data-testid="perm-delete-refs">
            <div className="font-bold text-red-800 mb-2">Cannot permanently delete — historical references exist:</div>
            <ul className="text-xs text-red-900 space-y-0.5">
              {Object.entries(refs.references).map(([k, v]) => v > 0 && (
                <li key={k}><code className="bg-red-100 px-1 rounded">{k}</code>: {v}</li>
              ))}
            </ul>
            <div className="mt-2 text-xs text-red-700">Use soft delete instead — it preserves history.</div>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="text-xs text-gray-600">No references found. Type <code className="bg-gray-100 px-1.5 py-0.5 rounded font-mono">{target.email}</code> to confirm:</div>
            <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={target.email}
              data-testid="perm-delete-email-input" autoComplete="off"/>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} data-testid="perm-delete-cancel">Cancel</Button>
          <Button onClick={submit} disabled={busy || blocked || !emailMatches}
            className="bg-red-900 text-white hover:bg-red-800 disabled:opacity-40"
            data-testid="perm-delete-confirm">
            {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin"/> : <AppIcon name="hard_deleted" size={16} className="mr-2" decorative/>} Permanently delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// -------------------------------------------------------------------------
// Restore confirmation
// -------------------------------------------------------------------------
function RestoreConfirm({ target, onClose, onConfirmed }) {
  const [busy, setBusy] = useState(false);
  if (!target) return null;
  const submit = async () => {
    setBusy(true);
    try {
      await api.post(`/users/${target.id}/restore`);
      toast.success(`${target.email} restored`);
      onConfirmed?.();
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message);
    } finally { setBusy(false); }
  };
  return (
    <Dialog open={!!target} onOpenChange={(v) => { if (!v) onClose?.(); }}>
      <DialogContent data-testid="restore-confirm-dialog" className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-[#3A6B8C] inline-flex items-center gap-2">
            <AppIcon name="restore" size={20} decorative/> Restore user?
          </DialogTitle>
          <DialogDescription className="pt-2 text-sm text-gray-700">
            This reactivates <strong>{target.name}</strong> ({target.email}). They will be able to log in again
            with their previous password and the same permissions they had before.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} data-testid="restore-cancel">Cancel</Button>
          <Button onClick={submit} disabled={busy} className="bg-[#3A6B8C] text-white hover:bg-[#1F2A33]" data-testid="restore-confirm">
            {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin"/> : <AppIcon name="restore" size={16} className="mr-2" decorative/>} Restore
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
              <AppIcon name="password_changed" size={12} decorative/> Reset password
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
