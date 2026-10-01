import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Loader2, Check, X, ShieldCheck } from "lucide-react";
import AppIcon from "../components/AppIcon";
import axios from "axios";
import { formatAUD, formatDateTime } from "../lib/format";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const STATUS_COPY = {
  sent: { label: "Awaiting your decision", tone: "blue" },
  accepted: { label: "Accepted — thank you!", tone: "green" },
  rejected: { label: "Declined", tone: "red" },
  expired: { label: "This quote has expired", tone: "amber" },
  draft: { label: "Draft — not yet sent", tone: "gray" },
};

export default function PublicQuote() {
  const { token } = useParams();
  const [quote, setQuote] = useState(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    try {
      const { data } = await axios.get(`${API}/public/quotes/by-token/${token}`);
      setQuote(data);
    } catch (e) {
      setError(e.response?.data?.detail || "Quote not found");
    }
  };
  useEffect(() => { load(); }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (kind) => {
    setSubmitting(true);
    try {
      const { data } = await axios.post(`${API}/public/quotes/by-token/${token}/${kind}`);
      setQuote(data);
    } catch (e) {
      setError(e.response?.data?.detail || "Action failed");
    } finally { setSubmitting(false); }
  };

  if (error && !quote) {
    return (
      <div className="min-h-screen bg-[#1F2A33] flex items-center justify-center p-4">
        <div className="bg-white rounded p-8 max-w-md text-center" data-testid="public-quote-error">
          <h1 className="text-2xl font-black text-[#1F2A33]">Quote unavailable</h1>
          <p className="text-sm text-gray-600 mt-2">{error}</p>
        </div>
      </div>
    );
  }
  if (!quote) {
    return <div className="min-h-screen bg-[#1F2A33] flex items-center justify-center text-white"><Loader2 className="w-5 h-5 animate-spin mr-2"/> Loading…</div>;
  }

  const status = STATUS_COPY[quote.status] || STATUS_COPY.sent;
  const canDecide = quote.status === "sent";

  // Terminal states (accepted / rejected) get a centred narrow thank-you card
  if (quote.status === "accepted" || quote.status === "rejected") {
    const isAccepted = quote.status === "accepted";
    return (
      <div className="min-h-screen bg-[#F5F6F7] flex items-center justify-center px-4 py-10" data-testid="public-quote-page">
        <div className="w-full max-w-[480px] bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden">
          <header className="bg-[#1F2A33] text-white py-5 px-6 flex items-center justify-between">
            <div>
              <div className="brand-wordmark text-xl text-white leading-none">Paneltec</div>
              <div className="brand-wordmark text-xl text-[#F5C518] leading-none">Group</div>
            </div>
            <div className="text-right text-[10px] uppercase tracking-[0.22em] text-white/60">
              Quote · {quote.quote_number}
            </div>
          </header>
          <div className="p-8 text-center" data-testid="public-quote-status">
            <div className={`inline-flex items-center justify-center w-16 h-16 rounded-full mb-4 ${
              isAccepted ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
            }`}>
              {isAccepted ? (
                <svg className="w-9 h-9" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/>
                </svg>
              ) : (
                <svg className="w-9 h-9" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
                </svg>
              )}
            </div>
            <h1 className="text-2xl font-black tracking-tight text-[#1F2A33] mb-1">
              {isAccepted ? "Accepted — thank you!" : "Quote declined"}
            </h1>
            <p className="text-sm text-gray-500 mb-3">
              {isAccepted
                ? "We've received your acceptance and our team will be in touch shortly."
                : "We've recorded your decision. Reach out if you'd like to discuss alternatives."}
            </p>
            <div className="text-xs uppercase tracking-wider text-[#3A6B8C] font-bold mt-4">
              {isAccepted ? "Accepted on" : "Declined on"}
            </div>
            <div className="text-sm text-[#1F2A33] font-semibold">
              {formatDateTime(isAccepted ? quote.accepted_at : quote.rejected_at)}
            </div>
            <div className="mt-6 text-[10px] uppercase tracking-[0.18em] text-gray-400">
              Paneltec Group · Precast Panel Business Management
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F5F6F7]" data-testid="public-quote-page">
      <header className="bg-[#1F2A33] text-white py-6 px-4">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div>
            <div className="brand-wordmark text-2xl text-white leading-none">Paneltec</div>
            <div className="brand-wordmark text-2xl text-[#F5C518] leading-none">Group</div>
          </div>
          <div className="text-right text-xs uppercase tracking-[0.22em] text-white/60">
            Quote · {quote.quote_number}
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8 space-y-5">
        <div className={`rounded p-4 text-sm border ${
          status.tone === "green" ? "bg-green-50 border-green-200 text-green-800" :
          status.tone === "red" ? "bg-red-50 border-red-200 text-red-800" :
          status.tone === "amber" ? "bg-amber-50 border-amber-200 text-amber-800" :
          "bg-blue-50 border-blue-200 text-blue-800"
        }`} data-testid="public-quote-status">
          <div className="font-bold uppercase tracking-wider text-xs">{status.label}</div>
          {quote.status === "sent" && (
            <div className="text-xs mt-1">Valid until {quote.valid_until}</div>
          )}
          {quote.status === "accepted" && quote.accepted_at && (
            <div className="text-xs mt-1">Accepted {formatDateTime(quote.accepted_at)}</div>
          )}
          {quote.status === "rejected" && quote.rejected_at && (
            <div className="text-xs mt-1">Declined {formatDateTime(quote.rejected_at)}</div>
          )}
        </div>

        <section className="bg-white border border-gray-200 rounded p-6">
          <div className="overline mb-1">Prepared for</div>
          <div className="text-lg font-bold text-[#1F2A33]">{quote.customer?.company_name}</div>
        </section>

        <section className="bg-white border border-gray-200 rounded overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[#3A6B8C] text-white uppercase text-[10px] tracking-wider">
              <tr>
                <th className="px-3 py-2 text-left">Item</th>
                <th className="px-3 py-2 text-right">Qty</th>
                <th className="px-3 py-2 text-right">Total AUD</th>
              </tr>
            </thead>
            <tbody>
              {quote.line_items.map((l, i) => (
                <tr key={i} className="border-b border-gray-100">
                  <td className="px-3 py-3">
                    <div className="font-semibold text-[#1F2A33]">{l.description || l.panel_type_label}</div>
                    <div className="text-xs text-gray-500">{l.panel_type_label} · {l.length_m}×{l.height_m}×{l.thickness_mm}mm · {l.finish_label}</div>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">{l.quantity}</td>
                  <td className="px-3 py-3 text-right font-semibold tabular-nums">{formatAUD(l.total_aud)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-3 py-4 bg-gray-50 border-t border-gray-200">
            <div className="flex justify-between text-sm py-0.5"><span>Subtotal</span><span className="tabular-nums font-semibold">{formatAUD(quote.subtotal)}</span></div>
            <div className="flex justify-between text-sm py-0.5"><span>GST (10%)</span><span className="tabular-nums font-semibold">{formatAUD(quote.gst)}</span></div>
            <div className="flex justify-between text-base mt-2 pt-2 border-t border-gray-300">
              <span className="font-bold text-[#1F2A33]">Total inc GST</span>
              <span className="text-xl font-black text-[#1F2A33] tabular-nums" data-testid="public-quote-total">{formatAUD(quote.total)}</span>
            </div>
          </div>
        </section>

        {quote.notes_to_customer && (
          <section className="bg-white border border-gray-200 rounded p-6">
            <div className="overline mb-1">Notes</div>
            <p className="text-sm text-gray-700 whitespace-pre-wrap">{quote.notes_to_customer}</p>
          </section>
        )}

        {canDecide && (
          <section className="bg-[#1F2A33] rounded p-6 text-white">
            <h2 className="text-lg font-bold mb-1">Ready to proceed?</h2>
            <p className="text-sm text-white/70 mb-4">Your decision is recorded immediately. No login required.</p>
            {error && <div className="text-sm text-red-300 mb-3">{error}</div>}
            <div className="flex flex-col sm:flex-row gap-3">
              <button onClick={() => act("accept")} disabled={submitting}
                data-testid="public-accept-btn"
                className="flex-1 bg-[#F5C518] text-[#1F2A33] font-bold py-3 rounded hover:bg-[#E0B416] flex items-center justify-center transition-colors disabled:opacity-50">
                <Check className="w-4 h-4 mr-2"/> Accept quote
              </button>
              <button onClick={() => act("reject")} disabled={submitting}
                data-testid="public-reject-btn"
                className="flex-1 border border-white/30 text-white font-bold py-3 rounded hover:bg-white/10 flex items-center justify-center transition-colors disabled:opacity-50">
                <X className="w-4 h-4 mr-2"/> Decline
              </button>
            </div>
          </section>
        )}

        <div className="text-xs text-gray-500 flex items-center justify-center gap-1.5 pt-2">
          <AppIcon name="roles_permissions" size={14} decorative/> Secured by single-use Paneltec magic link
        </div>
      </main>
    </div>
  );
}
