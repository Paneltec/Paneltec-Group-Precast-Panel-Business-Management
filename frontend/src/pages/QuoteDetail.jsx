import { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { Loader2, ArrowLeft, Copy, Check, X, ExternalLink, Lock, ChevronDown, ChevronUp } from "lucide-react";
import AppIcon from "../components/AppIcon";
import { api, formatApiErrorDetail } from "../lib/api";
import { Button } from "../components/ui/button";
import { formatAUD, formatNumber, formatDateTime } from "../lib/format";
import { Toaster, toast } from "sonner";
import { openPrintPopup, openCustomerPreviewPopup } from "../lib/print";
import UserBadge from "../components/UserBadge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "../components/ui/dialog";

const STATUS_ICON = {draft:"quote_status_draft",sent:"quote_status_sent",accepted:"quote_status_accepted",rejected:"quote_status_rejected",expired:"quote_status_expired"};
const STATUS_STYLES = {
  draft: "bg-gray-100 text-gray-700",
  sent: "bg-blue-100 text-blue-800",
  accepted: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-700",
  expired: "bg-amber-100 text-amber-800",
};

export default function QuoteDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [quote, setQuote] = useState(null);
  const [customer, setCustomer] = useState(null);
  const [project, setProject] = useState(null);
  const [error, setError] = useState("");
  const [sendOpen, setSendOpen] = useState(false);
  const [magicUrl, setMagicUrl] = useState("");
  const [emailPreview, setEmailPreview] = useState(null);
  const [copied, setCopied] = useState(false);

  const load = async () => {
    try {
      const { data } = await api.get(`/quotes/${id}`);
      setQuote(data);
      const [{ data: c }, p] = await Promise.all([
        api.get(`/customers/${data.customer_id}`),
        data.project_id ? api.get(`/projects/${data.project_id}`) : Promise.resolve({ data: null }),
      ]);
      setCustomer(c);
      setProject(p?.data || null);
    } catch (e) {
      setError(formatApiErrorDetail(e.response?.data?.detail) || e.message);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  const onSend = async () => {
    try {
      const { data } = await api.post(`/quotes/${id}/send`, {});
      setMagicUrl(`${window.location.origin}/q/${data.magic_link_token}`);
      setEmailPreview(data.email_preview || null);
      setSendOpen(true);
      await load();
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message);
    }
  };

  const onRevise = async () => {
    if (!window.confirm("Create a new draft revision of this quote? The original stays unchanged.")) return;
    try {
      const { data } = await api.post(`/quotes/${id}/revise`);
      toast.success(`Revision ${data.quote_number} created`);
      navigate(`/quotes/${data.id}/edit`);
    } catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message); }
  };

  const onMark = async (kind) => {
    try {
      await api.post(`/quotes/${id}/${kind === "accepted" ? "mark-accepted" : "mark-rejected"}`);
      await load();
      toast.success(`Quote marked ${kind}`);
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(magicUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  if (error) return <div className="text-sm text-red-700">{error}</div>;
  if (!quote || !customer) return <div className="flex items-center gap-2 text-gray-500 text-sm"><Loader2 className="w-4 h-4 animate-spin"/> Loading…</div>;

  const publicUrl = quote.magic_link_token ? `${window.location.origin}/q/${quote.magic_link_token}` : null;

  return (
    <div className="max-w-6xl space-y-6" data-testid="quote-detail-page">
      <Toaster richColors position="top-right"/>
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div>
          <Link to="/quotes" className="inline-flex items-center text-xs uppercase tracking-wider text-[#3A6B8C] font-bold mb-2 hover:text-[#1F2A33]"><ArrowLeft className="w-3 h-3 mr-1"/> Back to quotes</Link>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-3xl md:text-4xl font-black tracking-tighter text-[#1F2A33] tabular-nums">{quote.quote_number}</h1>
            <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded inline-flex items-center gap-1 ${STATUS_STYLES[quote.status] || "bg-gray-100"}`} data-testid="quote-status"><AppIcon name={STATUS_ICON[quote.status]} size={14} decorative/>{quote.status}</span>
          </div>
          <p className="text-sm text-gray-500 mt-1">For <Link to={`/customers/${customer.id}`} className="font-semibold text-[#3A6B8C] hover:text-[#1F2A33]">{customer.company_name}</Link>
            {project && <> · {project.project_name}</>} · Valid until {quote.valid_until}</p>
          <p className="text-xs text-gray-500 mt-1" data-testid="quote-created-by">
            Created by <UserBadge user={quote.created_by_user} testid="quote-created-by-badge" />
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => openPrintPopup(`/quotes/${id}/print`)} className="border-[#1F2A33] text-[#1F2A33] font-semibold h-10" data-testid="quote-print-btn">
            <AppIcon name="print" size={18} className="mr-2" decorative/> Print
          </Button>
          {quote.status === "draft" && (
            <>
              <Button variant="outline" onClick={() => navigate(`/quotes/${id}/edit`)} className="border-[#1F2A33] text-[#1F2A33] font-semibold h-10" data-testid="quote-edit-btn">
                <AppIcon name="edit" size={18} className="mr-2" decorative/> Edit
              </Button>
              <Button onClick={onSend} className="bg-[#F5C518] text-[#1F2A33] font-bold hover:bg-[#E0B416] h-10" data-testid="quote-send-btn">
                <AppIcon name="send" size={18} className="mr-2" decorative/> Send
              </Button>
            </>
          )}
          {quote.status === "sent" && (
            <>
              <Button variant="outline" onClick={onRevise} className="border-[#1F2A33] text-[#1F2A33] font-semibold h-10" data-testid="quote-revise-btn">
                Revise
              </Button>
              <Button variant="outline" onClick={() => onMark("accepted")} className="border-green-600 text-green-700 hover:bg-green-50 font-semibold h-10" data-testid="quote-mark-accepted">
                <Check className="w-4 h-4 mr-2"/> Mark accepted
              </Button>
              <Button variant="outline" onClick={() => onMark("rejected")} className="border-red-600 text-red-700 hover:bg-red-50 font-semibold h-10" data-testid="quote-mark-rejected">
                <X className="w-4 h-4 mr-2"/> Mark rejected
              </Button>
            </>
          )}
          {(quote.status === "accepted" || quote.status === "rejected" || quote.status === "expired") && (
            <Button variant="outline" onClick={onRevise} className="border-[#1F2A33] text-[#1F2A33] font-semibold h-10" data-testid="quote-revise-btn">
              Revise as new draft
            </Button>
          )}
        </div>
      </div>

      {publicUrl && (
        <div className="bg-blue-50 border border-blue-200 rounded p-4 text-sm flex flex-col sm:flex-row sm:items-center gap-3" data-testid="magic-link-banner">
          <div className="flex-1">
            <div className="font-bold text-[#1F2A33]">Public approval link</div>
            <code className="text-xs break-all text-[#3A6B8C]">{publicUrl}</code>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={async () => { await navigator.clipboard.writeText(publicUrl); toast.success("Link copied"); }} data-testid="copy-magic-link"><AppIcon name="copy" size={14} className="mr-1" decorative/> Copy</Button>
            <button onClick={() => openCustomerPreviewPopup(publicUrl)} className="inline-flex items-center text-xs font-bold uppercase tracking-wider text-[#3A6B8C] hover:text-[#1F2A33] px-3" data-testid="preview-public-quote"><ExternalLink className="w-3.5 h-3.5 mr-1"/> Preview</button>
          </div>
        </div>
      )}

      {/* Customer engagement (view tracking) */}
      {quote.magic_link_token && (
        <section className="bg-white border border-gray-200 rounded p-4" data-testid="engagement-card">
          <div className="overline mb-2">Customer engagement</div>
          {!quote.first_viewed_at ? (
            <div className="text-sm text-gray-500">Not yet viewed.</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
              <div><div className="text-[10px] uppercase tracking-wider text-gray-500 font-bold">First viewed</div>
                <div className="text-[#1F2A33] font-semibold mt-0.5" data-testid="engagement-first">{formatDateTime(quote.first_viewed_at)}</div></div>
              <div><div className="text-[10px] uppercase tracking-wider text-gray-500 font-bold">Last viewed</div>
                <div className="text-[#1F2A33] font-semibold mt-0.5" data-testid="engagement-last">{formatDateTime(quote.last_viewed_at)}</div></div>
              <div><div className="text-[10px] uppercase tracking-wider text-gray-500 font-bold">Total views</div>
                <div className="text-[#1F2A33] font-black text-xl tabular-nums mt-0.5" data-testid="engagement-count">{quote.view_count || 0}</div></div>
            </div>
          )}
        </section>
      )}

      {/* Revision lineage */}
      {(quote.revised_from_quote_id || quote.revised_to_quote_id) && (
        <section className="bg-white border border-gray-200 rounded p-4" data-testid="revision-lineage">
          <div className="overline mb-2">Revision lineage</div>
          {quote.revised_from_quote_id && (
            <div className="text-sm">Revision of <Link to={`/quotes/${quote.revised_from_quote_id}`} className="font-bold text-[#3A6B8C] hover:text-[#1F2A33]" data-testid="revised-from-link">earlier quote</Link></div>
          )}
          {quote.revised_to_quote_id && (
            <div className="text-sm">Superseded by <Link to={`/quotes/${quote.revised_to_quote_id}`} className="font-bold text-[#3A6B8C] hover:text-[#1F2A33]" data-testid="revised-to-link">new revision</Link></div>
          )}
        </section>
      )}

      <section className="bg-white border border-gray-200 rounded p-6">
        <h2 className="text-sm font-bold uppercase tracking-[0.15em] text-[#3A6B8C] mb-4">Line items</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[#3A6B8C] text-white uppercase text-[10px] tracking-wider">
              <tr>
                <th className="px-3 py-2 text-left">Description</th>
                <th className="px-3 py-2 text-left">Panel</th>
                <th className="px-3 py-2 text-right">L × H × thk</th>
                <th className="px-3 py-2 text-right">Qty</th>
                <th className="px-3 py-2 text-right">Subtotal</th>
                <th className="px-3 py-2 text-right">Total inc GST</th>
              </tr>
            </thead>
            <tbody>
              {(quote.line_items ?? []).map((l) => (
                <tr key={l.id} className="border-b border-gray-100">
                  <td className="px-3 py-2.5 text-[#1F2A33]">{l.description || "—"}</td>
                  <td className="px-3 py-2.5 text-gray-700">{l.panel_type_label}<div className="text-[10px] text-gray-500">{l.finish_label} · {l.reinforcement_label}</div></td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-gray-700">{l.length_m} × {l.height_m} × {l.thickness_mm}mm</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{l.quantity}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{formatAUD(l.subtotal_aud)}</td>
                  <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{formatAUD(l.total_aud)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <InternalMarginCard quote={quote} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <section className="bg-white border border-gray-200 rounded p-6 lg:col-span-2 space-y-4">
          <div>
            <div className="overline mb-1">Notes to customer</div>
            <p className="text-sm text-gray-700 whitespace-pre-wrap">{quote.notes_to_customer || <span className="text-gray-400 italic">—</span>}</p>
          </div>
          <div>
            <div className="overline mb-1">Internal notes</div>
            <p className="text-sm text-gray-700 whitespace-pre-wrap">{quote.internal_notes || <span className="text-gray-400 italic">—</span>}</p>
          </div>
          <div className="grid grid-cols-2 gap-3 pt-3 border-t text-xs text-gray-500">
            <div>Created<div className="text-gray-700 font-semibold">{formatDateTime(quote.created_at)}</div></div>
            <div>Sent<div className="text-gray-700 font-semibold">{formatDateTime(quote.sent_at)}</div></div>
            <div>Accepted<div className="text-gray-700 font-semibold">{formatDateTime(quote.accepted_at)}</div></div>
            <div>Rejected<div className="text-gray-700 font-semibold">{formatDateTime(quote.rejected_at)}</div></div>
          </div>
        </section>

        <aside className="bg-white border border-gray-200 rounded p-6">
          <div className="overline mb-2">Totals</div>
          <div className="flex justify-between py-1.5 text-sm"><span className="text-gray-600">Subtotal</span><span className="font-semibold tabular-nums">{formatAUD(quote.subtotal)}</span></div>
          <div className="flex justify-between py-1.5 text-sm"><span className="text-gray-600">GST</span><span className="font-semibold tabular-nums">{formatAUD(quote.gst)}</span></div>
          <div className="flex justify-between mt-3 pt-3 border-t-2 border-[#1F2A33]">
            <span className="text-sm font-bold text-[#1F2A33]">Total inc GST</span>
            <span className="text-xl font-black text-[#1F2A33] tabular-nums" data-testid="detail-total">{formatAUD(quote.total)}</span>
          </div>
          <div className="mt-3 text-[10px] uppercase tracking-wider text-gray-400 grid grid-cols-2 gap-2">
            <div>Volume<div className="text-gray-700 font-semibold">{formatNumber(quote.total_volume_m3, 3)} m³</div></div>
            <div>Weight<div className="text-gray-700 font-semibold">{formatNumber(quote.total_weight_tonnes, 3)} t</div></div>
          </div>
        </aside>
      </div>

      <Dialog open={sendOpen} onOpenChange={setSendOpen}>
        <DialogContent data-testid="send-confirm-dialog" className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Email ready to send</DialogTitle>
            <DialogDescription>
              <span className="block mt-2 mb-1 bg-[#F5C518]/30 border border-[#F5C518] text-[#1F2A33] text-xs font-bold uppercase tracking-wider px-2 py-1.5 rounded">
                📧 MOCKED · Email will send automatically via Microsoft 365 in Phase 4. For now, copy &amp; send manually from your inbox.
              </span>
            </DialogDescription>
          </DialogHeader>
          {emailPreview && (
            <div className="space-y-3 text-sm">
              <div><label className="text-xs uppercase tracking-wider text-[#3A6B8C] font-bold">To</label><div className="font-mono text-xs bg-gray-50 border rounded px-2 py-1.5 mt-1">{emailPreview.to}</div></div>
              <div><label className="text-xs uppercase tracking-wider text-[#3A6B8C] font-bold">Subject</label><div className="font-semibold bg-gray-50 border rounded px-2 py-1.5 mt-1">{emailPreview.subject}</div></div>
              <div><label className="text-xs uppercase tracking-wider text-[#3A6B8C] font-bold">Body</label>
                <textarea readOnly value={emailPreview.body} rows={10}
                  className="w-full mt-1 bg-gray-50 border rounded px-2 py-1.5 font-mono text-xs whitespace-pre-wrap" data-testid="send-email-body"/>
              </div>
              <div><label className="text-xs uppercase tracking-wider text-[#3A6B8C] font-bold">Magic link</label>
                <code className="block bg-gray-50 border rounded px-2 py-1.5 mt-1 text-xs break-all">{magicUrl}</code></div>
            </div>
          )}
          <DialogFooter className="flex-wrap gap-2">
            <Button variant="outline" onClick={async () => { await navigator.clipboard.writeText(magicUrl); setCopied(true); setTimeout(() => setCopied(false), 2000); }} data-testid="send-copy-link">
              <AppIcon name="copy" size={16} className="mr-2" decorative/>{copied ? "Copied!" : "Copy magic link"}
            </Button>
            <Button variant="outline" onClick={async () => { await navigator.clipboard.writeText(`Subject: ${emailPreview?.subject}\n\n${emailPreview?.body}`); toast.success("Email content copied"); }} data-testid="send-copy-email">
              <AppIcon name="copy" size={16} className="mr-2" decorative/> Copy email content
            </Button>
            <Button onClick={() => setSendOpen(false)} className="bg-[#1F2A33] text-white hover:bg-[#3A6B8C]">Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}


function marginColor(pct) {
  if (pct >= 30) return "text-green-700";
  if (pct >= 15) return "text-amber-700";
  return "text-red-700";
}
function marginBg(pct) {
  if (pct >= 30) return "bg-green-50 border-green-200";
  if (pct >= 15) return "bg-amber-50 border-amber-200";
  return "bg-red-50 border-red-200";
}

function InternalMarginCard({ quote }) {
  const [open, setOpen] = useState(false);
  if (quote.total_cost_aud === undefined || quote.total_cost_aud === null) return null;
  const mp = quote.margin_pct ?? 0;
  return (
    <section className="bg-white border border-[#1F2A33]/20 rounded no-print" data-testid="internal-margin-card">
      <button type="button" onClick={() => setOpen(o => !o)}
              className="w-full flex items-center justify-between p-4 hover:bg-gray-50"
              data-testid="internal-margin-toggle">
        <div className="flex items-center gap-2">
          <AppIcon name="locked" size={16} decorative/>
          <span className="text-sm font-bold uppercase tracking-[0.15em] text-[#3A6B8C]">Internal — Margin Analysis</span>
          <span className={`text-xs font-bold tabular-nums ${marginColor(mp)}`} data-testid="margin-pill-collapsed">
            {formatAUD(quote.margin_aud ?? 0)} ({mp.toFixed(1)}%)
          </span>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-gray-500"/> : <ChevronDown className="w-4 h-4 text-gray-500"/>}
      </button>
      {open && (
        <div className="p-5 border-t border-gray-200 space-y-4" data-testid="internal-margin-expanded">
          <table className="w-full text-sm border border-gray-200 rounded overflow-hidden">
            <thead className="bg-[#1F2A33] text-[#F5C518] uppercase text-[10px] tracking-wider">
              <tr>
                <th className="px-3 py-2 text-left">Line</th>
                <th className="px-3 py-2 text-right">Sell</th>
                <th className="px-3 py-2 text-right">Cost</th>
                <th className="px-3 py-2 text-right">Margin</th>
                <th className="px-3 py-2 text-right">Margin %</th>
              </tr>
            </thead>
            <tbody>
              {(quote.line_items ?? []).map((l) => (
                <tr key={l.id} className="border-t border-gray-200">
                  <td className="px-3 py-2 text-[#1F2A33]">{l.description || l.panel_type_label}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatAUD(l.subtotal_aud)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatAUD(l.total_cost_aud ?? 0)}</td>
                  <td className={`px-3 py-2 text-right tabular-nums font-semibold ${marginColor(l.margin_pct ?? 0)}`}>{formatAUD(l.margin_aud ?? 0)}</td>
                  <td className={`px-3 py-2 text-right tabular-nums font-semibold ${marginColor(l.margin_pct ?? 0)}`}>{(l.margin_pct ?? 0).toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className={`grid grid-cols-2 md:grid-cols-4 gap-3 border-2 rounded p-4 ${marginBg(mp)}`}>
            <div><div className="text-[10px] uppercase font-bold tracking-wider text-gray-500">Total sell</div><div className="text-base font-black tabular-nums text-[#1F2A33]" data-testid="rollup-sell">{formatAUD(quote.subtotal)}</div></div>
            <div><div className="text-[10px] uppercase font-bold tracking-wider text-gray-500">Total cost</div><div className="text-base font-black tabular-nums text-[#1F2A33]" data-testid="rollup-cost">{formatAUD(quote.total_cost_aud ?? 0)}</div></div>
            <div><div className="text-[10px] uppercase font-bold tracking-wider text-gray-500">Margin AUD</div><div className={`text-base font-black tabular-nums ${marginColor(mp)}`} data-testid="rollup-margin-aud">{formatAUD(quote.margin_aud ?? 0)}</div></div>
            <div><div className="text-[10px] uppercase font-bold tracking-wider text-gray-500">Margin %</div><div className={`text-base font-black tabular-nums ${marginColor(mp)}`} data-testid="rollup-margin-pct">{mp.toFixed(1)}%</div></div>
          </div>
        </div>
      )}
    </section>
  );
}
