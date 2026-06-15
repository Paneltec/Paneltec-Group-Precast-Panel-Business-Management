import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Loader2, Search, X } from "lucide-react";
import AppIcon from "../components/AppIcon";
import { api, formatApiErrorDetail } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Checkbox } from "../components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "../components/ui/dialog";
import { formatAUD, formatDateTime } from "../lib/format";
import DeleteRowActions from "../components/DeleteRowActions";
import { useAuth } from "../contexts/AuthContext";
import { toast } from "sonner";

const STATUS_STYLES = {
  draft: "bg-gray-100 text-gray-700",
  issued: "bg-blue-100 text-blue-800",
  paid: "bg-green-100 text-green-800",
  overdue: "bg-red-100 text-red-700",
  cancelled: "bg-gray-200 text-gray-500",
};

const formatPushDate = (iso) => {
  if (!iso) return "previously";
  try { return new Date(iso).toLocaleString("en-AU"); } catch (_) { return iso; }
};

export default function InvoicesList() {
  const [data, setData] = useState(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [lifecycleFilter, setLifecycleFilter] = useState("active");
  const [urlParams, setUrlParams] = useSearchParams();
  const xeroFilter = urlParams.get("xero_push_status") || "all";
  const setXeroFilter = (v) => {
    const next = new URLSearchParams(urlParams);
    if (!v || v === "all") next.delete("xero_push_status"); else next.set("xero_push_status", v);
    setUrlParams(next, { replace: false });
  };
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(() => new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [force, setForce] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [result, setResult] = useState(null);
  const { hasPerm, isSuperAdmin } = useAuth();
  const canDelete = hasPerm("invoices.delete");
  const canPushXero = hasPerm("invoices.push_xero");

  const load = async () => {
    try {
      const params = { page, page_size: 25, lifecycle: lifecycleFilter };
      if (search) params.search = search;
      if (statusFilter && statusFilter !== "all") params.status = statusFilter;
      if (xeroFilter && xeroFilter !== "all") params.xero_push_status = xeroFilter;
      const { data } = await api.get("/invoices", { params });
      setData(data);
      // Drop selections that are no longer present
      setSelected((prev) => {
        const ids = new Set(data.items.map(i => i.id));
        const next = new Set();
        prev.forEach(id => { if (ids.has(id)) next.add(id); });
        return next;
      });
    } catch (e) { setError(formatApiErrorDetail(e.response?.data?.detail) || e.message); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [page, statusFilter, lifecycleFilter, xeroFilter]);

  const selectableRows = useMemo(
    () => (data?.items || []).filter(i => !i.deleted_at),
    [data]
  );
  const allChecked = selectableRows.length > 0 && selectableRows.every(i => selected.has(i.id));
  const someChecked = selectableRows.some(i => selected.has(i.id)) && !allChecked;

  const toggleOne = (id) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleAll = () => {
    setSelected(prev => {
      const next = new Set(prev);
      if (allChecked) {
        selectableRows.forEach(r => next.delete(r.id));
      } else {
        selectableRows.forEach(r => next.add(r.id));
      }
      return next;
    });
  };
  const clearSelection = () => setSelected(new Set());

  const selectedInvoices = useMemo(
    () => (data?.items || []).filter(i => selected.has(i.id)),
    [data, selected]
  );
  const priorlyPushed = useMemo(
    () => selectedInvoices.filter(i => i.xero_push_status === "MOCKED_PUSHED"),
    [selectedInvoices]
  );

  const openConfirm = () => {
    setForce(false);
    setConfirmOpen(true);
  };

  const runBulkPush = async () => {
    setPushing(true);
    try {
      const { data: res } = await api.post("/invoices/batch-push-xero", {
        invoice_ids: Array.from(selected),
        force,
      });
      setConfirmOpen(false);
      setResult(res);
      clearSelection();
      load();
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message);
    } finally { setPushing(false); }
  };

  return (
    <div className="max-w-6xl space-y-6 pb-24" data-testid="invoices-page">
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
        <Select value={lifecycleFilter} onValueChange={(v) => { setLifecycleFilter(v); setPage(1); }}>
          <SelectTrigger className="w-40 h-10" data-testid="lifecycle-filter"><SelectValue/></SelectTrigger>
          <SelectContent>
            <SelectItem value="active" data-testid="lifecycle-filter-active">Active</SelectItem>
            <SelectItem value="deleted" data-testid="lifecycle-filter-deleted">Deleted</SelectItem>
            <SelectItem value="all" data-testid="lifecycle-filter-all">All</SelectItem>
          </SelectContent>
        </Select>
        <Select value={xeroFilter} onValueChange={(v) => { setXeroFilter(v); setPage(1); }}>
          <SelectTrigger className="w-44 h-10" data-testid="xero-push-filter"><SelectValue/></SelectTrigger>
          <SelectContent>
            <SelectItem value="all" data-testid="xero-push-filter-all">All Xero states</SelectItem>
            <SelectItem value="pending" data-testid="xero-push-filter-pending">Awaiting Xero push</SelectItem>
            <SelectItem value="pushed" data-testid="xero-push-filter-pushed">Pushed to Xero</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {error && <div className="text-sm text-red-700">{error}</div>}

      <section className="bg-white border border-gray-200 rounded overflow-hidden">
        {!data ? <div className="p-6 flex items-center gap-2 text-gray-500 text-sm"><Loader2 className="w-4 h-4 animate-spin"/> Loading…</div> :
         data.items.length === 0 ? <div className="p-8 text-center text-sm text-gray-500" data-testid="invoices-empty">No invoices match this filter.</div> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[#3A6B8C] text-white uppercase text-[10px] tracking-wider">
                <tr>
                  {canPushXero && (
                    <th className="px-3 py-3 text-left w-10">
                      <Checkbox
                        checked={allChecked ? true : (someChecked ? "indeterminate" : false)}
                        onCheckedChange={toggleAll}
                        data-testid="bulk-xero-select-all"
                        aria-label="Select all selectable invoices"
                        className="border-white data-[state=checked]:bg-[#F5C518] data-[state=checked]:text-[#1F2A33] data-[state=checked]:border-[#F5C518]"
                      />
                    </th>
                  )}
                  <th className="px-4 py-3 text-left">Invoice #</th>
                  <th className="px-4 py-3 text-left">Customer</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Xero</th>
                  <th className="px-4 py-3 text-left">Issue date</th>
                  <th className="px-4 py-3 text-left">Due date</th>
                  <th className="px-4 py-3 text-right">Total</th>
                  <th className="px-4 py-3 text-right">Created</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody data-testid="invoices-table-body">
                {data.items.map(i => {
                  const isDeleted = !!i.deleted_at;
                  const pushedAlready = i.xero_push_status === "MOCKED_PUSHED";
                  return (
                    <tr key={i.id} className={`border-t border-gray-200 hover:bg-gray-50 ${isDeleted ? "opacity-60" : ""}`}
                        data-testid={`invoice-row-${i.id}`}>
                      {canPushXero && (
                        <td className="px-3 py-3">
                          {!isDeleted && (
                            <Checkbox
                              checked={selected.has(i.id)}
                              onCheckedChange={() => toggleOne(i.id)}
                              data-testid={`bulk-xero-select-${i.id}`}
                              aria-label={`Select ${i.invoice_number}`}
                            />
                          )}
                        </td>
                      )}
                      <td className="px-4 py-3">
                        <Link to={`/invoices/${i.id}`} className="font-semibold text-[#1F2A33] hover:text-[#3A6B8C] tabular-nums" data-testid={`invoice-link-${i.invoice_number}`}>{i.invoice_number}</Link>
                        {isDeleted && (
                          <span className="ml-2 text-[10px] font-bold uppercase tracking-wider bg-red-100 text-red-800 px-1.5 py-0.5 rounded"
                                data-testid={`deleted-badge-${i.id}`}>deleted</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-700">{i.customer_company_name}</td>
                      <td className="px-4 py-3"><span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${STATUS_STYLES[i.status]}`}>{i.status}</span></td>
                      <td className="px-4 py-3">
                        {pushedAlready ? (
                          <span className="text-[10px] font-bold uppercase tracking-wider bg-[#F5C518]/30 text-[#1F2A33] px-1.5 py-0.5 rounded"
                                data-testid={`xero-status-${i.id}`}>Pushed</span>
                        ) : (
                          <span className="text-[10px] text-gray-400 uppercase tracking-wider" data-testid={`xero-status-${i.id}`}>—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 tabular-nums text-gray-700">{i.issue_date || "—"}</td>
                      <td className="px-4 py-3 tabular-nums text-gray-700">{i.due_date || "—"}</td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums">{formatAUD(i.total)}</td>
                      <td className="px-4 py-3 text-right text-xs text-gray-500">{formatDateTime(i.created_at)}</td>
                      <td className="px-4 py-3 text-right">
                        <DeleteRowActions entity="invoices" row={i}
                          label={(r) => r.invoice_number}
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

      {/* Sticky bulk action bar */}
      {canPushXero && selected.size > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-30 bg-[#1F2A33] text-white shadow-2xl border-t-4 border-[#F5C518]"
             data-testid="bulk-xero-action-bar">
          <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
            <div className="text-sm">
              <span className="font-black text-[#F5C518] tabular-nums" data-testid="bulk-xero-count">{selected.size}</span>
              <span className="ml-2 text-white/90">invoice{selected.size === 1 ? "" : "s"} selected</span>
            </div>
            <div className="flex items-center gap-2">
              <Button onClick={clearSelection} variant="outline" data-testid="bulk-xero-clear-btn"
                      className="bg-transparent border-white/40 text-white hover:bg-white/10 hover:text-white">
                <X className="w-4 h-4 mr-1.5"/> Clear
              </Button>
              <Button onClick={openConfirm} data-testid="bulk-xero-push-btn"
                      className="bg-[#F5C518] text-[#1F2A33] font-bold hover:bg-[#E0B416]">
                <AppIcon name="xero_push" size={16} className="mr-1.5" decorative/> Push to Xero
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation modal */}
      <Dialog open={confirmOpen} onOpenChange={(v) => { if (!v) setConfirmOpen(false); }}>
        <DialogContent data-testid="bulk-xero-confirm-dialog" className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-[#1F2A33] inline-flex items-center gap-2">
              <AppIcon name="xero_push" size={22} decorative/> Push {selected.size} invoice{selected.size === 1 ? "" : "s"} to Xero
            </DialogTitle>
            <DialogDescription className="pt-2 text-sm text-gray-700">
              This is a MOCKED push (Xero integration lands in Phase 4). A mock Xero invoice ID will be recorded for each.
            </DialogDescription>
          </DialogHeader>

          {priorlyPushed.length > 0 && (
            <div className="bg-[#F5C518]/15 border border-[#F5C518] rounded p-3 text-sm"
                 data-testid="bulk-xero-prior-warning">
              <div className="font-bold uppercase tracking-wider text-xs text-[#1F2A33] inline-flex items-center gap-1.5">
                <AppIcon name="warning" size={16} decorative/> Prior push detected
              </div>
              <div className="text-[#1F2A33]/85 text-xs mt-1.5">
                {priorlyPushed.length} of {selected.size} selected invoice{priorlyPushed.length === 1 ? " was" : "s were"} already pushed:
              </div>
              <ul className="text-xs text-[#1F2A33]/85 mt-1.5 space-y-0.5 max-h-32 overflow-y-auto">
                {priorlyPushed.map(i => (
                  <li key={i.id} className="tabular-nums">
                    <code className="bg-white/60 px-1 rounded">{i.invoice_number}</code> — pushed {formatPushDate(i.last_xero_push_at || i.xero_pushed_at)}
                  </li>
                ))}
              </ul>
              <label className="mt-3 flex items-center gap-2 cursor-pointer">
                <Checkbox checked={force} onCheckedChange={(v) => setForce(!!v)} data-testid="bulk-xero-force-toggle"/>
                <span className="text-xs font-semibold text-[#1F2A33]">Force re-push (will create duplicates in Xero)</span>
              </label>
              {!force && (
                <div className="text-[10px] text-[#1F2A33]/70 mt-1.5">
                  Without Force, previously pushed invoices will be SKIPPED.
                </div>
              )}
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={pushing} data-testid="bulk-xero-cancel-btn">
              Cancel
            </Button>
            <Button onClick={runBulkPush} disabled={pushing}
                    className="bg-[#F5C518] text-[#1F2A33] font-bold hover:bg-[#E0B416]"
                    data-testid="bulk-xero-confirm-btn">
              {pushing ? <Loader2 className="w-4 h-4 mr-2 animate-spin"/> : null}
              {pushing ? "Pushing…" : `Push ${selected.size}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Result modal */}
      <Dialog open={!!result} onOpenChange={(v) => { if (!v) setResult(null); }}>
        <DialogContent data-testid="bulk-xero-result-dialog" className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-[#1F2A33]">Bulk Xero push results</DialogTitle>
            <DialogDescription className="pt-1 text-xs text-gray-500">
              MOCKED — Real Xero push lands in Phase 4.
            </DialogDescription>
          </DialogHeader>
          {result && (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="bg-green-50 border border-green-200 rounded p-2">
                  <div className="text-[10px] uppercase font-bold tracking-wider text-green-800">Pushed</div>
                  <div className="text-2xl font-black tabular-nums text-green-700" data-testid="bulk-xero-result-pushed">{result.summary.pushed}</div>
                </div>
                <div className="bg-gray-50 border border-gray-200 rounded p-2">
                  <div className="text-[10px] uppercase font-bold tracking-wider text-gray-700">Skipped</div>
                  <div className="text-2xl font-black tabular-nums text-gray-700" data-testid="bulk-xero-result-skipped">{result.summary.skipped}</div>
                </div>
                <div className="bg-red-50 border border-red-200 rounded p-2">
                  <div className="text-[10px] uppercase font-bold tracking-wider text-red-800">Errored</div>
                  <div className="text-2xl font-black tabular-nums text-red-700" data-testid="bulk-xero-result-errored">{result.summary.errored}</div>
                </div>
              </div>
              <div className="border border-gray-200 rounded max-h-64 overflow-y-auto">
                <table className="w-full text-xs">
                  <tbody data-testid="bulk-xero-result-list">
                    {result.results.map((r, idx) => (
                      <tr key={idx} className="border-b border-gray-100 last:border-b-0">
                        <td className="px-2 py-1.5 w-6">
                          {r.status === "MOCKED_PUSHED" && <AppIcon name="success" size={18} decorative/>}
                          {r.status === "SKIPPED" && <AppIcon name="info" size={18} decorative/>}
                          {r.status === "ERROR" && <AppIcon name="error" size={18} decorative/>}
                        </td>
                        <td className="px-2 py-1.5 font-semibold tabular-nums">{r.invoice_number || r.invoice_id}</td>
                        <td className="px-2 py-1.5 text-gray-600">{r.message || (r.xero_invoice_id ? `Mock ID: ${r.xero_invoice_id}` : "")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setResult(null)} data-testid="bulk-xero-result-close"
                    className="bg-[#1F2A33] text-white hover:bg-[#0F1A23]">
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
