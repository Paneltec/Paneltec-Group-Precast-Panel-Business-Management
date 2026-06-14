import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Loader2, Printer } from "lucide-react";
import { api } from "../lib/api";
import { formatAUD, formatNumber, formatDateTime } from "../lib/format";

export default function QuotePrint() {
  const { id } = useParams();
  const [quote, setQuote] = useState(null);
  const [customer, setCustomer] = useState(null);

  useEffect(() => {
    (async () => {
      const { data } = await api.get(`/quotes/${id}`);
      setQuote(data);
      const { data: c } = await api.get(`/customers/${data.customer_id}`);
      setCustomer(c);
      setTimeout(() => window.print(), 400);
    })();
  }, [id]);

  if (!quote || !customer) return <div className="p-8 flex items-center gap-2 text-gray-500"><Loader2 className="w-4 h-4 animate-spin"/> Preparing print…</div>;

  return (
    <div className="min-h-screen bg-white text-[#1F2A33]" data-testid="quote-print-page">
      <button onClick={() => window.print()} className="no-print fixed top-4 right-4 bg-[#1F2A33] text-white text-xs font-bold uppercase tracking-wider px-3 py-2 rounded">
        <Printer className="w-3.5 h-3.5 inline mr-1"/> Print
      </button>
      <div className="max-w-3xl mx-auto p-10 print-container">
        <header className="flex items-start justify-between border-b-4 border-[#1F2A33] pb-4 mb-6">
          <div>
            <div className="brand-wordmark text-3xl text-[#1F2A33] leading-none">Paneltec</div>
            <div className="brand-wordmark text-3xl text-[#F5C518] leading-none">Group</div>
            <div className="mt-2 text-[10px] uppercase tracking-[0.22em] text-gray-500">Precast Panel Business Management</div>
          </div>
          <div className="text-right">
            <div className="text-xs uppercase tracking-wider text-gray-500 font-bold">Quote</div>
            <div className="text-2xl font-black tabular-nums">{quote.quote_number}</div>
            <div className="text-xs text-gray-500">Valid until {quote.valid_until}</div>
            <div className="text-xs text-gray-500">Issued {formatDateTime(quote.created_at)}</div>
          </div>
        </header>

        <section className="grid grid-cols-2 gap-6 mb-6 text-sm">
          <div>
            <div className="overline mb-1">Quoted to</div>
            <div className="font-bold">{customer.company_name}</div>
            <div className="text-gray-700">{customer.contact_name}</div>
            <div className="text-gray-700">{customer.contact_email}</div>
            {customer.abn && <div className="text-gray-500 mt-1">ABN {customer.abn}</div>}
            <div className="text-gray-500 mt-2 text-xs">
              {customer.billing_address?.street}<br/>
              {customer.billing_address?.suburb} {customer.billing_address?.state} {customer.billing_address?.postcode}
            </div>
          </div>
          <div>
            <div className="overline mb-1">From</div>
            <div className="font-bold">Paneltec Group</div>
            <div className="text-gray-700">ABN ## ### ### ###</div>
            <div className="text-gray-500 mt-2 text-xs">Australia · admin@paneltec.com.au</div>
            <div className="overline mt-3 mb-1">Status</div>
            <div className="font-bold uppercase">{quote.status}</div>
          </div>
        </section>

        <table className="w-full text-sm border-t border-b border-[#1F2A33] mb-4">
          <thead className="bg-[#1F2A33] text-white uppercase text-[10px] tracking-wider">
            <tr>
              <th className="px-2 py-2 text-left">Description</th>
              <th className="px-2 py-2 text-left">Panel</th>
              <th className="px-2 py-2 text-right">L × H × thk</th>
              <th className="px-2 py-2 text-right">Qty</th>
              <th className="px-2 py-2 text-right">Total AUD</th>
            </tr>
          </thead>
          <tbody>
            {quote.line_items.map(l => (
              <tr key={l.id} className="border-b border-gray-200">
                <td className="px-2 py-2">{l.description || "—"}</td>
                <td className="px-2 py-2 text-gray-700">{l.panel_type_label}<div className="text-[10px] text-gray-500">{l.finish_label}</div></td>
                <td className="px-2 py-2 text-right tabular-nums text-gray-700">{l.length_m} × {l.height_m} × {l.thickness_mm}mm</td>
                <td className="px-2 py-2 text-right tabular-nums">{l.quantity}</td>
                <td className="px-2 py-2 text-right tabular-nums font-semibold">{formatAUD(l.total_aud)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="flex justify-end mb-6">
          <table className="text-sm">
            <tbody>
              <tr><td className="text-gray-600 pr-6">Subtotal</td><td className="text-right tabular-nums font-semibold">{formatAUD(quote.subtotal)}</td></tr>
              <tr><td className="text-gray-600 pr-6">GST (10%)</td><td className="text-right tabular-nums font-semibold">{formatAUD(quote.gst)}</td></tr>
              <tr className="border-t-2 border-[#1F2A33]"><td className="text-[#1F2A33] font-bold pr-6 pt-1">Total inc GST</td><td className="text-right tabular-nums text-xl font-black pt-1">{formatAUD(quote.total)}</td></tr>
              <tr><td colSpan={2} className="text-right text-[10px] uppercase tracking-wider text-gray-500 pt-1">Volume {formatNumber(quote.total_volume_m3,3)} m³ · {formatNumber(quote.total_weight_tonnes,3)} t</td></tr>
            </tbody>
          </table>
        </div>

        {quote.notes_to_customer && (
          <section className="mb-6 text-sm">
            <div className="overline mb-1">Notes</div>
            <p className="text-gray-700 whitespace-pre-wrap">{quote.notes_to_customer}</p>
          </section>
        )}

        <footer className="border-t pt-3 mt-8 text-[10px] uppercase tracking-wider text-gray-500 text-center">
          Paneltec Group · Precast Panel Business Management · This quote is valid until {quote.valid_until}
        </footer>
      </div>
    </div>
  );
}
