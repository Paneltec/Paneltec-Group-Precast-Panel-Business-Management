import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Loader2, Printer } from "lucide-react";
import { api } from "../lib/api";
import { formatAUD, formatDateTime } from "../lib/format";

export default function ProjectPrint() {
  const { id } = useParams();
  const [data, setData] = useState(null);

  useEffect(() => {
    (async () => {
      const { data: p } = await api.get(`/projects/${id}`);
      const [{ data: c }, { data: company }, { data: qs }, { data: js }, { data: is }] = await Promise.all([
        api.get(`/customers/${p.customer_id}`),
        api.get(`/settings/company`),
        api.get(`/quotes`, { params: { customer_id: p.customer_id, page_size: 50 } }),
        api.get(`/jobs`, { params: { customer_id: p.customer_id, page_size: 50 } }),
        api.get(`/invoices`, { params: { customer_id: p.customer_id, page_size: 50 } }),
      ]);
      const quotes = qs.items.filter(q => q.project_id === id);
      const jobs = js.items.filter(j => j.project_id === id);
      const invoices = is.items.filter(i => i.project_id === id);
      setData({ p, c, company, quotes, jobs, invoices });
      setTimeout(() => window.print(), 400);
    })();
  }, [id]);

  if (!data) return <div className="p-8 flex items-center gap-2 text-gray-500"><Loader2 className="w-4 h-4 animate-spin"/> Preparing print…</div>;
  const { p, c, company, quotes, jobs, invoices } = data;

  return (
    <div className="min-h-screen bg-white text-[#1F2A33]" data-testid="project-print-page">
      <button onClick={() => window.print()} className="no-print fixed top-4 right-4 bg-[#1F2A33] text-white text-xs font-bold uppercase tracking-wider px-3 py-2 rounded">
        <Printer className="w-3.5 h-3.5 inline mr-1"/> Print
      </button>
      <div className="max-w-3xl mx-auto p-10 print-container">
        <header className="flex items-start justify-between border-b-4 border-[#1F2A33] pb-4 mb-6">
          <div>
            <div className="brand-wordmark text-3xl text-[#1F2A33] leading-none">Paneltec</div>
            <div className="brand-wordmark text-3xl text-[#F5C518] leading-none">Group</div>
            <div className="mt-2 text-[10px] uppercase tracking-[0.22em] text-gray-500">{company.business_name} · ABN {company.abn || "—"}</div>
          </div>
          <div className="text-right">
            <div className="text-xl font-black uppercase tracking-wider">Project Overview</div>
            <div className="text-xs text-gray-500">Generated {formatDateTime(new Date().toISOString())}</div>
          </div>
        </header>

        <section className="mb-6">
          <div className="overline mb-1">Customer</div>
          <div className="font-bold text-lg">{c.company_name}</div>
          <div className="text-xs text-gray-600">{c.contact_name} · {c.contact_email}</div>
        </section>

        <section className="bg-gray-50 border border-gray-300 rounded p-4 mb-6">
          <div className="overline mb-1">Project</div>
          <h2 className="text-2xl font-black">{p.project_name}</h2>
          <div className="text-xs text-gray-500 uppercase tracking-wider mt-1">Status: {p.status}</div>
          {p.site_address && (
            <div className="mt-2 text-sm text-gray-700">
              {p.site_address.street}, {p.site_address.suburb} {p.site_address.state} {p.site_address.postcode}
            </div>
          )}
          {p.description && <p className="mt-3 text-sm text-gray-700 whitespace-pre-wrap">{p.description}</p>}
        </section>

        <PrintTable title="Quotes" rows={quotes} cols={[
          { h: "Quote #", k: "quote_number", mono: true },
          { h: "Status", k: "status", upper: true },
          { h: "Valid until", k: "valid_until", mono: true },
          { h: "Total AUD", k: "total", money: true, right: true },
        ]}/>
        <PrintTable title="Jobs" rows={jobs} cols={[
          { h: "Job #", k: "job_number", mono: true },
          { h: "Status", k: "status", upper: true },
          { h: "Production", k: "scheduled_production_date" },
          { h: "Delivery", k: "scheduled_delivery_date" },
          { h: "Total AUD", k: "total", money: true, right: true },
        ]}/>
        <PrintTable title="Invoices" rows={invoices} cols={[
          { h: "Invoice #", k: "invoice_number", mono: true },
          { h: "Status", k: "status", upper: true },
          { h: "Due", k: "due_date", mono: true },
          { h: "Total AUD", k: "total", money: true, right: true },
        ]}/>

        <footer className="border-t pt-3 mt-6 text-[10px] uppercase tracking-wider text-gray-500 text-center">
          {company.business_name} · {company.phone} · ABN {company.abn || "—"}
        </footer>
      </div>
    </div>
  );
}

function PrintTable({ title, rows, cols }) {
  return (
    <section className="mb-6">
      <div className="overline mb-2">{title}</div>
      {rows.length === 0 ? <div className="text-xs text-gray-500">None.</div> : (
        <table className="w-full text-xs border-t border-b border-[#1F2A33]">
          <thead className="bg-[#1F2A33] text-white uppercase text-[9px] tracking-wider">
            <tr>{cols.map(c => <th key={c.h} className={`px-2 py-1.5 ${c.right ? "text-right" : "text-left"}`}>{c.h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-gray-200">
                {cols.map(c => {
                  const v = r[c.k];
                  let display = v == null ? "—" : c.money ? formatAUD(v) : String(v);
                  return (
                    <td key={c.h} className={`px-2 py-1.5 ${c.right ? "text-right" : ""} ${c.mono ? "tabular-nums" : ""} ${c.upper ? "uppercase" : ""}`}>{display}</td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
