import { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { Loader2, ArrowLeft, Send, Edit, Printer, Copy, Check, X, ExternalLink } from "lucide-react";
import { api, formatApiErrorDetail } from "../lib/api";
import { Button } from "../components/ui/button";
import { formatAUD, formatNumber, formatDateTime } from "../lib/format";
import { Toaster, toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "../components/ui/dialog";

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
      const { data } = await api.post(`/quotes/${id}/send`);
      setMagicUrl(`${window.location.origin}/q/${data.magic_link_token}`);
      setSendOpen(true);
      await load();
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message);
    }
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
            <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded ${STATUS_STYLES[quote.status] || "bg-gray-100"}`} data-testid="quote-status">{quote.status}</span>
          </div>
          <p className="text-sm text-gray-500 mt-1">For <Link to={`/customers/${customer.id}`} className="font-semibold text-[#3A6B8C] hover:text-[#1F2A33]">{customer.company_name}</Link>
            {project && <> · {project.project_name}</>} · Valid until {quote.valid_until}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => window.open(`/quotes/${id}/print`, "_blank")} className="border-[#1F2A33] text-[#1F2A33] font-semibold h-10" data-testid="quote-print-btn">
            <Printer className="w-4 h-4 mr-2"/> Print
          </Button>
          {quote.status === "draft" && (
            <>
              <Button variant="outline" onClick={() => navigate(`/quotes/${id}/edit`)} className="border-[#1F2A33] text-[#1F2A33] font-semibold h-10" data-testid="quote-edit-btn">
                <Edit className="w-4 h-4 mr-2"/> Edit
              </Button>
              <Button onClick={onSend} className="bg-[#F5C518] text-[#1F2A33] font-bold hover:bg-[#E0B416] h-10" data-testid="quote-send-btn">
                <Send className="w-4 h-4 mr-2"/> Send
              </Button>
            </>
          )}
          {quote.status === "sent" && (
            <>
              <Button variant="outline" onClick={() => onMark("accepted")} className="border-green-600 text-green-700 hover:bg-green-50 font-semibold h-10" data-testid="quote-mark-accepted">
                <Check className="w-4 h-4 mr-2"/> Mark accepted
              </Button>
              <Button variant="outline" onClick={() => onMark("rejected")} className="border-red-600 text-red-700 hover:bg-red-50 font-semibold h-10" data-testid="quote-mark-rejected">
                <X className="w-4 h-4 mr-2"/> Mark rejected
              </Button>
            </>
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
            <Button variant="outline" size="sm" onClick={async () => { await navigator.clipboard.writeText(publicUrl); toast.success("Link copied"); }} data-testid="copy-magic-link"><Copy className="w-3.5 h-3.5 mr-1"/> Copy</Button>
            <a href={publicUrl} target="_blank" rel="noreferrer" className="inline-flex items-center text-xs font-bold uppercase tracking-wider text-[#3A6B8C] hover:text-[#1F2A33] px-3"><ExternalLink className="w-3.5 h-3.5 mr-1"/> Open</a>
          </div>
        </div>
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
              {quote.line_items.map((l) => (
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
        <DialogContent data-testid="send-confirm-dialog">
          <DialogHeader>
            <DialogTitle>Quote sent</DialogTitle>
            <DialogDescription>
              <span className="block mt-2 text-amber-700 text-xs font-bold uppercase tracking-wider">
                Email via M365 — MOCKED, will send automatically in Phase 4
              </span>
              Share this magic link with the customer. They can accept or reject without logging in.
            </DialogDescription>
          </DialogHeader>
          <div className="bg-gray-50 border border-gray-200 rounded p-3">
            <code className="text-xs break-all text-[#1F2A33]">{magicUrl}</code>
          </div>
          <DialogFooter>
            <Button onClick={copy} variant="outline" data-testid="send-copy-link">
              <Copy className="w-4 h-4 mr-2"/>{copied ? "Copied!" : "Copy link"}
            </Button>
            <Button onClick={() => setSendOpen(false)} className="bg-[#1F2A33] text-white hover:bg-[#3A6B8C]">Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
