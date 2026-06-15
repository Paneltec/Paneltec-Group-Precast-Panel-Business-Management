import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, Search } from "lucide-react";
import AppIcon from "../components/AppIcon";
import { api, formatApiErrorDetail } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { formatAUD, formatDateTime } from "../lib/format";
import DeleteRowActions from "../components/DeleteRowActions";
import { useAuth } from "../contexts/AuthContext";

const STATUS_ICON = {
  scheduled:"job_status_scheduled", in_production:"job_status_in_production",
  ready_for_delivery:"job_status_ready_for_delivery", delivered:"job_status_delivered",
  installed:"job_status_installed", completed:"job_status_completed",
  cancelled:"job_status_cancelled",
};

const STATUS_STYLES = {
  scheduled: "bg-gray-100 text-gray-700",
  in_production: "bg-blue-100 text-blue-800",
  ready_for_delivery: "bg-amber-100 text-amber-800",
  delivered: "bg-cyan-100 text-cyan-800",
  installed: "bg-violet-100 text-violet-800",
  completed: "bg-green-100 text-green-800",
  cancelled: "bg-red-100 text-red-700",
};

export default function JobsList() {
  const [data, setData] = useState(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [lifecycleFilter, setLifecycleFilter] = useState("active");
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const { hasPerm, isSuperAdmin } = useAuth();
  const canDelete = hasPerm("jobs.delete");

  const load = async () => {
    try {
      const params = { page, page_size: 25, lifecycle: lifecycleFilter };
      if (search) params.search = search;
      if (statusFilter && statusFilter !== "all") params.status = statusFilter;
      const { data } = await api.get("/jobs", { params });
      setData(data);
    } catch (e) { setError(formatApiErrorDetail(e.response?.data?.detail) || e.message); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [page, statusFilter, lifecycleFilter]);

  return (
    <div className="max-w-6xl space-y-6" data-testid="jobs-page">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <div className="overline">Production</div>
          <h1 className="text-3xl md:text-4xl font-black tracking-tighter text-[#1F2A33]">Jobs</h1>
          <p className="text-sm text-gray-500 mt-1">Auto-created from accepted quotes. Track production through delivery.</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <form onSubmit={(e) => { e.preventDefault(); setPage(1); load(); }} className="flex gap-2 flex-1 max-w-md">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/>
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="J-2026-…" className="pl-9 h-10" data-testid="jobs-search-input"/>
          </div>
          <Button type="submit" variant="outline">Search</Button>
        </form>
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
          <SelectTrigger className="w-52 h-10" data-testid="jobs-status-filter"><SelectValue/></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {Object.keys(STATUS_STYLES).map(s => <SelectItem key={s} value={s}>{s.replace(/_/g," ")}</SelectItem>)}
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
        {!data ? <div className="p-6 flex items-center gap-2 text-gray-500 text-sm"><Loader2 className="w-4 h-4 animate-spin"/> Loading…</div> :
         data.items.length === 0 ? <div className="p-8 text-center text-sm text-gray-500" data-testid="jobs-empty">No jobs match this filter.</div> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[#3A6B8C] text-white uppercase text-[10px] tracking-wider">
                <tr>
                  <th className="px-4 py-3 text-left">Job #</th>
                  <th className="px-4 py-3 text-left">Quote #</th>
                  <th className="px-4 py-3 text-left">Customer</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-right">Total</th>
                  <th className="px-4 py-3 text-right">Created</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody data-testid="jobs-table-body">
                {data.items.map(j => {
                  const isDeleted = !!j.deleted_at;
                  return (
                    <tr key={j.id} className={`border-t border-gray-200 hover:bg-gray-50 ${isDeleted ? "opacity-60" : ""}`}
                        data-testid={`job-row-${j.id}`}>
                      <td className="px-4 py-3">
                        <Link to={`/jobs/${j.id}`} className="font-semibold text-[#1F2A33] hover:text-[#3A6B8C] tabular-nums" data-testid={`job-link-${j.job_number}`}>{j.job_number}</Link>
                        {isDeleted && (
                          <span className="ml-2 text-[10px] font-bold uppercase tracking-wider bg-red-100 text-red-800 px-1.5 py-0.5 rounded"
                                data-testid={`deleted-badge-${j.id}`}>deleted</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500 tabular-nums">{j.quote_number}</td>
                      <td className="px-4 py-3 text-gray-700">{j.customer_company_name}</td>
                      <td className="px-4 py-3"><span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded inline-flex items-center gap-1 ${STATUS_STYLES[j.status]}`}><AppIcon name={STATUS_ICON[j.status]} size={14} decorative/>{j.status.replace(/_/g," ")}</span></td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums">{formatAUD(j.total)}</td>
                      <td className="px-4 py-3 text-right text-xs text-gray-500">{formatDateTime(j.created_from_quote_at)}</td>
                      <td className="px-4 py-3 text-right">
                        <DeleteRowActions entity="jobs" row={j}
                          label={(r) => r.job_number}
                          canDelete={canDelete} isSuperAdmin={isSuperAdmin}
                          onChanged={load} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
