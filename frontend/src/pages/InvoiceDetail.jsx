import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { Loader2, ArrowLeft, Send, Check, Printer, ExternalLink, Mail } from "lucide-react";
import { api, formatApiErrorDetail } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "../components/ui/dialog";
import { formatAUD, formatDateTime } from "../lib/format";
import { Toaster, toast } from "sonner";
import EmailModal, { LastEmailedLabel } from "../components/EmailModal";
import { useAuth } from "../contexts/AuthContext";
import { openPrintPopup } from "../lib/print";

const STATUS_STYLES = {
  draft:"bg-gray-100 text-gray-700",issued:"bg-blue-100 text-blue-800",
  paid:"bg-green-100 text-green-800",overdue:"bg-red-100 text-red-700",
  cancelled:"bg-gray-200 text-gray-500",
};

export default function InvoiceDetail() {
  const { hasPerm } = useAuth();
  const { id } = useParams();
  const [inv, setInv] = useState(null);
  const [customer, setCustomer] = useState(null);
  const [paidOpen, setPaidOpen] = useState(false);
  const [paidAmount, setPaidAmount] = useState("");
  const [paidRef, setPaidRef] = useState("");
  const [emailOpen, setEmailOpen] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    try {
      const { data } = await api.get(`/invoices/${id}`);
      setInv(data);
      setPaidAmount(String(data.total));
      const { data: c } = await api.get(`/customers/${data.customer_id}`);
      setCustomer(c);
    } catch (e) { setError(formatApiErrorDetail(e.response?.data?.detail) || e.message); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  const issue = async () => {
    try { await api.post(`/invoices/${id}/issue`); await load(); toast.success("Invoice issued"); }
    catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message); }
  };
  const markPaid = async () => {
    try {
      await api.post(`/invoices/${id}/mark-paid`, { paid_amount: parseFloat(paidAmount), payment_reference: paidRef });
      await load(); setPaidOpen(false); toast.success("Marked paid");
    } catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message); }
  };
  const pushXero = async () => {
    if (inv?.xero_push_status === "MOCKED_PUSHED") {
      const at = inv.last_xero_push_at || inv.xero_pushed_at || "previously";
      if (!window.confirm(`⚠️ This invoice was already pushed to Xero on ${new Date(at).toLocaleString("en-AU")}.\nPushing again will create a duplicate in Xero. Continue?`)) return;
    }
    try {
      const { data } = await api.post(`/invoices/${id}/push-to-xero`);
      await load();
      toast.success(`MOCKED — pushed as ${data.xero_invoice_id}`);
    } catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message); }
  };

  if (error) return <div className="text-sm text-red-700">{error}</div>;
  if (!inv || !customer) return <div className="flex items-center gap-2 text-gray-500 text-sm"><Loader2 className="w-4 h-4 animate-spin"/> Loading…</div>;

  return (
    <div className="max-w-5xl space-y-6" data-testid="invoice-detail-page">
      <Toaster richColors position="top-right"/>
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div>
          <Link to="/invoices" className="inline-flex items-center text-xs uppercase tracking-wider text-[#3A6B8C] font-bold mb-2 hover:text-[#1F2A33]"><ArrowLeft className="w-3 h-3 mr-1"/> Back to invoices</Link>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-3xl md:text-4xl font-black tracking-tighter text-[#1F2A33] tabular-nums">{inv.invoice_number}</h1>
            <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded ${STATUS_STYLES[inv.status]}`} data-testid="invoice-status">{inv.status}</span>
          </div>
          <p className="text-sm text-gray-500 mt-1">
            <Link to={`/customers/${customer.id}`} className="font-semibold text-[#3A6B8C] hover:text-[#1F2A33]">{customer.company_name}</Link>
            {" · "}
            <Link to={`/quotes/${inv.quote_id}`} className="text-[#3A6B8C] hover:text-[#1F2A33]">Quote {inv.quote_number}</Link>
            {" · "}
            <Link to={`/jobs/${inv.job_id}`} className="text-[#3A6B8C] hover:text-[#1F2A33]">Job {inv.job_number}</Link>
          </p>
          <LastEmailedLabel at={inv.last_email_sent_at} subject={inv.last_email_subject}/>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => openPrintPopup(`/invoices/${id}/print`)} className="border-[#1F2A33] text-[#1F2A33] font-semibold h-10" data-testid="invoice-print-btn">
            <Printer className="w-4 h-4 mr-2"/> Print
          </Button>
          <Button variant="outline" onClick={() => setEmailOpen(true)} className="border-[#3A6B8C] text-[#3A6B8C] font-semibold h-10" data-testid="invoice-email-btn">
            <Mail className="w-4 h-4 mr-2"/> Email
          </Button>
          {inv.status === "draft" && hasPerm("invoices.issue") && (
            <Button onClick={issue} className="bg-[#F5C518] text-[#1F2A33] font-bold hover:bg-[#E0B416] h-10" data-testid="invoice-issue-btn">
              <Send className="w-4 h-4 mr-2"/> Issue
            </Button>
          )}
          {inv.status === "issued" && hasPerm("invoices.mark_paid") && (
            <Button onClick={() => setPaidOpen(true)} className="bg-green-600 text-white hover:bg-green-700 h-10" data-testid="invoice-mark-paid-btn">
              <Check className="w-4 h-4 mr-2"/> Mark Paid
            </Button>
          )}
          {hasPerm("invoices.push_xero") && (
            <Button variant="outline" onClick={pushXero} className="border-[#F5C518] text-[#1F2A33] font-semibold h-10" data-testid="invoice-push-xero-btn">
              <ExternalLink className="w-4 h-4 mr-2"/> Push to Xero
            </Button>
          )}
        </div>
      </div>

      {inv.xero_push_status === "MOCKED_PUSHED" && (
        <div className="bg-[#F5C518]/30 border border-[#F5C518] rounded p-3 text-sm" data-testid="xero-mocked-banner">
          <span className="font-bold uppercase tracking-wider text-xs text-[#1F2A33]">⚠️ MOCKED · Xero push</span>
          <div className="text-[#1F2A33]/80 text-xs mt-0.5">Mock Xero invoice ID: <code className="bg-white px-1.5 py-0.5 rounded">{inv.xero_invoice_id}</code>. Real push lands in Phase 4.</div>
        </div>
      )}

      <section className="bg-white border border-gray-200 rounded p-6">
        <h2 className="text-sm font-bold uppercase tracking-[0.15em] text-[#3A6B8C] mb-4">Line items</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-[10px] uppercase tracking-wider text-gray-600 border-b">
              <tr><th className="px-3 py-2 text-left">Description</th><th className="px-3 py-2 text-left">Panel</th><th className="px-3 py-2 text-right">Qty</th><th className="px-3 py-2 text-right">Total</th></tr>
            </thead>
            <tbody>
              {inv.line_items.map(l => (
                <tr key={l.id} className="border-b border-gray-100">
                  <td className="px-3 py-2.5">{l.description || "—"}</td>
                  <td className="px-3 py-2.5 text-gray-700">{l.panel_type_label}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{l.quantity}</td>
                  <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{formatAUD(l.total_aud)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <section className="bg-white border border-gray-200 rounded p-6 md:col-span-2">
          <h2 className="text-sm font-bold uppercase tracking-[0.15em] text-[#3A6B8C] mb-4">Payment</h2>
          {inv.status === "paid" ? (
            <div className="space-y-1 text-sm">
              <div><span className="text-gray-500">Paid amount:</span> <span className="font-bold tabular-nums">{formatAUD(inv.paid_amount)}</span></div>
              <div><span className="text-gray-500">Reference:</span> <span className="font-mono text-xs">{inv.payment_reference || "—"}</span></div>
              <div><span className="text-gray-500">Paid at:</span> {formatDateTime(inv.paid_at)}</div>
            </div>
          ) : (
            <div className="text-sm text-gray-500">Not paid yet. Issue date {inv.issue_date}, due {inv.due_date}.</div>
          )}
        </section>
        <section className="bg-white border border-gray-200 rounded p-6">
          <div className="overline mb-2">Totals</div>
          <div className="flex justify-between text-sm py-1"><span>Subtotal</span><span className="tabular-nums font-semibold">{formatAUD(inv.subtotal)}</span></div>
          <div className="flex justify-between text-sm py-1"><span>GST</span><span className="tabular-nums font-semibold">{formatAUD(inv.gst)}</span></div>
          <div className="flex justify-between mt-3 pt-3 border-t-2 border-[#1F2A33]">
            <span className="text-sm font-bold text-[#1F2A33]">Total Due</span>
            <span className="text-xl font-black text-[#1F2A33] tabular-nums" data-testid="invoice-total">{formatAUD(inv.total)}</span>
          </div>
        </section>
      </div>

      <Dialog open={paidOpen} onOpenChange={setPaidOpen}>
        <DialogContent data-testid="mark-paid-dialog">
          <DialogHeader>
            <DialogTitle>Mark invoice paid</DialogTitle>
            <DialogDescription>Record the payment amount and reference.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div><Label>Paid amount (AUD)</Label><Input type="number" step="0.01" value={paidAmount} onChange={(e) => setPaidAmount(e.target.value)} data-testid="paid-amount-input" className="mt-1 h-10"/></div>
            <div><Label>Payment reference</Label><Input value={paidRef} onChange={(e) => setPaidRef(e.target.value)} placeholder="EFT-12345" data-testid="paid-ref-input" className="mt-1 h-10"/></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPaidOpen(false)}>Cancel</Button>
            <Button onClick={markPaid} className="bg-green-600 text-white hover:bg-green-700" data-testid="paid-confirm-btn">Mark paid</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <EmailModal
        open={emailOpen} onOpenChange={setEmailOpen}
        defaultRecipient={customer.contact_email}
        defaultSubject={`Tax Invoice ${inv.invoice_number} from Paneltec Group`}
        defaultBody={`Hi ${customer.contact_name || customer.company_name},\n\nPlease find Tax Invoice ${inv.invoice_number} for Job ${inv.job_number}.\n\nAmount due: AUD $${(inv.total||0).toLocaleString('en-AU',{minimumFractionDigits:2,maximumFractionDigits:2})} (inc GST)\nDue date: ${inv.due_date}\n\nPayment instructions are on the printable invoice attached.\n\nKind regards,\nPaneltec Group Accounts Team`}
        attachmentNotice={`Print the invoice (Print button → Save as PDF) and attach to this email.`}
        endpoint={`/invoices/${id}/email-sent`}
        previousSend={inv.last_email_sent_at ? { at: inv.last_email_sent_at, recipient: inv.last_email_recipient, subject: inv.last_email_subject } : null}
        onSent={load}
      />
    </div>
  );
}
