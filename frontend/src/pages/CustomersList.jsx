import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus, Search, Loader2, Upload } from "lucide-react";
import { api, formatApiErrorDetail } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { formatDateTime } from "../lib/format";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "../components/ui/tooltip";

export default function CustomersList() {
  const [data, setData] = useState(null);
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState("true");
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  const load = async () => {
    try {
      const { data } = await api.get("/customers", { params: { search: search || undefined, active: activeFilter, page, page_size: 25 } });
      setData(data);
    } catch (e) {
      setError(formatApiErrorDetail(e.response?.data?.detail) || e.message);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [page, activeFilter]);

  const onSearchSubmit = (e) => { e.preventDefault(); setPage(1); load(); };

  return (
    <div className="max-w-6xl space-y-6" data-testid="customers-page">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <div className="overline">CRM</div>
          <h1 className="text-3xl md:text-4xl font-black tracking-tighter text-[#1F2A33]">Customers</h1>
          <p className="text-sm text-gray-500 mt-1">Search, manage and quote your customers.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button variant="outline" disabled data-testid="simpro-import-btn"
                    className="border-[#1F2A33] text-[#1F2A33] font-semibold h-11 px-5 opacity-50 cursor-not-allowed">
                    <Upload className="w-4 h-4 mr-2" /> Import from Simpro
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>MOCKED — available in Phase 4</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <Button onClick={() => navigate("/customers/new")} data-testid="new-customer-btn"
            className="bg-[#F5C518] text-[#1F2A33] font-bold hover:bg-[#E0B416] h-11 px-6">
            <Plus className="w-4 h-4 mr-2" /> New customer
          </Button>
        </div>
      </div>

      <form onSubmit={onSearchSubmit} className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search company, contact, ABN…" className="pl-9 h-10"
            data-testid="customers-search-input" />
        </div>
        <Button type="submit" variant="outline" data-testid="customers-search-btn">Search</Button>
        <Select value={activeFilter} onValueChange={(v) => { setActiveFilter(v); setPage(1); }}>
          <SelectTrigger className="w-44 h-10" data-testid="customers-active-filter"><SelectValue/></SelectTrigger>
          <SelectContent>
            <SelectItem value="true">Active only</SelectItem>
            <SelectItem value="false">Inactive only</SelectItem>
            <SelectItem value="all">Show all</SelectItem>
          </SelectContent>
        </Select>
      </form>

      {error && <div className="text-sm text-red-700">{error}</div>}

      <section className="bg-white border border-gray-200 rounded overflow-hidden">
        {!data ? (
          <div className="p-6 flex items-center gap-2 text-gray-500 text-sm"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
        ) : data.items.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500">No customers yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[#3A6B8C] text-white uppercase text-[10px] tracking-wider">
                <tr>
                  <th className="px-4 py-3 text-left">Company</th>
                  <th className="px-4 py-3 text-left">ABN</th>
                  <th className="px-4 py-3 text-left">Contact</th>
                  <th className="px-4 py-3 text-left">State</th>
                  <th className="px-4 py-3 text-left">Created</th>
                  <th className="px-4 py-3 text-left">Status</th>
                </tr>
              </thead>
              <tbody data-testid="customers-table-body">
                {data.items.map((c) => (
                  <tr key={c.id} className="border-t border-gray-200 hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <Link to={`/customers/${c.id}`} className="font-semibold text-[#1F2A33] hover:text-[#3A6B8C]"
                        data-testid={`customer-link-${c.id}`}>{c.company_name}</Link>
                    </td>
                    <td className="px-4 py-3 text-gray-700 tabular-nums">{c.abn || "—"}</td>
                    <td className="px-4 py-3 text-gray-700">{c.contact_name}<div className="text-xs text-gray-500">{c.contact_email}</div></td>
                    <td className="px-4 py-3 text-gray-700">{c.billing_address?.state || "—"}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">{formatDateTime(c.created_at)}</td>
                    <td className="px-4 py-3">
                      <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${c.active ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-500"}`}>
                        {c.active ? "Active" : "Inactive"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.total > data.page_size && (
              <div className="flex justify-between items-center px-4 py-3 border-t border-gray-200 text-sm text-gray-600">
                <span>Page {data.page} of {Math.ceil(data.total / data.page_size)} · {data.total} total</span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Prev</Button>
                  <Button variant="outline" size="sm" disabled={page * data.page_size >= data.total} onClick={() => setPage(p => p + 1)}>Next</Button>
                </div>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
