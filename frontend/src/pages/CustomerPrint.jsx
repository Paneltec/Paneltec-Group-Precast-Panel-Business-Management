import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Loader2, Printer } from "lucide-react";
import { api } from "../lib/api";
import { formatAUD, formatDateTime } from "../lib/format";

export default function CustomerPrint() {
  const { id } = useParams();
  const [data, setData] = useState(null);

  useEffect(() => {
    (async () => {
      const [{ data: c }, { data: company }, { data: quotes }, { data: invoices }] = await Promise.all([
        api.get(`/customers/${id}`),
        api.get(`/settings/company`),
        api.get(`/quotes`, { params: { customer_id: id, page_size: 10 } }),
        api.get(`/invoices`, { params: { customer_id: id, page_size: 10 } }),
      ]);
      setData({ c, company, quotes: quotes.items, invoices: invoices.items });
      setTimeout(() => window.print(), 400);
    })();
  }, [id]);

  if (!data) return <div className="p-8 flex items-center gap-2 text-gray-500"><Loader2 className="w-4 h-4 animate-spin"/> Preparing print…</div>;
  const { c, company, quotes, invoices } = data;

  return (
    <div className="min-h-screen bg-white text-[#1F2A33]" data-testid="customer-print-page">
      <button onClick={() => window.print()} className="no-print fixed top-4 right-4 bg-[#1F2A33] text-white text-xs font-bold uppercase tracking-wider px-3 py-2 rounded">
        <Printer className="w-3.5 h-3.5 inline mr-1"/> Print
      </button>
      <div className="max-w-3xl mx-auto p-10 print-container">
        <header className="flex items-start justify-between border-b-4 border-[#1F2A33] pb-4 mb-6">
          <div>
            <div className="brand-wordmark text-3xl text-[#1F2A33] leading-none">Paneltec</div>
            <div className="brand-wordmark text-3xl text-[#F5C518] leading-none">Group</div>
            <div className="mt-2 text-[10px] uppercase tracking-[0.22em] text-gray-500">{company.business_name} · ABN: {company.abn || "—"}</div>
          </div>
          <div className="text-right">
            <div className="text-xl font-black uppercase tracking-wider">Customer Summary</div>
            <div className="text-xs text-gray-500">Generated {formatDateTime(new Date().toISOString())}</div>
          </div>
        </header>

        <section className="mb-6">
          <h2 className="text-2xl font-black text-[#1F2A33]">{c.company_name}</h2>
          {c.abn && <div className="text-sm text-gray-600">ABN: <span className="tabular-nums">{c.abn}</span></div>}
          <div className="mt-3 grid grid-cols-2 gap-4 text-sm">
            <div>
              <div className="overline mb-1">Primary contact</div>
              <div className="font-semibold">{c.contact_name || "—"}</div>
              <div className="text-gray-700">{c.contact_email}</div>
              <div className="text-gray-700">{c.contact_phone || "—"}</div>
            </div>
            <div>
              <div className="overline mb-1">Account terms</div>
              <div className="text-gray-700">{c.account_terms || "—"}</div>
            </div>
          </div>
        </section>

        <section className="grid grid-cols-2 gap-6 mb-6 text-sm">
          <div>
            <div className="overline mb-1">Billing address</div>
            <div className="text-gray-700 text-xs">
              {c.billing_address?.street}<br/>
              {c.billing_address?.suburb} {c.billing_address?.state} {c.billing_address?.postcode}
            </div>
          </div>
          <div>
            <div className="overline mb-1">Site address</div>
            <div className="text-gray-700 text-xs">
              {c.site_address?.street}<br/>
              {c.site_address?.suburb} {c.site_address?.state} {c.site_address?.postcode}
            </div>
          </div>
        </section>

        {c.notes && (
          <section className="mb-6">
            <div className="overline mb-1">Notes</div>
            <p className="text-xs text-gray-700 whitespace-pre-wrap">{c.notes}</p>
          </section>
        )}

        <section className="mb-6">
          <div className="overline mb-2">Recent quotes</div>
          {quotes.length === 0 ? <div className="text-xs text-gray-500">No quotes yet.</div> : (
            <table className="w-full text-xs border-t border-b border-[#1F2A33]">
              <thead className="bg-[#1F2A33] text-white uppercase text-[9px] tracking-wider">
                <tr><th className="px-2 py-1.5 text-left">Quote #</th><th className="px-2 py-1.5 text-left">Status</th><th className="px-2 py-1.5 text-right">Valid until</th><th className="px-2 py-1.5 text-right">Total AUD</th></tr>
              </thead>
              <tbody>
                {quotes.map(q => (
                  <tr key={q.id} className="border-b border-gray-200">
                    <td className="px-2 py-1.5 tabular-nums">{q.quote_number}</td>
                    <td className="px-2 py-1.5 uppercase">{q.status}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{q.valid_until}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums font-semibold">{formatAUD(q.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="mb-6">
          <div className="overline mb-2">Recent invoices</div>
          {invoices.length === 0 ? <div className="text-xs text-gray-500">No invoices yet.</div> : (
            <table className="w-full text-xs border-t border-b border-[#1F2A33]">
              <thead className="bg-[#1F2A33] text-white uppercase text-[9px] tracking-wider">
                <tr><th className="px-2 py-1.5 text-left">Invoice #</th><th className="px-2 py-1.5 text-left">Status</th><th className="px-2 py-1.5 text-right">Due</th><th className="px-2 py-1.5 text-right">Total AUD</th></tr>
              </thead>
              <tbody>
                {invoices.map(i => (
                  <tr key={i.id} className="border-b border-gray-200">
                    <td className="px-2 py-1.5 tabular-nums">{i.invoice_number}</td>
                    <td className="px-2 py-1.5 uppercase">{i.status}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{i.due_date}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums font-semibold">{formatAUD(i.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <footer className="border-t pt-3 mt-6 text-[10px] uppercase tracking-wider text-gray-500 text-center">
          {company.business_name} · {company.phone} · {company.email} · ABN {company.abn || "—"}
        </footer>
      </div>
    </div>
  );
}
