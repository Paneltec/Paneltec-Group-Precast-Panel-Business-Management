import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, Search } from "lucide-react";
import { api, formatApiErrorDetail } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { formatAUD, formatDateTime } from "../lib/format";

const STATUS_STYLES = {
  draft:"bg-gray-100 text-gray-700",issued:"bg-blue-100 text-blue-800",
  paid:"bg-green-100 text-green-800",overdue:"bg-red-100 text-red-700",
  cancelled:"bg-gray-200 text-gray-500",
};

export default function InvoicesList() {
  const [data, setData] = useState(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");

  const load = async () => {
    try {
      const params = { page, page_size: 25 };
      if (search) params.search = search;
      if (statusFilter && statusFilter !== "all") params.status = statusFilter;
      const { data } = await api.get("/invoices", { params });
      setData(data);
    } catch (e) { setError(formatApiErrorDetail(e.response?.data?.detail) || e.message); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [page, statusFilter]);

  return (
    <div className="max-w-6xl space-y-6" data-testid="invoices-page">
      <div>
        <div className="overline">Billing</div>
        <h1 className="text-3xl md:text-4xl font-black tracking-tighter text-[#1F2A33]">Invoices</h1>
        <p className="text-sm text-gray-500 mt-1">Generated from delivered jobs. AU Tax Invoice format.</p>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <form onSubmit={(e) => { e.preventDefault(); setPage(1); load(); }} className="flex gap-2 flex-1 max-w-md">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/>
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="INV-2026-…" className="pl-9 h-10" data-testid="invoices-search-input"/>
          </div>
          <Button type="submit" variant="outline">Search</Button>
        </form>
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
          <SelectTrigger className="w-44 h-10" data-testid="invoices-status-filter"><SelectValue/></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {Object.keys(STATUS_STYLES).map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {error && <div className="text-sm text-red-700">{error}</div>}

      <section className="bg-white border border-gray-200 rounded overflow-hidden">
        {!data ? <div className="p-6 flex items-center gap-2 text-gray-500 text-sm"><Loader2 className="w-4 h-4 animate-spin"/> Loading…</div> :
         data.items.length === 0 ? <div className="p-8 text-center text-sm text-gray-500">No invoices yet.</div> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[#3A6B8C] text-white uppercase text-[10px] tracking-wider">
                <tr>
                  <th className="px-4 py-3 text-left">Invoice #</th>
                  <th className="px-4 py-3 text-left">Customer</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Issue date</th>
                  <th className="px-4 py-3 text-left">Due date</th>
                  <th className="px-4 py-3 text-right">Total</th>
                  <th className="px-4 py-3 text-right">Created</th>
                </tr>
              </thead>
              <tbody data-testid="invoices-table-body">
                {data.items.map(i => (
                  <tr key={i.id} className="border-t border-gray-200 hover:bg-gray-50">
                    <td className="px-4 py-3"><Link to={`/invoices/${i.id}`} className="font-semibold text-[#1F2A33] hover:text-[#3A6B8C] tabular-nums" data-testid={`invoice-link-${i.invoice_number}`}>{i.invoice_number}</Link></td>
                    <td className="px-4 py-3 text-gray-700">{i.customer_company_name}</td>
                    <td className="px-4 py-3"><span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${STATUS_STYLES[i.status]}`}>{i.status}</span></td>
                    <td className="px-4 py-3 tabular-nums text-gray-700">{i.issue_date || "—"}</td>
                    <td className="px-4 py-3 tabular-nums text-gray-700">{i.due_date || "—"}</td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums">{formatAUD(i.total)}</td>
                    <td className="px-4 py-3 text-right text-xs text-gray-500">{formatDateTime(i.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
