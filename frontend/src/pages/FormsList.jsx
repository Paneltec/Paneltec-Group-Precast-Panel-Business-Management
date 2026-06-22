import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { api, tokenStore, API_BASE } from "../lib/api";
import { useAuth } from "../contexts/AuthContext";
import AppIcon from "../components/AppIcon";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "../components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "../components/ui/dialog";
import { toast } from "sonner";

const TYPE_LABEL = {
  pre_pour: "Pre-Pour (9.1.2)",
  post_pour: "Post-Pour (9.1.3)",
  compliance_cert: "Cert of Compliance (9.1.4)",
};
const STATUS_PILL = {
  draft:     "bg-gray-100 text-gray-700",
  completed: "bg-amber-100 text-amber-800",
  signed:    "bg-green-100 text-green-800",
};
const STATUS_ICON = {
  draft: "quote_status_draft",
  completed: "pending",
  signed: "success",
};

export default function FormsList() {
  const { hasPerm } = useAuth();
  const nav = useNavigate();
  const [items, setItems] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [emailModal, setEmailModal] = useState(null);
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showCreate, setShowCreate] = useState(false);

  const load = async () => {
    setItems(null);
    const params = new URLSearchParams();
    if (typeFilter !== "all") params.set("form_type", typeFilter);
    if (statusFilter !== "all") params.set("status", statusFilter);
    const r = await api.get(`/compliance-forms?${params.toString()}`);
    setItems(r.data.items || []);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [typeFilter, statusFilter]);

  return (
    <div className="max-w-7xl" data-testid="forms-list-page">
      <div className="mb-6 flex items-end justify-between gap-3 flex-wrap">
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-[#3A6B8C] font-bold">Quality &amp; compliance</div>
          <h1 className="text-3xl font-black tracking-tighter text-[#1F2A33]">Compliance Forms</h1>
          <p className="text-sm text-gray-500 mt-1">AU precast checklists — pre-pour, post-pour, manufacturer's certificate of compliance.</p>
        </div>
        {hasPerm("forms.create") && (
          <Button onClick={() => setShowCreate(true)} data-testid="new-form-btn"
                  className="bg-[#F5C518] text-[#1F2A33] font-bold hover:bg-[#E0B416]">
            <AppIcon name="add" size={16} className="mr-1" decorative/> New Form
          </Button>
        )}
      </div>

      <div className="flex items-center gap-3 mb-4 flex-wrap" data-testid="forms-filters">
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-56" data-testid="filter-type"><SelectValue placeholder="All types"/></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="pre_pour">Pre-Pour (9.1.2)</SelectItem>
            <SelectItem value="post_pour">Post-Pour (9.1.3)</SelectItem>
            <SelectItem value="compliance_cert">Cert of Compliance (9.1.4)</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-44" data-testid="filter-status"><SelectValue placeholder="All statuses"/></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="signed">Signed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="bg-white border border-gray-200 rounded overflow-hidden">
        {items === null ? (
          <div className="p-12 flex items-center justify-center text-gray-500"><Loader2 className="w-5 h-5 mr-2 animate-spin"/> Loading…</div>
        ) : items.length === 0 ? (
          <div className="p-12 text-center text-sm text-gray-500">No forms match. Click "New Form" to create one.</div>
        ) : (
          <table className="w-full text-sm" data-testid="forms-table">
            <thead className="bg-[#3A6B8C] text-white uppercase text-[10px] tracking-wider">
              <tr>
                <th className="px-2 py-2 w-8"></th>
                <th className="px-3 py-2 text-left">Form #</th>
                <th className="px-3 py-2 text-left">Type</th>
                <th className="px-3 py-2 text-left">Panel ID</th>
                <th className="px-3 py-2 text-left">Project</th>
                <th className="px-3 py-2 text-left">Inspection</th>
                <th className="px-3 py-2 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map(f => (
                <tr key={f.id}
                    className="border-t border-gray-200 hover:bg-amber-50"
                    data-testid={`form-row-${f.id}`}>
                  <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" data-testid={`select-${f.id}`}
                           checked={selected.has(f.id)}
                           onChange={(e) => { const s2 = new Set(selected); e.target.checked ? s2.add(f.id) : s2.delete(f.id); setSelected(s2); }}/>
                  </td>
                  <td className="px-3 py-2 font-mono font-semibold text-[#1F2A33] cursor-pointer" onClick={() => nav(`/forms/${f.id}`)}>{f.form_number}</td>
                  <td className="px-3 py-2 text-xs">{TYPE_LABEL[f.form_type] || f.form_type}</td>
                  <td className="px-3 py-2">{f.panel_id}</td>
                  <td className="px-3 py-2 text-xs text-gray-600">{f.project_name || "—"}</td>
                  <td className="px-3 py-2 text-xs text-gray-600">{f.date_of_inspection || "—"}</td>
                  <td className="px-3 py-2">
                    <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded inline-flex items-center gap-1 ${STATUS_PILL[f.status]}`}>
                      <AppIcon name={STATUS_ICON[f.status]} size={14} decorative/>{f.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>


      {selected.size > 0 && (
        <div className="fixed bottom-0 left-0 right-0 bg-[#1F2A33] text-white p-3 z-40 flex items-center justify-center gap-3 shadow-lg" data-testid="bulk-action-bar">
          <span className="text-sm font-bold">{selected.size} selected</span>
          <Button onClick={async () => {
            const r = await fetch(`${API_BASE}/compliance-forms/batch-pdf`, {
              method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenStore.get()}` },
              body: JSON.stringify({ form_ids: Array.from(selected), mode: "zip" }) });
            if (!r.ok) { toast.error("Download failed"); return; }
            const blob = await r.blob(); const url = URL.createObjectURL(blob);
            const a = document.createElement("a"); a.href = url; a.download = `paneltec_forms_${new Date().toISOString().slice(0,10)}.zip`;
            document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
          }} className="bg-[#F5C518] text-[#1F2A33] hover:bg-[#E0B416]" data-testid="bulk-zip-btn">
            <AppIcon name="download" size={16} className="mr-1" decorative/> Download ZIP
          </Button>
          <Button onClick={async () => {
            const r = await fetch(`${API_BASE}/compliance-forms/batch-pdf`, {
              method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenStore.get()}` },
              body: JSON.stringify({ form_ids: Array.from(selected), mode: "combined" }) });
            if (!r.ok) { toast.error("Download failed"); return; }
            const blob = await r.blob(); const url = URL.createObjectURL(blob);
            const a = document.createElement("a"); a.href = url; a.download = `paneltec_forms_${new Date().toISOString().slice(0,10)}.pdf`;
            document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
          }} variant="outline" className="bg-white text-[#1F2A33]" data-testid="bulk-combined-btn">
            <AppIcon name="quotes" size={16} className="mr-1" decorative/> Combined PDF
          </Button>
          <Button onClick={() => setEmailModal({ ids: Array.from(selected) })} variant="outline" className="bg-white text-[#1F2A33]" data-testid="bulk-email-btn">
            <AppIcon name="email" size={16} className="mr-1" decorative/> Email selected
          </Button>
          <Button onClick={() => setSelected(new Set())} variant="ghost" className="text-white hover:bg-white/10" data-testid="bulk-clear-btn">Clear</Button>
        </div>
      )}

      {emailModal && (
        <Dialog open={true} onOpenChange={() => setEmailModal(null)}>
          <DialogContent data-testid="batch-email-modal">
            <DialogHeader>
              <DialogTitle><AppIcon name="email" size={20} decorative className="inline mr-1"/> Email {emailModal.ids.length} forms</DialogTitle>
              <DialogDescription>MOCKED Microsoft 365 — composed message preview only.</DialogDescription>
            </DialogHeader>
            <BatchEmailFields ids={emailModal.ids} onClose={() => { setEmailModal(null); setSelected(new Set()); }}/>
          </DialogContent>
        </Dialog>
      )}

      {showCreate && <CreateFormDialog open={showCreate} onClose={() => setShowCreate(false)} onCreated={(id) => { setShowCreate(false); nav(`/forms/${id}`); }}/>}
    </div>
  );
}

function CreateFormDialog({ open, onClose, onCreated }) {
  const [formType, setFormType] = useState("pre_pour");
  const [panelId, setPanelId] = useState("");
  const [jobId, setJobId] = useState("none");
  const [jobs, setJobs] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get("/jobs?page_size=200").then(r => setJobs(r.data.items || [])).catch(() => setJobs([]));
  }, []);

  const submit = async () => {
    if (!panelId.trim()) { toast.error("Panel ID is required"); return; }
    setBusy(true);
    try {
      const r = await api.post("/compliance-forms", {
        form_type: formType,
        panel_id: panelId.trim(),
        job_id: jobId === "none" ? null : jobId,
      });
      toast.success(`Created ${r.data.form_number}`);
      onCreated(r.data.id);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to create");
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent data-testid="create-form-dialog">
        <DialogHeader>
          <DialogTitle className="inline-flex items-center gap-2">
            <AppIcon name="compliance_forms" size={22} decorative/> New Compliance Form
          </DialogTitle>
          <DialogDescription>Pick a form type and panel; we'll create a draft you can fill in.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label className="text-[10px] uppercase tracking-wider font-bold text-gray-500">Form type</Label>
            <Select value={formType} onValueChange={setFormType}>
              <SelectTrigger className="mt-1" data-testid="create-form-type"><SelectValue/></SelectTrigger>
              <SelectContent>
                <SelectItem value="pre_pour">Pre-Pour Checklist (9.1.2)</SelectItem>
                <SelectItem value="post_pour">Post-Pour Checklist (9.1.3)</SelectItem>
                <SelectItem value="compliance_cert">Manufacturer's Certificate of Compliance (9.1.4)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[10px] uppercase tracking-wider font-bold text-gray-500">Panel ID</Label>
            <Input value={panelId} onChange={(e) => setPanelId(e.target.value)} placeholder="e.g. P-014"
                   className="mt-1" data-testid="create-panel-id" maxLength={80}/>
          </div>
          <div>
            <Label className="text-[10px] uppercase tracking-wider font-bold text-gray-500">Link to job (optional)</Label>
            <Select value={jobId} onValueChange={setJobId}>
              <SelectTrigger className="mt-1" data-testid="create-job"><SelectValue placeholder="No job"/></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— No job —</SelectItem>
                {jobs.map(j => (
                  <SelectItem key={j.id} value={j.id}>{j.job_number} {j.project_name ? `(${j.project_name})` : ""}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy} className="bg-[#F5C518] text-[#1F2A33] font-bold hover:bg-[#E0B416]" data-testid="create-form-submit">
            {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin"/> : null}
            Create draft
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BatchEmailFields({ ids, onClose }) {
  const [recipient, setRecipient] = useState("");
  const [subject, setSubject] = useState(`Paneltec compliance forms (${ids.length})`);
  const [body, setBody] = useState("");
  const [pdfMode, setPdfMode] = useState("zip");
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const send = async () => {
    if (!recipient.trim()) { toast.error("Recipient required"); return; }
    setBusy(true);
    try {
      const r = await api.post("/compliance-forms/batch-email", {
        form_ids: ids, recipient, subject, body, pdf_mode: pdfMode
      });
      setPreview(r.data.preview);
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
    finally { setBusy(false); }
  };
  if (preview) {
    return (
      <div className="space-y-2 text-xs" data-testid="batch-email-preview">
        <div className="bg-amber-50 border border-amber-300 rounded p-2 text-amber-900">📋 MOCKED — copy below and send manually until M365 integration is wired</div>
        <div><strong>To:</strong> {preview.to}</div>
        <div><strong>Subject:</strong> {preview.subject}</div>
        <div><strong>Attachments:</strong> {preview.attachments.join(", ")}</div>
        <pre className="bg-gray-50 p-3 rounded whitespace-pre-wrap text-[11px]">{preview.body}</pre>
        <Button onClick={onClose} className="bg-[#1F2A33] text-white hover:bg-[#3A6B8C] w-full">Mark as sent &amp; close</Button>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <Input placeholder="Recipient email" value={recipient} onChange={(e) => setRecipient(e.target.value)} data-testid="batch-email-recipient"/>
      <Input placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)}/>
      <textarea className="w-full border border-gray-300 rounded p-2 text-xs" rows={3} placeholder="Optional body" value={body} onChange={(e) => setBody(e.target.value)}/>
      <div className="flex items-center gap-3 text-xs">
        <label><input type="radio" checked={pdfMode==="zip"} onChange={() => setPdfMode("zip")}/> ZIP of individual PDFs</label>
        <label><input type="radio" checked={pdfMode==="combined"} onChange={() => setPdfMode("combined")}/> One combined PDF</label>
      </div>
      <Button onClick={send} disabled={busy} className="bg-[#F5C518] text-[#1F2A33] font-bold hover:bg-[#E0B416] w-full" data-testid="batch-email-send">
        {busy ? "Composing…" : "Compose email"}
      </Button>
    </div>
  );
}
