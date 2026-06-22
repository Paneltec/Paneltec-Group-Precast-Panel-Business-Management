import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../contexts/AuthContext";
import AppIcon from "../components/AppIcon";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "../components/ui/dialog";
import { toast } from "sonner";

export default function TemplatesList() {
  const { hasPerm } = useAuth();
  const nav = useNavigate();
  const [items, setItems] = useState(null);
  const [showCreate, setShowCreate] = useState(false);

  const load = async () => {
    setItems(null);
    const r = await api.get("/compliance-templates");
    setItems(r.data.items || []);
  };
  useEffect(() => { load(); }, []);

  if (!hasPerm("forms.template_manage")) {
    return <div className="p-12 text-center text-sm text-gray-500">forms.template_manage permission required.</div>;
  }

  const clone = async (tid) => {
    if (!window.confirm("Clone this template?")) return;
    try {
      const r = await api.post(`/compliance-templates/${tid}/clone`);
      toast.success(`Cloned as ${r.data.code}`);
      nav(`/forms/templates/${r.data.id}`);
    } catch (e) { toast.error(e.response?.data?.detail || "Clone failed"); }
  };
  const setActive = async (tid, active) => {
    try { await api.post(`/compliance-templates/${tid}/${active ? "activate" : "deactivate"}`); toast.success(active ? "Activated" : "Deactivated"); load(); }
    catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
  };
  const del = async (tid, name) => {
    if (!window.confirm(`Delete template "${name}"?`)) return;
    try { await api.delete(`/compliance-templates/${tid}`); toast.success("Deleted"); load(); }
    catch (e) { toast.error(e.response?.data?.detail || "Delete failed"); }
  };

  return (
    <div className="max-w-7xl" data-testid="templates-list-page">
      <div className="mb-5">
        <div className="manual-section-banner" style={{aspectRatio:"3/2", maxHeight:200, borderRadius:8, overflow:"hidden", background:"#1F2A33", marginBottom:16}}>
          <img src="/manual/sections/template_builder.jpg" alt="" style={{width:"100%", height:"100%", objectFit:"cover", display:"block"}}/>
        </div>
        <div className="flex items-end justify-between gap-3 flex-wrap">
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-[#3A6B8C] font-bold">Compliance · Templates</div>
            <h1 className="text-3xl font-black tracking-tighter text-[#1F2A33]">Form Templates</h1>
            <p className="text-sm text-gray-500 mt-1">Design and version the checklists your team uses on site. System templates are protected — clone to edit.</p>
          </div>
          <Button onClick={() => setShowCreate(true)} className="bg-[#F5C518] text-[#1F2A33] font-bold hover:bg-[#E0B416]" data-testid="new-template-btn">
            <AppIcon name="add" size={16} className="mr-1" decorative/> New template
          </Button>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded overflow-hidden">
        {items === null ? (
          <div className="p-12 flex items-center justify-center text-gray-500"><Loader2 className="w-5 h-5 mr-2 animate-spin"/> Loading…</div>
        ) : items.length === 0 ? (
          <div className="p-12 text-center text-sm text-gray-500">No templates yet.</div>
        ) : (
          <table className="w-full text-sm" data-testid="templates-table">
            <thead className="bg-[#3A6B8C] text-white uppercase text-[10px] tracking-wider">
              <tr>
                <th className="px-3 py-2 text-left">Code</th>
                <th className="px-3 py-2 text-left">Name</th>
                <th className="px-3 py-2 text-left">Category</th>
                <th className="px-3 py-2 text-left">Version</th>
                <th className="px-3 py-2 text-left">Type</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map(t => (
                <tr key={t.id} className="border-t border-gray-200 hover:bg-amber-50" data-testid={`template-row-${t.id}`}>
                  <td className="px-3 py-2 font-mono font-semibold">{t.code}</td>
                  <td className="px-3 py-2"><Link to={`/forms/templates/${t.id}`} className="text-[#3A6B8C] hover:underline">{t.name}</Link></td>
                  <td className="px-3 py-2 text-xs">{t.category}</td>
                  <td className="px-3 py-2 text-xs">v{t.version}</td>
                  <td className="px-3 py-2">
                    {t.is_system
                      ? <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-blue-100 text-blue-800">System</span>
                      : <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-gray-100 text-gray-700">Custom</span>}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${t.active ? "bg-green-100 text-green-800" : "bg-gray-200 text-gray-600"}`}>
                      {t.active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right space-x-1">
                    <Button size="sm" variant="outline" onClick={() => nav(`/forms/templates/${t.id}`)} data-testid={`edit-${t.id}`}>
                      <AppIcon name="edit" size={14} decorative/>
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => clone(t.id)} data-testid={`clone-${t.id}`}>
                      <AppIcon name="copy" size={14} decorative/>
                    </Button>
                    {!t.is_system && (
                      <>
                        <Button size="sm" variant="outline" onClick={() => setActive(t.id, !t.active)} data-testid={`toggle-${t.id}`}>
                          {t.active ? "Deactivate" : "Activate"}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => del(t.id, t.name)} className="text-red-700 border-red-200 hover:bg-red-50" data-testid={`delete-${t.id}`}>
                          <AppIcon name="delete" size={14} decorative/>
                        </Button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showCreate && <CreateTemplate onClose={() => setShowCreate(false)} onCreated={(id) => nav(`/forms/templates/${id}`)}/>}
    </div>
  );
}

function CreateTemplate({ onClose, onCreated }) {
  const [code, setCode] = useState(""); const [name, setName] = useState("");
  const [category, setCategory] = useState("Quality"); const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!/^[A-Z0-9_]{2,40}$/.test(code)) { toast.error("Code must match [A-Z0-9_]{2,40}"); return; }
    if (!name.trim()) { toast.error("Name required"); return; }
    setBusy(true);
    try {
      const r = await api.post("/compliance-templates", { code, name, category, sections: [], header_fields: [] });
      toast.success(`Created ${r.data.code}`); onCreated(r.data.id);
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); } finally { setBusy(false); }
  };
  return (
    <Dialog open={true} onOpenChange={(v) => !v && onClose()}>
      <DialogContent data-testid="create-template-dialog">
        <DialogHeader><DialogTitle>New Form Template</DialogTitle><DialogDescription>Start blank — sections and criteria added in the editor.</DialogDescription></DialogHeader>
        <div className="space-y-3 py-2">
          <div><Label className="text-[10px] uppercase tracking-wider font-bold text-gray-500">Code</Label>
            <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="e.g. FORMWORK_HANDOVER" data-testid="create-tpl-code"/></div>
          <div><Label className="text-[10px] uppercase tracking-wider font-bold text-gray-500">Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} data-testid="create-tpl-name"/></div>
          <div><Label className="text-[10px] uppercase tracking-wider font-bold text-gray-500">Category</Label>
            <Input value={category} onChange={(e) => setCategory(e.target.value)}/></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy} className="bg-[#F5C518] text-[#1F2A33] font-bold hover:bg-[#E0B416]" data-testid="create-tpl-submit">
            {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin"/> : null} Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
