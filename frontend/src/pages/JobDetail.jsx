import { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { Loader2, ArrowLeft, ArrowRight, X, FileText, Save, Printer, Mail } from "lucide-react";
import { api, formatApiErrorDetail } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "../components/ui/dialog";
import { formatAUD, formatDateTime } from "../lib/format";
import { Toaster, toast } from "sonner";
import EmailModal, { LastEmailedLabel } from "../components/EmailModal";
import { useAuth } from "../contexts/AuthContext";
import { openPrintPopup } from "../lib/print";

const ORDER = ["scheduled","in_production","ready_for_delivery","delivered","installed","completed"];
const STATUS_STYLES = {
  scheduled:"bg-gray-100 text-gray-700",in_production:"bg-blue-100 text-blue-800",
  ready_for_delivery:"bg-amber-100 text-amber-800",delivered:"bg-cyan-100 text-cyan-800",
  installed:"bg-violet-100 text-violet-800",completed:"bg-green-100 text-green-800",
  cancelled:"bg-red-100 text-red-700",
};

export default function JobDetail() {
  const { hasPerm } = useAuth();
  const { id } = useParams();
  const navigate = useNavigate();
  const [job, setJob] = useState(null);
  const [customer, setCustomer] = useState(null);
  const [vehicles, setVehicles] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [invoice, setInvoice] = useState(null);
  const [error, setError] = useState("");
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [genOpen, setGenOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);

  const load = async () => {
    try {
      const { data } = await api.get(`/jobs/${id}`);
      setJob(data);
      const [{ data: c }, { data: v }, { data: e }] = await Promise.all([
        api.get(`/customers/${data.customer_id}`),
        api.get("/vehicles"),
        api.get("/employees"),
      ]);
      setCustomer(c); setVehicles(Array.isArray(v) ? v : (v?.items ?? [])); setEmployees(Array.isArray(e) ? e : (e?.items ?? []));
      // Find invoice for this job
      try {
        const { data: inv } = await api.get("/invoices", { params: { customer_id: data.customer_id, page_size: 100 } });
        setInvoice(inv.items.find(i => i.job_id === id) || null);
      } catch {}
    } catch (e) { setError(formatApiErrorDetail(e.response?.data?.detail) || e.message); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  const patch = async (updates) => {
    try {
      const { data } = await api.patch(`/jobs/${id}`, updates);
      setJob(data);
      toast.success("Saved");
    } catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message); }
  };

  const advance = async () => {
    const idx = ORDER.indexOf(job.status);
    if (idx < 0 || idx >= ORDER.length - 1) return;
    const to = ORDER[idx + 1];
    try {
      const { data } = await api.post(`/jobs/${id}/transition`, { to, note: `Advanced to ${to}` });
      setJob(data);
      toast.success(`Job moved to ${to.replace(/_/g," ")}`);
    } catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message); }
  };

  const doCancel = async () => {
    try {
      const { data } = await api.post(`/jobs/${id}/cancel`, { reason: cancelReason });
      setJob(data); setCancelOpen(false); setCancelReason("");
      toast.success("Job cancelled");
    } catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message); }
  };

  const generateInvoice = async () => {
    try {
      const { data } = await api.post("/invoices", { job_id: id });
      toast.success(`Invoice ${data.invoice_number} created`);
      navigate(`/invoices/${data.id}`);
    } catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message); }
  };

  if (error) return <div className="text-sm text-red-700">{error}</div>;
  if (!job || !customer) return <div className="flex items-center gap-2 text-gray-500 text-sm"><Loader2 className="w-4 h-4 animate-spin"/> Loading…</div>;

  const canAdvance = job.status !== "cancelled" && job.status !== "completed";
  const canInvoice = ["delivered","installed","completed"].includes(job.status) && !invoice;
  const idx = ORDER.indexOf(job.status);

  return (
    <div className="max-w-6xl space-y-6" data-testid="job-detail-page">
      <Toaster richColors position="top-right"/>
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div>
          <Link to="/jobs" className="inline-flex items-center text-xs uppercase tracking-wider text-[#3A6B8C] font-bold mb-2 hover:text-[#1F2A33]"><ArrowLeft className="w-3 h-3 mr-1"/> Back to jobs</Link>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-3xl md:text-4xl font-black tracking-tighter text-[#1F2A33] tabular-nums">{job.job_number}</h1>
            <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded ${STATUS_STYLES[job.status]}`} data-testid="job-status">{job.status.replace(/_/g," ")}</span>
          </div>
          <p className="text-sm text-gray-500 mt-1">
            <Link to={`/customers/${customer.id}`} className="font-semibold text-[#3A6B8C] hover:text-[#1F2A33]">{customer.company_name}</Link>
            {" · "}
            <Link to={`/quotes/${job.quote_id}`} className="text-[#3A6B8C] hover:text-[#1F2A33]">Quote {job.quote_number}</Link>
            {invoice && <> · <Link to={`/invoices/${invoice.id}`} className="text-[#3A6B8C] hover:text-[#1F2A33]">Invoice {invoice.invoice_number}</Link></>}
          </p>
          <LastEmailedLabel at={job.last_email_sent_at} subject={job.last_email_subject}/>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => openPrintPopup(`/jobs/${id}/print`)} className="border-[#1F2A33] text-[#1F2A33] font-semibold h-10" data-testid="job-print-btn">
            <Printer className="w-4 h-4 mr-2"/> Print
          </Button>
          <Button variant="outline" onClick={() => setEmailOpen(true)} className="border-[#3A6B8C] text-[#3A6B8C] font-semibold h-10" data-testid="job-email-btn">
            <Mail className="w-4 h-4 mr-2"/> Email
          </Button>
          {canAdvance && hasPerm("jobs.transition") && (
            <Button onClick={advance} className="bg-[#3A6B8C] text-white hover:bg-[#2C526B] h-10" data-testid="job-advance-btn">
              Advance to {ORDER[idx + 1]?.replace(/_/g," ")} <ArrowRight className="w-4 h-4 ml-2"/>
            </Button>
          )}
          {canInvoice && hasPerm("invoices.create") && (
            <Button onClick={() => setGenOpen(true)} className="bg-[#F5C518] text-[#1F2A33] font-bold hover:bg-[#E0B416] h-10" data-testid="job-generate-invoice-btn">
              <FileText className="w-4 h-4 mr-2"/> Generate Invoice
            </Button>
          )}
          {job.status !== "cancelled" && job.status !== "completed" && hasPerm("jobs.cancel") && (
            <Button variant="outline" onClick={() => setCancelOpen(true)} className="border-red-300 text-red-700 hover:bg-red-50 h-10" data-testid="job-cancel-btn">
              <X className="w-4 h-4 mr-2"/> Cancel
            </Button>
          )}
        </div>
      </div>

      {/* Timeline */}
      <section className="bg-white border border-gray-200 rounded p-6">
        <h2 className="text-sm font-bold uppercase tracking-[0.15em] text-[#3A6B8C] mb-4">Status timeline</h2>
        <div className="flex items-center gap-1 sm:gap-3 flex-wrap" data-testid="job-timeline">
          {ORDER.map((s, i) => {
            const done = idx >= i;
            const isCurrent = idx === i;
            return (
              <div key={s} className="flex items-center gap-1 sm:gap-2">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold ${
                  done ? "bg-[#F5C518] text-[#1F2A33]" : "bg-gray-200 text-gray-400"
                } ${isCurrent ? "ring-4 ring-[#F5C518]/30" : ""}`}>{i+1}</div>
                <span className={`text-xs ${isCurrent ? "font-bold text-[#1F2A33]" : "text-gray-500"}`}>{s.replace(/_/g," ")}</span>
                {i < ORDER.length - 1 && <div className={`hidden sm:block w-6 h-0.5 ${done && idx > i ? "bg-[#F5C518]" : "bg-gray-200"}`}/>}
              </div>
            );
          })}
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="bg-white border border-gray-200 rounded p-6 space-y-4">
          <h2 className="text-sm font-bold uppercase tracking-[0.15em] text-[#3A6B8C]">Schedule</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><Label className="text-xs uppercase tracking-wider text-[#3A6B8C] font-bold">Production date</Label>
              <Input type="date" value={job.scheduled_production_date || ""}
                onChange={(e) => patch({ scheduled_production_date: e.target.value })}
                data-testid="job-prod-date" className="mt-1 h-10"/></div>
            <div><Label className="text-xs uppercase tracking-wider text-[#3A6B8C] font-bold">Delivery date</Label>
              <Input type="date" value={job.scheduled_delivery_date || ""}
                onChange={(e) => patch({ scheduled_delivery_date: e.target.value })}
                data-testid="job-deliv-date" className="mt-1 h-10"/></div>
          </div>
        </section>

        <section className="bg-white border border-gray-200 rounded p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold uppercase tracking-[0.15em] text-[#3A6B8C]">Assignments</h2>
            <span className="text-[10px] font-bold uppercase tracking-wider bg-[#F5C518]/30 text-[#1F2A33] px-2 py-0.5 rounded border border-[#F5C518]">MOCKED · Phase 4</span>
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-[#3A6B8C] font-bold">Vehicle</Label>
            <Select value={job.assigned_vehicle_id || "_none"} onValueChange={(v) => patch({ assigned_vehicle_id: v === "_none" ? null : v })}>
              <SelectTrigger className="mt-1 h-10" data-testid="job-vehicle-select"><SelectValue placeholder="—"/></SelectTrigger>
              <SelectContent>
                <SelectItem value="_none">— None —</SelectItem>
                {(vehicles ?? []).map(v => <SelectItem key={v.id} value={v.id}>{v.id} · {v.name} ({v.rego}) · {v.capacity_tonnes}t</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-[#3A6B8C] font-bold">Crew (employees)</Label>
            <div className="mt-2 flex flex-wrap gap-2">
              {(employees ?? []).map(e => {
                const on = (job.assigned_employee_ids || []).includes(e.id);
                return (
                  <button key={e.id} type="button"
                    onClick={() => {
                      const cur = job.assigned_employee_ids || [];
                      const next = on ? cur.filter(x => x !== e.id) : [...cur, e.id];
                      patch({ assigned_employee_ids: next });
                    }}
                    data-testid={`job-emp-${e.id}`}
                    className={`text-xs px-2.5 py-1.5 rounded border transition-colors ${
                      on ? "bg-[#3A6B8C] text-white border-[#3A6B8C]" : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                    }`}>
                    {e.name} · {e.role}
                  </button>
                );
              })}
            </div>
          </div>
        </section>
      </div>

      <section className="bg-white border border-gray-200 rounded p-6">
        <h2 className="text-sm font-bold uppercase tracking-[0.15em] text-[#3A6B8C] mb-4">Line items (frozen from quote)</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-[10px] uppercase tracking-wider text-gray-600 border-b">
              <tr><th className="px-3 py-2 text-left">Description</th><th className="px-3 py-2 text-left">Panel</th><th className="px-3 py-2 text-right">Qty</th><th className="px-3 py-2 text-right">Total</th></tr>
            </thead>
            <tbody>
              {(job.line_items ?? []).map(l => (
                <tr key={l.id} className="border-b border-gray-100">
                  <td className="px-3 py-2.5">{l.description || "—"}</td>
                  <td className="px-3 py-2.5 text-gray-700">{l.panel_type_label}<div className="text-[10px] text-gray-500">{l.length_m}×{l.height_m}×{l.thickness_mm}mm</div></td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{l.quantity}</td>
                  <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{formatAUD(l.total_aud)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4 flex justify-end gap-8 text-sm">
          <div>Subtotal <span className="font-semibold tabular-nums ml-2">{formatAUD(job.subtotal)}</span></div>
          <div>GST <span className="font-semibold tabular-nums ml-2">{formatAUD(job.gst)}</span></div>
          <div className="text-lg">Total <span className="font-black tabular-nums ml-2 text-[#1F2A33]">{formatAUD(job.total)}</span></div>
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <NotesCard title="Production notes" value={job.production_notes} field="production_notes" patch={patch} testid="job-prod-notes"/>
        <NotesCard title="Delivery notes" value={job.delivery_notes} field="delivery_notes" patch={patch} testid="job-deliv-notes"/>
      </div>

      <section className="bg-white border border-gray-200 rounded p-6" data-testid="job-audit-log">
        <h2 className="text-sm font-bold uppercase tracking-[0.15em] text-[#3A6B8C] mb-4">Audit log</h2>
        <ol className="space-y-2 text-sm">
          {(job.status_history || []).map((h, i) => (
            <li key={i} className="flex gap-3 border-l-2 border-[#F5C518] pl-3">
              <div className="text-xs text-gray-500 tabular-nums w-44">{formatDateTime(h.at)}</div>
              <div className="flex-1">
                <span className="text-xs font-bold uppercase tracking-wider text-[#1F2A33]">
                  {h.from || "—"} → {h.to}
                </span>
                {h.note && <div className="text-xs text-gray-600 mt-0.5">{h.note}</div>}
              </div>
            </li>
          ))}
        </ol>
      </section>

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent data-testid="cancel-dialog">
          <DialogHeader>
            <DialogTitle>Cancel job</DialogTitle>
            <DialogDescription>This cannot be undone. Please provide a reason for the audit log.</DialogDescription>
          </DialogHeader>
          <Textarea value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} rows={3} placeholder="Reason for cancellation…" data-testid="cancel-reason"/>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelOpen(false)}>Keep job</Button>
            <Button onClick={doCancel} disabled={!cancelReason.trim()} className="bg-red-600 text-white hover:bg-red-700" data-testid="cancel-confirm-btn">Cancel job</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={genOpen} onOpenChange={setGenOpen}>
        <DialogContent data-testid="gen-invoice-dialog">
          <DialogHeader>
            <DialogTitle>Generate invoice</DialogTitle>
            <DialogDescription>An invoice will be created in <b>draft</b> status with the totals shown below. You can then issue and mark-paid.</DialogDescription>
          </DialogHeader>
          <div className="bg-gray-50 border border-gray-200 rounded p-4 text-sm">
            <div className="flex justify-between"><span>Customer</span><span className="font-semibold">{customer.company_name}</span></div>
            <div className="flex justify-between"><span>Lines</span><span>{job.line_items.length}</span></div>
            <div className="flex justify-between"><span>Subtotal</span><span className="tabular-nums">{formatAUD(job.subtotal)}</span></div>
            <div className="flex justify-between"><span>GST</span><span className="tabular-nums">{formatAUD(job.gst)}</span></div>
            <div className="flex justify-between mt-2 pt-2 border-t font-bold text-base text-[#1F2A33]"><span>Total</span><span className="tabular-nums">{formatAUD(job.total)}</span></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGenOpen(false)}>Cancel</Button>
            <Button onClick={generateInvoice} className="bg-[#F5C518] text-[#1F2A33] font-bold hover:bg-[#E0B416]" data-testid="gen-invoice-confirm">Generate invoice</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <EmailModal
        open={emailOpen} onOpenChange={setEmailOpen}
        defaultRecipient={customer.contact_email}
        defaultSubject={`Production update — Job ${job.job_number}`}
        defaultBody={`Hi ${customer.contact_name || customer.company_name},\n\nQuick update on Job ${job.job_number} (${job.line_items.length} line${job.line_items.length===1?'':'s'}, ${(job.total_weight_tonnes||0).toFixed(2)} t).\n\nCurrent status: ${job.status.replace(/_/g,' ')}\nScheduled production: ${job.scheduled_production_date || '—'}\nScheduled delivery: ${job.scheduled_delivery_date || '—'}\n\nDelivery address: ${customer.site_address?.street || ''}, ${customer.site_address?.suburb || ''} ${customer.site_address?.state || ''} ${customer.site_address?.postcode || ''}.\n\nKind regards,\nPaneltec Group`}
        attachmentNotice={`Attach a production sheet by clicking Print → Save as PDF.`}
        endpoint={`/jobs/${id}/email-sent`}
        onSent={load}
      />
    </div>
  );
}

function NotesCard({ title, value, field, patch, testid }) {
  const [local, setLocal] = useState(value || "");
  useEffect(() => { setLocal(value || ""); }, [value]);
  return (
    <section className="bg-white border border-gray-200 rounded p-6">
      <h2 className="text-sm font-bold uppercase tracking-[0.15em] text-[#3A6B8C] mb-3">{title}</h2>
      <Textarea value={local} onChange={(e) => setLocal(e.target.value)} rows={4} data-testid={testid}/>
      <div className="mt-2 text-right">
        <Button variant="outline" size="sm" onClick={() => patch({ [field]: local })} disabled={local === (value || "")}>
          <Save className="w-3.5 h-3.5 mr-1"/> Save notes
        </Button>
      </div>
    </section>
  );
}
