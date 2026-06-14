import { useEffect, useState } from "react";
import { Loader2, Plus, UserPlus } from "lucide-react";
import { api, formatApiErrorDetail } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Switch } from "../components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "../components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { formatDateTime } from "../lib/format";
import { useAuth } from "../contexts/AuthContext";
import { Toaster, toast } from "sonner";

export default function UsersPage() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState(null);
  const [error, setError] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);

  const load = async () => {
    try {
      const { data } = await api.get("/users");
      setUsers(data);
    } catch (e) {
      setError(formatApiErrorDetail(e.response?.data?.detail) || e.message);
    }
  };
  useEffect(() => { load(); }, []);

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
    <div className="max-w-6xl space-y-6" data-testid="users-page">
      <Toaster richColors position="top-right" />
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <div className="overline">Admin</div>
          <h1 className="text-3xl md:text-4xl font-black tracking-tighter text-[#1F2A33]">Users</h1>
          <p className="text-sm text-gray-500 mt-1">Create staff and admin accounts, manage activation.</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button
              data-testid="open-create-user-btn"
              className="bg-[#F5C518] text-[#1F2A33] font-bold hover:bg-[#E0B416] h-11 px-6"
            >
              <UserPlus className="w-4 h-4 mr-2" /> New user
            </Button>
          </DialogTrigger>
          <CreateUserDialog onCreated={() => { setDialogOpen(false); load(); }} />
        </Dialog>
      </div>

      {error && <div className="text-sm text-red-700">{error}</div>}

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
                  <th className="px-4 py-3 text-left">Role</th>
                  <th className="px-4 py-3 text-left">Created</th>
                  <th className="px-4 py-3 text-right">Active</th>
                </tr>
              </thead>
              <tbody data-testid="users-table-body">
                {users.map((u) => (
                  <tr key={u.id} className="border-t border-gray-200 hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-[#1F2A33]">{u.name}</td>
                    <td className="px-4 py-3 text-gray-700">{u.email}</td>
                    <td className="px-4 py-3">
                      <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${
                        u.role === "admin" ? "bg-[#F5C518] text-[#1F2A33]" : "bg-gray-100 text-gray-600"
                      }`}>{u.role}</span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{formatDateTime(u.created_at)}</td>
                    <td className="px-4 py-3 text-right">
                      <Switch
                        checked={u.is_active}
                        onCheckedChange={() => toggleActive(u)}
                        disabled={u.id === me?.id}
                        data-testid={`user-active-${u.email}`}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function CreateUserDialog({ onCreated }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("staff");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const onSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await api.post("/users", { name: name.trim(), email: email.trim().toLowerCase(), password, role });
      toast.success(`User ${email} created`);
      onCreated?.();
    } catch (err) {
      setError(formatApiErrorDetail(err.response?.data?.detail) || err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <DialogContent data-testid="create-user-dialog" className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Create user</DialogTitle>
      </DialogHeader>
      <form onSubmit={onSubmit} className="space-y-3">
        <div>
          <Label className="text-xs uppercase tracking-wider text-[#3A6B8C] font-bold">Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} required data-testid="create-user-name" />
        </div>
        <div>
          <Label className="text-xs uppercase tracking-wider text-[#3A6B8C] font-bold">Email</Label>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required data-testid="create-user-email" />
        </div>
        <div>
          <Label className="text-xs uppercase tracking-wider text-[#3A6B8C] font-bold">Password (min 8)</Label>
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} data-testid="create-user-password" />
        </div>
        <div>
          <Label className="text-xs uppercase tracking-wider text-[#3A6B8C] font-bold">Role</Label>
          <Select value={role} onValueChange={setRole}>
            <SelectTrigger data-testid="create-user-role"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="staff">Staff</SelectItem>
              <SelectItem value="admin">Admin</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {error && <div className="text-sm text-red-700">{error}</div>}
        <DialogFooter>
          <Button type="submit" disabled={submitting} data-testid="create-user-submit"
            className="bg-[#F5C518] text-[#1F2A33] font-bold hover:bg-[#E0B416]">
            {submitting ? "Creating…" : "Create"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
