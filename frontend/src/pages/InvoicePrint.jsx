import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Loader2, Printer } from "lucide-react";
import AppIcon from "../components/AppIcon";
import { api } from "../lib/api";
import { formatAUD } from "../lib/format";

export default function InvoicePrint() {
  const { id } = useParams();
  const [inv, setInv] = useState(null);
  const [customer, setCustomer] = useState(null);
  const [company, setCompany] = useState(null);

  useEffect(() => {
    (async () => {
      const [{ data: i }, { data: c }] = await Promise.all([
        api.get(`/invoices/${id}`),
        api.get(`/settings/company`),
      ]);
      setInv(i);
      const { data: cust } = await api.get(`/customers/${i.customer_id}`);
      setCustomer(cust); setCompany(c);
      setTimeout(() => window.print(), 400);
    })();
  }, [id]);

  if (!inv || !customer || !company) return <div className="p-8 flex items-center gap-2 text-gray-500"><Loader2 className="w-4 h-4 animate-spin"/> Preparing print…</div>;

  return (
    <div className="min-h-screen bg-white text-[#1F2A33]" data-testid="invoice-print-page">
      <button onClick={() => window.print()} className="no-print fixed top-4 right-4 bg-[#1F2A33] text-white text-xs font-bold uppercase tracking-wider px-3 py-2 rounded">
        <AppIcon name="print" size={14} className="mr-1" decorative/> Print
      </button>
      <div className="max-w-3xl mx-auto p-10 print-container">
        <header className="flex items-start justify-between border-b-4 border-[#1F2A33] pb-4 mb-6">
          <div>
            <div className="brand-wordmark text-3xl text-[#1F2A33] leading-none">Paneltec</div>
            <div className="brand-wordmark text-3xl text-[#F5C518] leading-none">Group</div>
            <div className="mt-2 text-[10px] uppercase tracking-[0.22em] text-gray-500">{company.business_name}</div>
            <div className="mt-1 text-xs text-gray-600">
              {company.address_street}<br/>
              {company.address_suburb} {company.address_state} {company.address_postcode}<br/>
              {company.phone} · {company.email}
            </div>
            {company.abn ? (
              <div className="mt-1 text-xs text-gray-600">ABN: {company.abn}</div>
            ) : (
              <div className="mt-1 text-xs text-red-600 font-bold" data-testid="abn-missing">
                ABN: [Set in Company Settings]
              </div>
            )}
          </div>
          <div className="text-right">
            <div className="text-2xl font-black uppercase tracking-wider text-[#1F2A33]">TAX INVOICE</div>
            <div className="mt-3 text-2xl font-black tabular-nums">{inv.invoice_number}</div>
            <div className="text-xs text-gray-500 mt-1">Issue: {inv.issue_date}</div>
            <div className="text-xs text-gray-500">Due: {inv.due_date}</div>
          </div>
        </header>

        <section className="grid grid-cols-2 gap-6 mb-6 text-sm">
          <div>
            <div className="overline mb-1">Bill to</div>
            <div className="font-bold">{customer.company_name}</div>
            <div className="text-gray-700">{customer.contact_name}</div>
            {customer.abn && <div className="text-gray-500">ABN {customer.abn}</div>}
            <div className="text-gray-500 mt-1 text-xs">
              {customer.billing_address?.street}<br/>
              {customer.billing_address?.suburb} {customer.billing_address?.state} {customer.billing_address?.postcode}
            </div>
          </div>
          <div>
            <div className="overline mb-1">Site</div>
            <div className="text-gray-700 text-xs">
              {customer.site_address?.street}<br/>
              {customer.site_address?.suburb} {customer.site_address?.state} {customer.site_address?.postcode}
            </div>
            <div className="overline mt-3 mb-1">References</div>
            <div className="text-xs text-gray-600">Quote: {inv.quote_number}</div>
            <div className="text-xs text-gray-600">Job: {inv.job_number}</div>
          </div>
        </section>

        <table className="w-full text-sm border-t border-b border-[#1F2A33] mb-4">
          <thead className="bg-[#1F2A33] text-white uppercase text-[10px] tracking-wider">
            <tr>
              <th className="px-2 py-2 text-left">Description</th>
              <th className="px-2 py-2 text-left">Panel</th>
              <th className="px-2 py-2 text-right">Qty</th>
              <th className="px-2 py-2 text-right">Unit AUD</th>
              <th className="px-2 py-2 text-right">Line Total AUD</th>
            </tr>
          </thead>
          <tbody>
            {inv.line_items.map(l => (
              <tr key={l.id} className="border-b border-gray-200">
                <td className="px-2 py-2">{l.description || l.panel_type_label}</td>
                <td className="px-2 py-2 text-gray-700">{l.panel_type_label}<div className="text-[10px] text-gray-500">{l.length_m}×{l.height_m}×{l.thickness_mm}mm</div></td>
                <td className="px-2 py-2 text-right tabular-nums">{l.quantity}</td>
                <td className="px-2 py-2 text-right tabular-nums">{formatAUD(l.total_aud / l.quantity)}</td>
                <td className="px-2 py-2 text-right tabular-nums font-semibold">{formatAUD(l.total_aud)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="flex justify-end mb-6">
          <table className="text-sm">
            <tbody>
              <tr><td className="text-gray-600 pr-6">Subtotal</td><td className="text-right tabular-nums font-semibold">{formatAUD(inv.subtotal)}</td></tr>
              <tr><td className="text-gray-600 pr-6">GST (10%)</td><td className="text-right tabular-nums font-semibold">{formatAUD(inv.gst)}</td></tr>
              <tr className="border-t-2 border-[#1F2A33]"><td className="text-[#1F2A33] font-bold pr-6 pt-1">Total Due AUD</td><td className="text-right tabular-nums text-xl font-black pt-1">{formatAUD(inv.total)}</td></tr>
            </tbody>
          </table>
        </div>

        <section className="bg-gray-50 border border-gray-300 rounded p-4 mb-6">
          <div className="overline mb-2">Payment — EFT</div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div><span className="text-gray-500">Bank:</span> <span className="font-semibold">{company.bank_name || "—"}</span></div>
            <div><span className="text-gray-500">Account name:</span> <span className="font-semibold">{company.account_name || "—"}</span></div>
            <div><span className="text-gray-500">BSB:</span> <span className="font-mono tabular-nums">{company.bsb || "—"}</span></div>
            <div><span className="text-gray-500">Account number:</span> <span className="font-mono tabular-nums">{company.account_number || "—"}</span></div>
            <div className="col-span-2"><span className="text-gray-500">Reference:</span> <span className="font-bold">{inv.invoice_number}</span></div>
            <div className="col-span-2 text-xs text-gray-600">Payment terms: Net {company.default_payment_terms_days} days · Due: {inv.due_date}</div>
          </div>
        </section>

        {company.invoice_footer_note && (
          <footer className="border-t pt-3 mt-6 text-xs text-gray-600 text-center italic">
            {company.invoice_footer_note}
          </footer>
        )}
      </div>
    </div>
  );
}
