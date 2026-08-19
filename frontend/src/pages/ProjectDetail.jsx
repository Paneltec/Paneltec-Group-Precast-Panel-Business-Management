import { useEffect, useState, useCallback } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { Loader2, ArrowLeft } from "lucide-react";
import AppIcon from "../components/AppIcon";
import { api, formatApiErrorDetail } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "../components/ui/dialog";
import { Toaster, toast } from "sonner";
import { formatAUD, formatDateTime } from "../lib/format";
import { openPdf } from "../lib/print";
import { useAuth } from "../contexts/AuthContext";

const STATUSES = ["planning", "quoted", "won", "lost", "completed"];
const STATUS_STYLES = {
  planning:  "bg-[#EEF3F8] text-[#3A6B8C] border-[#cfdcea]",
  quoted:    "bg-[#FFF4CC] text-[#7a5b00] border-[#F5C518]",
  won:       "bg-[#E4F2E4] text-[#1F5F1F] border-[#B7D9B7]",
  lost:      "bg-[#FDECEC] text-[#7a1a1a] border-[#f2b5b5]",
  completed: "bg-[#F1F3F5] text-[#4b5563] border-[#d1d5db]",
};

function StatusPill({ status }) {
  const s = (status || "planning").toLowerCase();
  const cls = STATUS_STYLES[s] || STATUS_STYLES.planning;
  return (
    <span data-testid="project-status-pill"
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${cls}`}>
      {s}
    </span>
  );
}

function SectionCard({ title, count, children, testid }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden" data-testid={testid}>
      <div className="bg-[#F5C518] px-4 py-2 flex items-center justify-between">
        <h2 className="text-[11px] font-black uppercase tracking-[0.14em] text-[#1F2A33]">{title}</h2>
        {typeof count === "number" && (
          <span className="text-[10px] font-bold text-[#1F2A33]/70 tabular-nums">{count} record{count === 1 ? "" : "s"}</span>
        )}
      </div>
      <div className="p-0">{children}</div>
    </div>
  );
}

function RelatedTable({ rows, cols, empty, rowLink }) {
  const navigate = useNavigate();
  if (!rows.length) {
    return <div className="p-6 text-center text-xs italic text-gray-400">{empty}</div>;
  }
  return (
    <table className="w-full text-xs">
      <thead className="bg-[#1F2A33] text-white uppercase text-[9px] tracking-wider">
        <tr>{cols.map(c => (
          <th key={c.h} className={`px-3 py-2 ${c.right ? "text-right" : "text-left"}`}>{c.h}</th>
        ))}</tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={r.id || i}
            onClick={rowLink ? () => navigate(rowLink(r)) : undefined}
            className={`border-b border-gray-100 ${rowLink ? "cursor-pointer hover:bg-[#F5F6F7]" : ""}`}>
            {cols.map(c => {
              const v = c.get ? c.get(r) : r[c.k];
              const disp = v == null || v === "" ? "—" : c.money ? formatAUD(v) : String(v);
              return (
                <td key={c.h}
                  className={`px-3 py-2 ${c.right ? "text-right" : ""} ${c.mono ? "tabular-nums font-mono" : ""} ${c.upper ? "uppercase text-[10px] tracking-wider" : ""}`}>
                  {disp}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function ProjectDetail() {
  const { id } = useParams();
  const { hasPerm } = useAuth();
  const [project, setProject] = useState(null);
  const [customer, setCustomer] = useState(null);
  const [quotes, setQuotes] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [forms, setForms] = useState([]);
  const [error, setError] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const load = useCallback(async () => {
    setError("");
    try {
      const { data: p } = await api.get(`/projects/${id}`);
      setProject(p);
      const cust = p.customer_id
        ? api.get(`/customers/${p.customer_id}`).then(r => r.data).catch(() => null)
        : Promise.resolve(null);
      const qs = api.get(`/quotes`, { params: { customer_id: p.customer_id, page_size: 200 } })
        .then(r => (r.data.items || []).filter(q => q.project_id === id));
      const js = api.get(`/jobs`, { params: { customer_id: p.customer_id, page_size: 200 } })
        .then(r => (r.data.items || []).filter(j => j.project_id === id));
      const is = api.get(`/invoices`, { params: { customer_id: p.customer_id, page_size: 200 } })
        .then(r => (r.data.items || []).filter(inv => inv.project_id === id));
      const fs = hasPerm("forms.view")
        ? api.get(`/compliance-forms`).then(r => (r.data.items || []).filter(f => f.project_id === id))
        : Promise.resolve([]);
      const [c, q, j, iv, f] = await Promise.all([cust, qs, js, is, fs]);
      setCustomer(c); setQuotes(q); setJobs(j); setInvoices(iv); setForms(f);
    } catch (e) {
      setError(formatApiErrorDetail(e.response?.data?.detail) || e.message);
    }
  }, [id, hasPerm]);

  useEffect(() => { load(); }, [load]);

  const onDownloadPdf = async () => {
    setDownloading(true);
    try {
      toast.loading("Opening PDF…", { id: "proj-pdf" });
      const r = await openPdf(`/projects/${id}/pdf`, `paneltec_project_${id}.pdf`);
      if (r?.blocked) toast.error("Popup blocked — PDF downloaded instead. Allow popups from this site to view inline.", { id: "proj-pdf" });
      else toast.success("Project PDF opened", { id: "proj-pdf" });
    } catch (err) {
      toast.error(formatApiErrorDetail(err.response?.data?.detail) || "Failed to generate PDF",
        { id: "proj-pdf" });
    } finally {
      setDownloading(false);
    }
  };

  if (error) {
    return (
      <div className="max-w-3xl">
        <Toaster richColors position="top-right" />
        <Link to="/customers" className="inline-flex items-center text-xs uppercase tracking-wider text-[#3A6B8C] font-bold mb-2 hover:text-[#1F2A33]"><ArrowLeft className="w-3 h-3 mr-1"/> Back</Link>
        <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded text-sm">{error}</div>
      </div>
    );
  }

  if (!project) {
    return <div className="flex items-center gap-2 text-gray-500 text-sm"><Loader2 className="w-4 h-4 animate-spin"/> Loading project…</div>;
  }

  return (
    <div className="max-w-6xl space-y-6" data-testid="project-detail-page">
      <Toaster richColors position="top-right" />
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <Link to={customer ? `/customers/${customer.id}` : "/customers"} className="inline-flex items-center text-xs uppercase tracking-wider text-[#3A6B8C] font-bold mb-2 hover:text-[#1F2A33]">
            <ArrowLeft className="w-3 h-3 mr-1"/> {customer ? `Back to ${customer.company_name}` : "Back to customers"}
          </Link>
          <h1 className="text-3xl md:text-4xl font-black tracking-tighter text-[#1F2A33]" data-testid="project-name">
            {project.project_name}
          </h1>
          <div className="flex flex-wrap items-center gap-2 mt-2 text-xs text-gray-600">
            <StatusPill status={project.status}/>
            {project.code && <span className="tabular-nums font-mono">Code {project.code}</span>}
            {project.location && <span>· {project.location}</span>}
            <span className="text-gray-400">· Updated {formatDateTime(project.updated_at)}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline"
            onClick={onDownloadPdf}
            disabled={downloading}
            className="border-[#3A6B8C] text-[#3A6B8C] font-semibold"
            data-testid="project-print-pdf-btn">
            <AppIcon name="print" size={18} className="mr-2" decorative/>
            {downloading ? "Generating…" : "Print to PDF"}
          </Button>
          {hasPerm("projects.edit") && (
            <Button variant="outline"
              onClick={() => setEditOpen(true)}
              className="border-[#1F2A33] text-[#1F2A33] font-semibold"
              data-testid="project-edit-btn">
              <AppIcon name="edit" size={18} className="mr-2" decorative/> Edit
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-span-2 bg-white border border-gray-200 rounded-lg p-5" data-testid="project-overview-card">
          <div className="text-[10px] uppercase tracking-[0.14em] font-bold text-[#3A6B8C] mb-3">Overview</div>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <div>
              <dt className="text-[10px] uppercase tracking-wider text-gray-500 font-bold">Project name</dt>
              <dd className="text-[#1F2A33]">{project.project_name}</dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-wider text-gray-500 font-bold">Code</dt>
              <dd className="tabular-nums font-mono text-[#1F2A33]">{project.code || "—"}</dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-wider text-gray-500 font-bold">Location</dt>
              <dd className="text-[#1F2A33]">{project.location || "—"}</dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-wider text-gray-500 font-bold">Status</dt>
              <dd><StatusPill status={project.status}/></dd>
            </div>
            {project.site_address?.street && (
              <div className="col-span-2">
                <dt className="text-[10px] uppercase tracking-wider text-gray-500 font-bold">Site address</dt>
                <dd className="text-[#1F2A33] text-xs">
                  {project.site_address.street}<br/>
                  {project.site_address.suburb} {project.site_address.state} {project.site_address.postcode}
                </dd>
              </div>
            )}
            {(project.notes || project.description) && (
              <div className="col-span-2">
                <dt className="text-[10px] uppercase tracking-wider text-gray-500 font-bold">Notes</dt>
                <dd className="text-xs text-gray-700 whitespace-pre-wrap bg-[#FFFBEA] border-l-2 border-[#F5C518] p-2 rounded-sm">{project.notes || project.description}</dd>
              </div>
            )}
          </dl>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-5" data-testid="project-customer-card">
          <div className="text-[10px] uppercase tracking-[0.14em] font-bold text-[#3A6B8C] mb-3">Customer</div>
          {customer ? (
            <div className="space-y-1 text-sm">
              <Link to={`/customers/${customer.id}`} className="text-[#1F2A33] font-bold hover:text-[#3A6B8C] block">
                {customer.company_name}
              </Link>
              {customer.abn && <div className="text-xs text-gray-500 tabular-nums">ABN {customer.abn}</div>}
              <div className="text-xs text-gray-600 pt-2 border-t border-gray-100 mt-2">
                <div className="font-semibold text-[#1F2A33]">{customer.contact_name || "—"}</div>
                <div>{customer.contact_email || "—"}</div>
                <div>{customer.contact_phone || "—"}</div>
              </div>
            </div>
          ) : (
            <div className="text-xs text-gray-400 italic">No customer linked.</div>
          )}
        </div>
      </div>

      <SectionCard title="Quotes" count={quotes.length} testid="project-quotes-section">
        <RelatedTable
          rows={quotes}
          empty="No quotes on this project."
          rowLink={r => `/quotes/${r.id}`}
          cols={[
            { h: "Quote #", k: "quote_number", mono: true },
            { h: "Date", get: r => (r.created_at || "").slice(0, 10), mono: true },
            { h: "Status", k: "status", upper: true },
            { h: "Total inc GST", k: "total", money: true, right: true },
          ]}
        />
      </SectionCard>

      <SectionCard title="Jobs" count={jobs.length} testid="project-jobs-section">
        <RelatedTable
          rows={jobs}
          empty="No jobs on this project."
          rowLink={r => `/jobs/${r.id}`}
          cols={[
            { h: "Job #", k: "job_number", mono: true },
            { h: "Date", get: r => (r.created_from_quote_at || r.created_at || "").slice(0, 10), mono: true },
            { h: "Status", k: "status", upper: true },
          ]}
        />
      </SectionCard>

      <SectionCard title="Invoices" count={invoices.length} testid="project-invoices-section">
        <RelatedTable
          rows={invoices}
          empty="No invoices on this project."
          rowLink={r => `/invoices/${r.id}`}
          cols={[
            { h: "Invoice #", k: "invoice_number", mono: true },
            { h: "Date", get: r => (r.issue_date || r.created_at || "").slice(0, 10), mono: true },
            { h: "Status", k: "status", upper: true },
            { h: "Total inc GST", k: "total", money: true, right: true },
          ]}
        />
      </SectionCard>

      {hasPerm("forms.view") && (
        <SectionCard title="Compliance forms" count={forms.length} testid="project-forms-section">
          <RelatedTable
            rows={forms}
            empty="No compliance forms on this project."
            rowLink={r => `/forms/${r.id}`}
            cols={[
              { h: "Form #", k: "form_number", mono: true },
              { h: "Type", get: r => (r.form_type || "").replace(/_/g, " ") },
              { h: "Panel ID", k: "panel_id", mono: true },
              { h: "Status", k: "status", upper: true },
            ]}
          />
        </SectionCard>
      )}

      <ProjectEditDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        project={project}
        onSaved={(p) => { setProject(p); setEditOpen(false); toast.success("Project saved"); }}
      />
    </div>
  );
}

function ProjectEditDialog({ open, onOpenChange, project, onSaved }) {
  const [form, setForm] = useState(() => ({
    project_name: project.project_name || "",
    code: project.code || "",
    location: project.location || "",
    status: project.status || "planning",
    notes: project.notes || "",
  }));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setForm({
        project_name: project.project_name || "",
        code: project.code || "",
        location: project.location || "",
        status: project.status || "planning",
        notes: project.notes || "",
      });
    }
  }, [open, project]);

  const onSave = async () => {
    if (!form.project_name.trim()) { toast.error("Project name is required"); return; }
    setSaving(true);
    try {
      const { data } = await api.patch(`/projects/${project.id}`, form);
      onSaved(data);
    } catch (err) {
      toast.error(formatApiErrorDetail(err.response?.data?.detail) || err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="project-edit-dialog">
        <DialogHeader>
          <DialogTitle>Edit project</DialogTitle>
          <DialogDescription>Update project details. Changes are audit-logged.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="text-[10px] uppercase tracking-wider text-gray-500 font-bold">Project name</Label>
            <Input value={form.project_name}
              onChange={e => setForm({ ...form, project_name: e.target.value })}
              className="h-11" data-testid="project-edit-name"/>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-[10px] uppercase tracking-wider text-gray-500 font-bold">Code</Label>
              <Input value={form.code}
                onChange={e => setForm({ ...form, code: e.target.value })}
                className="h-11 tabular-nums" data-testid="project-edit-code"/>
            </div>
            <div>
              <Label className="text-[10px] uppercase tracking-wider text-gray-500 font-bold">Status</Label>
              <Select value={form.status} onValueChange={v => setForm({ ...form, status: v })}>
                <SelectTrigger className="h-11" data-testid="project-edit-status"><SelectValue/></SelectTrigger>
                <SelectContent>{STATUSES.map(s => (
                  <SelectItem key={s} value={s} className="uppercase text-xs">{s}</SelectItem>
                ))}</SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label className="text-[10px] uppercase tracking-wider text-gray-500 font-bold">Location</Label>
            <Input value={form.location}
              onChange={e => setForm({ ...form, location: e.target.value })}
              className="h-11" data-testid="project-edit-location"/>
          </div>
          <div>
            <Label className="text-[10px] uppercase tracking-wider text-gray-500 font-bold">Notes</Label>
            <Textarea value={form.notes}
              onChange={e => setForm({ ...form, notes: e.target.value })}
              rows={4} data-testid="project-edit-notes"/>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="project-edit-cancel">Cancel</Button>
          <Button onClick={onSave} disabled={saving}
            className="bg-[#1F2A33] text-white hover:bg-[#2b3946]"
            data-testid="project-edit-save">
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
