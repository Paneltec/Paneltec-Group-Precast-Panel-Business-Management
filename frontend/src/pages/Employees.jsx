import { useEffect, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { Loader2, Plus, ArrowLeft, Save, Trash2 } from "lucide-react";
import { api, formatApiErrorDetail } from "../lib/api";
import { useAuth } from "../contexts/AuthContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import { Toaster, toast } from "sonner";

const SOURCE_BADGE = {
  MANUAL: "bg-gray-100 text-gray-700",
  MOCKED_SIMPRO: "bg-yellow-100 text-yellow-800",
  SIMPRO: "bg-green-100 text-green-800",
};

export function EmployeesList() {
  const { hasPerm } = useAuth();
  const [items, setItems] = useState(null);
  const [statusFilter, setStatusFilter] = useState("active");
  const navigate = useNavigate();
  const load = async () => {
    setItems(null);
    try { const { data } = await api.get(`/employees?status=${statusFilter}`); setItems(data); }
    catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [statusFilter]);

  return (
    <div className="space-y-5" data-testid="employees-page">
      <Toaster richColors position="top-right"/>
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <div className="overline">Crew</div>
          <h1 className="text-3xl md:text-4xl font-black tracking-tighter text-[#1F2A33]">Employees</h1>
          <p className="text-sm text-gray-500 mt-1">Manual roster. Live Simpro sync coming in Phase 4 Part 2.</p>
        </div>
        {hasPerm("employees.create") && (
          <Button onClick={() => navigate("/employees/new")} className="bg-[#F5C518] text-[#1F2A33] font-bold hover:bg-[#E0B416] h-11" data-testid="new-employee-btn">
            <Plus className="w-4 h-4 mr-2"/> New Employee
          </Button>
        )}
      </div>
      <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 text-xs px-4 py-2 rounded">
        Currently MANUAL. Will sync from Simpro in Phase 4 Part 2.
      </div>
      <div className="inline-flex rounded border border-gray-200 bg-white p-0.5 text-xs">
        {[["active","Active"],["inactive","Inactive"],["deleted","Deleted"],["all","All"]].map(([k,l])=>(
          <button key={k} onClick={() => setStatusFilter(k)} data-testid={`emp-filter-${k}`}
            className={`px-3 py-1.5 rounded font-semibold ${statusFilter===k ? "bg-[#1F2A33] text-white" : "text-gray-600 hover:bg-gray-50"}`}>{l}</button>
        ))}
      </div>
      <div className="bg-white border border-gray-200 rounded overflow-hidden">
        {items === null ? <div className="p-6 text-sm text-gray-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin"/> Loading…</div>
         : items.length === 0 ? <div className="p-6 text-sm text-gray-500">No employees in this view.</div>
         : (
        <table className="w-full text-sm">
          <thead className="bg-[#3A6B8C] text-white uppercase text-[10px] tracking-wider">
            <tr><th className="px-4 py-3 text-left">Name</th><th className="px-4 py-3 text-left">Role</th>
            <th className="px-4 py-3 text-left">Email</th><th className="px-4 py-3 text-left">Phone</th>
            <th className="px-4 py-3 text-left">Source</th></tr>
          </thead>
          <tbody>{items.map(e => (
            <tr key={e.id} onClick={() => navigate(`/employees/${e.id}`)}
              className={`border-t border-gray-200 hover:bg-gray-50 cursor-pointer ${e.deleted_at ? "opacity-60" : ""}`}
              data-testid={`employee-row-${e.id}`}>
              <td className="px-4 py-3 font-semibold text-[#1F2A33]">{e.name}{e.deleted_at && <span className="ml-2 text-[10px] text-red-700 italic">(deleted)</span>}</td>
              <td className="px-4 py-3 text-gray-600">{e.role || "—"}</td>
              <td className="px-4 py-3 text-gray-600 text-xs">{e.email || "—"}</td>
              <td className="px-4 py-3 text-gray-600 text-xs">{e.phone || "—"}</td>
              <td className="px-4 py-3"><span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${SOURCE_BADGE[e.source]||"bg-gray-100"}`}>{e.source}</span></td>
            </tr>))}
          </tbody>
        </table>)}
      </div>
    </div>
  );
}

export function EmployeeForm() {
  const { id } = useParams();
  const isNew = !id || id === "new";
  const navigate = useNavigate();
  const { hasPerm } = useAuth();
  const [form, setForm] = useState({ name:"", role:"", email:"", phone:"", notes:"" });
  const [loading, setLoading] = useState(!isNew);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (isNew) return;
    api.get(`/employees/${id}`).then(({ data }) => { setForm(data); setLoading(false); })
      .catch(e => { toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message); setLoading(false); });
  }, [id, isNew]);

  const save = async (e) => {
    e.preventDefault(); setBusy(true);
    try {
      const payload = { name:form.name, role:form.role, email:form.email, phone:form.phone, notes:form.notes };
      if (isNew) await api.post("/employees", payload);
      else await api.patch(`/employees/${id}`, payload);
      toast.success(isNew ? "Employee created" : "Employee updated");
      navigate("/employees");
    } catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!window.confirm(`Delete ${form.name}? You can restore from the Deleted filter.`)) return;
    try { await api.delete(`/employees/${id}`); toast.success("Employee deleted"); navigate("/employees"); }
    catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message); }
  };

  if (loading) return <div className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="w-4 h-4 animate-spin"/> Loading…</div>;
  return (
    <div className="max-w-2xl space-y-5" data-testid="employee-form-page">
      <Toaster richColors position="top-right"/>
      <Link to="/employees" className="text-xs uppercase tracking-wider text-[#3A6B8C] hover:text-[#1F2A33] inline-flex items-center gap-1"><ArrowLeft className="w-3 h-3"/> Back to employees</Link>
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="overline">{isNew ? "New" : "Edit"}</div>
          <h1 className="text-3xl font-black tracking-tighter text-[#1F2A33]">{isNew ? "Create employee" : form.name}</h1>
        </div>
        {!isNew && hasPerm("employees.delete") && !form.deleted_at && (
          <Button variant="outline" onClick={remove} className="border-red-300 text-red-700 hover:bg-red-50" data-testid="employee-delete-btn">
            <Trash2 className="w-4 h-4 mr-2"/> Delete
          </Button>
        )}
      </div>
      <form onSubmit={save} className="space-y-3 bg-white border border-gray-200 rounded p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div><Label>Name</Label><Input value={form.name} required onChange={(e)=>setForm({...form, name:e.target.value})} data-testid="emp-name"/></div>
          <div><Label>Role (e.g. Foreman, Driver)</Label><Input value={form.role} onChange={(e)=>setForm({...form, role:e.target.value})} data-testid="emp-role"/></div>
          <div><Label>Email</Label><Input type="email" value={form.email} onChange={(e)=>setForm({...form, email:e.target.value})} data-testid="emp-email"/></div>
          <div><Label>Phone</Label><Input value={form.phone} onChange={(e)=>setForm({...form, phone:e.target.value})} data-testid="emp-phone"/></div>
        </div>
        <div><Label>Notes</Label><Textarea value={form.notes} onChange={(e)=>setForm({...form, notes:e.target.value})} data-testid="emp-notes"/></div>
        <div className="flex justify-end gap-2">
          {!isNew && <span className="text-xs text-gray-500 mr-auto">Source: <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${SOURCE_BADGE[form.source]||"bg-gray-100"}`}>{form.source}</span></span>}
          <Button type="submit" disabled={busy} className="bg-[#F5C518] text-[#1F2A33] font-bold hover:bg-[#E0B416]" data-testid="emp-save">
            {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin"/> : <Save className="w-4 h-4 mr-2"/>} {isNew ? "Create" : "Save"}
          </Button>
        </div>
      </form>
    </div>
  );
}

export default EmployeesList;
