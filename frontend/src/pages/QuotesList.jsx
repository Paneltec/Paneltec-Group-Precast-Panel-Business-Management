import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus, Search, Loader2 } from "lucide-react";
import AppIcon from "../components/AppIcon";
import { api, formatApiErrorDetail } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { formatAUD, formatDateTime } from "../lib/format";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import DeleteRowActions from "../components/DeleteRowActions";
import { useAuth } from "../contexts/AuthContext";

const STATUS_ICON = {
  draft:"quote_status_draft", sent:"quote_status_sent",
  accepted:"quote_status_accepted", rejected:"quote_status_rejected",
  expired:"quote_status_expired",
};

const STATUS_STYLES = {
  draft: "bg-gray-100 text-gray-700",
  sent: "bg-blue-100 text-blue-800",
  accepted: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-700",
  expired: "bg-amber-100 text-amber-800",
};

export default function QuotesList() {
  const [data, setData] = useState(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [lifecycleFilter, setLifecycleFilter] = useState("active");
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const navigate = useNavigate();
  const { hasPerm, isSuperAdmin } = useAuth();
  const canDelete = hasPerm("quotes.delete");

  const load = async () => {
    try {
      const params = { page, page_size: 25, lifecycle: lifecycleFilter };
      if (search) params.search = search;
      if (statusFilter && statusFilter !== "all") params.status = statusFilter;
      const { data } = await api.get("/quotes", { params });
      setData(data);
    } catch (e) {
      setError(formatApiErrorDetail(e.response?.data?.detail) || e.message);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [page, statusFilter, lifecycleFilter]);

  return (
    <div className="max-w-6xl space-y-6" data-testid="quotes-page">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <div className="overline">Sales</div>
          <h1 className="text-3xl md:text-4xl font-black tracking-tighter text-[#1F2A33]">Quotes</h1>
          <p className="text-sm text-gray-500 mt-1">Build, send and track precast quotes.</p>
        </div>
        <Button onClick={() => navigate("/quotes/new")} data-testid="new-quote-btn"
          className="bg-[#F5C518] text-[#1F2A33] font-bold hover:bg-[#E0B416] h-11 px-6">
          <AppIcon name="add" size={16} className="mr-1" decorative/> New quote
        </Button>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <form onSubmit={(e) => { e.preventDefault(); setPage(1); load(); }} className="flex gap-2 flex-1 max-w-md">
          <div className="relative flex-1">
            <AppIcon name="search" size={16} decorative/>
            <Input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Q-2026-…" className="pl-9 h-10" data-testid="quotes-search-input"/>
          </div>
          <Button type="submit" variant="outline" data-testid="quotes-search-btn">Search</Button>
        </form>
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
          <SelectTrigger className="w-44 h-10" data-testid="quotes-status-filter"><SelectValue/></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="sent">Sent</SelectItem>
            <SelectItem value="accepted">Accepted</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
            <SelectItem value="expired">Expired</SelectItem>
          </SelectContent>
        </Select>
        <Select value={lifecycleFilter} onValueChange={(v) => { setLifecycleFilter(v); setPage(1); }}>
          <SelectTrigger className="w-40 h-10" data-testid="lifecycle-filter"><SelectValue/></SelectTrigger>
          <SelectContent>
            <SelectItem value="active" data-testid="lifecycle-filter-active">Active</SelectItem>
            <SelectItem value="deleted" data-testid="lifecycle-filter-deleted">Deleted</SelectItem>
            <SelectItem value="all" data-testid="lifecycle-filter-all">All</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {error && <div className="text-sm text-red-700">{error}</div>}

      <section className="bg-white border border-gray-200 rounded overflow-hidden">
        {!data ? (
          <div className="p-6 flex items-center gap-2 text-gray-500 text-sm"><Loader2 className="w-4 h-4 animate-spin"/> Loading…</div>
        ) : data.items.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500" data-testid="quotes-empty">No quotes match your filter.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[#3A6B8C] text-white uppercase text-[10px] tracking-wider">
                <tr>
                  <th className="px-4 py-3 text-left">Quote #</th>
                  <th className="px-4 py-3 text-left">Customer</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Valid until</th>
                  <th className="px-4 py-3 text-right">Lines</th>
                  <th className="px-4 py-3 text-right">Total</th>
                  <th className="px-4 py-3 text-right">Created</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody data-testid="quotes-table-body">
                {data.items.map((q) => {
                  const isDeleted = !!q.deleted_at;
                  return (
                    <tr key={q.id} className={`border-t border-gray-200 hover:bg-gray-50 ${isDeleted ? "opacity-60" : ""}`}
                        data-testid={`quote-row-${q.id}`}>
                      <td className="px-4 py-3">
                        <Link to={`/quotes/${q.id}`} className="font-semibold text-[#1F2A33] hover:text-[#3A6B8C] tabular-nums"
                          data-testid={`quote-link-${q.quote_number}`}>{q.quote_number}</Link>
                        {isDeleted && (
                          <span className="ml-2 text-[10px] font-bold uppercase tracking-wider bg-red-100 text-red-800 px-1.5 py-0.5 rounded"
                                data-testid={`deleted-badge-${q.id}`}>deleted</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-700">{q.customer_company_name}</td>
                      <td className="px-4 py-3">
                        <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded inline-flex items-center gap-1 ${STATUS_STYLES[q.status] || "bg-gray-100"}`}><AppIcon name={STATUS_ICON[q.status]} size={14} decorative/>{q.status}</span>
                      </td>
                      <td className="px-4 py-3 text-gray-700 tabular-nums">{q.valid_until}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{q.line_items?.length || 0}</td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums">{formatAUD(q.total)}</td>
                      <td className="px-4 py-3 text-right text-xs text-gray-500">{formatDateTime(q.created_at)}</td>
                      <td className="px-4 py-3 text-right">
                        <DeleteRowActions entity="quotes" row={q}
                          label={(r) => r.quote_number}
                          canDelete={canDelete} isSuperAdmin={isSuperAdmin}
                          onChanged={load} />
                      </td>
                    </tr>
                  );
                })}
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
