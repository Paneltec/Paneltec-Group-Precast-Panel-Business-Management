import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Loader2, Trash2, Upload, Plus, AlertTriangle } from "lucide-react";
import AppIcon from "../components/AppIcon";
import { api, formatApiErrorDetail } from "../lib/api";
import { useAuth } from "../contexts/AuthContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Checkbox } from "../components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "../components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "../components/ui/alert-dialog";
import { toast, Toaster } from "sonner";

const fmtAud = (v) => v === null || v === undefined ? "—"
  : new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(v);

export default function Stock() {
  const { hasPerm } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState(null);       // {items, count, total, categories}
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  const q = searchParams.get("q") || "";
  const category = searchParams.get("category") || "__all__";
  const supplier = searchParams.get("supplier") || "__all__";
  const review = searchParams.get("review") === "1";
  const patch = (upd) => {
    const next = new URLSearchParams(searchParams);
    Object.entries(upd).forEach(([k, v]) => {
      if (!v || v === "__all__" || v === "0") next.delete(k); else next.set(k, v);
    });
    setSearchParams(next, { replace: true });
  };

  const canEdit = hasPerm("stock.edit");

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (category !== "__all__") params.set("category", category);
      if (supplier !== "__all__") params.set("supplier_id", supplier);
      if (review) params.set("needs_review", "true");
      params.set("limit", "500");
      const { data: d } = await api.get(`/stock?${params}`);
      setData(d);
    } catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message); }
    finally { setLoading(false); }
  };
  const loadSuppliers = async () => {
    try { const { data: d } = await api.get("/suppliers"); setSuppliers(d); }
    catch { setSuppliers([]); }
  };
  useEffect(() => { load(); setSelected(new Set()); /* eslint-disable-next-line */ }, [q, category, supplier, review]);
  useEffect(() => { loadSuppliers(); }, []);

  const supplierName = (sid) => suppliers.find(s => s.id === sid)?.name || "";
  const items = data?.items || [];
  const total = data?.total ?? 0;
  const cats = data?.categories || [];
  const allSelected = items.length > 0 && items.every(i => selected.has(i.id));
  const someSelected = selected.size > 0 && !allSelected;
  const toggleRow = (id) => { const n = new Set(selected); n.has(id) ? n.delete(id) : n.add(id); setSelected(n); };
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(items.map(i => i.id)));
  const anyFilter = q || category !== "__all__" || supplier !== "__all__" || review;

  const doBulkDelete = async () => {
    try {
      const { data: r } = await api.post("/stock/bulk-delete", { stock_item_ids: Array.from(selected) });
      toast.success(`Deleted ${r.deleted} stock item${r.deleted === 1 ? "" : "s"}.`);
      setBulkOpen(false); setSelected(new Set()); await load();
    } catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message); }
  };

  return (
    <div className="space-y-4 p-6" data-testid="stock-page">
      <Toaster richColors position="top-right"/>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-widest font-bold text-[#3A6B8C]">STOCK</div>
          <h1 className="text-3xl font-black text-[#1F2A33]">Stock catalogue</h1>
          <p className="text-sm text-gray-600">Parts and materials available for quoting. Import a supplier price list or add items manually.</p>
        </div>
        <div className="flex gap-2">
          {canEdit && (
            <>
              <Button variant="outline" onClick={() => setImportOpen(true)} data-testid="stock-import-btn" className="h-11">
                <Upload className="w-4 h-4 mr-1.5"/> Import Excel
              </Button>
              <Button onClick={() => setAddOpen(true)} data-testid="stock-add-btn" className="h-11 bg-[#F5C518] text-[#1F2A33] font-bold hover:bg-[#E0B416]">
                <Plus className="w-4 h-4 mr-1.5"/> Add stock item
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2" data-testid="stock-filters">
        <Input value={q} onChange={(e) => patch({ q: e.target.value })}
                placeholder="Search part number or description…"
                className="h-9 w-72 text-sm" data-testid="stock-text-filter"/>
        <select value={category} onChange={(e) => patch({ category: e.target.value })}
                 className="h-9 border border-gray-300 rounded px-2 text-sm bg-white min-w-[200px]"
                 data-testid="stock-category-filter">
          <option value="__all__">All categories</option>
          {cats.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={supplier} onChange={(e) => patch({ supplier: e.target.value })}
                 className="h-9 border border-gray-300 rounded px-2 text-sm bg-white min-w-[160px]"
                 data-testid="stock-supplier-filter">
          <option value="__all__">All suppliers</option>
          {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <button type="button"
                onClick={() => patch({ review: review ? "0" : "1" })}
                className={`text-[11px] uppercase tracking-wider font-bold border rounded-full px-3 py-1 ${review ? "bg-amber-500 border-amber-600 text-white" : "bg-white border-gray-300 text-gray-600 hover:border-amber-400"}`}
                data-testid="stock-review-filter">
          <AlertTriangle className="w-3 h-3 inline mr-1"/> Needs review
        </button>
        <span className="text-[11px] uppercase tracking-wider font-bold bg-[#1F2A33] text-white rounded-full px-2.5 py-1"
               data-testid="stock-count">{total} item{total === 1 ? "" : "s"}</span>
        {anyFilter && (
          <button type="button" onClick={() => setSearchParams({}, { replace: true })}
                   className="text-[11px] uppercase tracking-wider font-semibold text-[#3A6B8C] underline hover:text-[#1F2A33]"
                   data-testid="stock-clear-filters">Clear filters</button>
        )}
      </div>

      <div className="bg-white border border-gray-200 rounded overflow-hidden">
        {loading ? <div className="p-6 text-sm text-gray-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin"/> Loading…</div>
         : items.length === 0 ? <div className="p-6 text-sm text-gray-500">{anyFilter ? "No stock items match the current filters." : "No stock items yet. Import an Excel price list or add items manually."}</div>
         : (
          <table className="w-full text-sm">
            <thead className="bg-[#3A6B8C] text-white uppercase text-[10px] tracking-wider">
              <tr>
                {canEdit && (
                  <th className="px-3 py-3 text-left w-10">
                    <Checkbox checked={allSelected} indeterminate={someSelected ? "true" : undefined}
                               onCheckedChange={toggleAll} data-testid="stock-select-all"
                               className="border-white/60 data-[state=checked]:bg-[#F5C518] data-[state=checked]:border-[#F5C518]"/>
                  </th>
                )}
                <th className="px-4 py-3 text-left w-16"></th>
                <th className="px-4 py-3 text-left">Part number</th>
                <th className="px-4 py-3 text-left">Description</th>
                <th className="px-4 py-3 text-left">Category</th>
                <th className="px-4 py-3 text-left">Supplier</th>
                <th className="px-4 py-3 text-right">Unit price</th>
                <th className="px-4 py-3 text-right">On hand</th>
              </tr>
            </thead>
            <tbody>
              {items.map(it => (
                <tr key={it.id} className={`border-t border-gray-200 ${selected.has(it.id) ? "bg-yellow-50" : "hover:bg-gray-50"}`}
                    data-testid={`stock-row-${it.id}`}>
                  {canEdit && (
                    <td className="px-3 py-3">
                      <Checkbox checked={selected.has(it.id)} onCheckedChange={() => toggleRow(it.id)}
                                 data-testid={`stock-select-${it.id}`}/>
                    </td>
                  )}
                  <td className="px-4 py-3">
                    {it.image_url ? <img src={it.image_url} alt="" className="w-10 h-10 object-cover rounded"/>
                                   : <div className="w-10 h-10 bg-gray-100 rounded flex items-center justify-center"><AppIcon name="package" size={20} decorative/></div>}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs font-bold text-[#1F2A33]">{it.part_number}</td>
                  <td className="px-4 py-3 text-gray-700">
                    <div>{it.description || <span className="italic text-gray-400">No description</span>}</div>
                    {it.needs_review && (
                      <span className="mt-1 inline-block text-[10px] font-bold uppercase tracking-wider bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded"
                             data-testid={`stock-review-chip-${it.id}`}>review price</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600">{it.category || "—"}</td>
                  <td className="px-4 py-3 text-xs text-gray-600">{supplierName(it.supplier_id) || it.brand || "—"}</td>
                  <td className="px-4 py-3 text-right font-semibold">{fmtAud(it.unit_price)}</td>
                  <td className="px-4 py-3 text-right">{it.on_hand_qty}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {canEdit && selected.size > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 bg-[#1F2A33] text-white rounded-full shadow-2xl border border-white/10 px-5 py-3 flex items-center gap-3"
              data-testid="stock-bulk-actionbar">
          <span className="text-sm font-semibold">{selected.size} selected</span>
          <div className="h-4 w-px bg-white/30"/>
          <Button size="sm" onClick={() => setBulkOpen(true)} className="bg-red-600 hover:bg-red-700 text-white h-8" data-testid="stock-bulk-delete-btn">
            <Trash2 className="w-3.5 h-3.5 mr-1"/> Delete selected
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())} className="text-white/80 hover:text-white hover:bg-white/10 h-8">Clear</Button>
        </div>
      )}

      <StockImportModal open={importOpen} onOpenChange={setImportOpen} suppliers={suppliers} onImported={load}/>
      <StockAddModal open={addOpen} onOpenChange={setAddOpen} suppliers={suppliers} onCreated={load}/>

      <AlertDialog open={bulkOpen} onOpenChange={(v) => !v && setBulkOpen(false)}>
        <AlertDialogContent data-testid="stock-bulk-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selected.size} stock item{selected.size === 1 ? "" : "s"}?</AlertDialogTitle>
            <AlertDialogDescription>These items will be permanently removed from the catalogue. The deletion is logged in the audit trail but the records themselves cannot be recovered.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={doBulkDelete} className="bg-red-600 text-white hover:bg-red-700">Delete {selected.size}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function StockImportModal({ open, onOpenChange, suppliers, onImported }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [supplierId, setSupplierId] = useState("");
  useEffect(() => {
    if (!open) { setFile(null); setPreview(null); return; }
    const reid = suppliers.find(s => s.name === "Reid");
    if (reid) setSupplierId(reid.id);
  }, [open, suppliers]);
  const doPreview = async () => {
    if (!file) return;
    setLoading(true);
    try {
      const fd = new FormData(); fd.append("file", file);
      const { data } = await api.post("/stock/import-excel", fd);
      setPreview(data);
    } catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message); }
    finally { setLoading(false); }
  };
  const doConfirm = async () => {
    if (!preview) return;
    setLoading(true);
    try {
      const { data } = await api.post("/stock/import-excel/confirm", { items: preview.items, supplier_id: supplierId || null });
      toast.success(`Imported: ${data.created} created · ${data.updated} updated.`);
      onImported && onImported();
      onOpenChange(false);
    } catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message); }
    finally { setLoading(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto" data-testid="stock-import-modal">
        <DialogHeader>
          <DialogTitle>Import stock from Excel</DialogTitle>
          <DialogDescription>Upload a supplier price list (`.xlsx`). Rows with matching part numbers will be updated; new part numbers will be created.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-[10px] uppercase tracking-wider font-bold text-[#3A6B8C] block mb-1">Excel file</label>
            <input type="file" accept=".xlsx" onChange={(e) => { setFile(e.target.files?.[0] || null); setPreview(null); }}
                    className="text-sm" data-testid="stock-import-file"/>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider font-bold text-[#3A6B8C] block mb-1">Default supplier (applies to every row)</label>
            <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}
                     className="h-9 border border-gray-300 rounded px-2 text-sm bg-white w-full"
                     data-testid="stock-import-supplier">
              <option value="">(none)</option>
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          {!preview && (
            <Button onClick={doPreview} disabled={!file || loading} className="bg-[#1F2A33] text-white" data-testid="stock-import-preview-btn">
              {loading ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin"/> : null} Preview
            </Button>
          )}
          {preview && (
            <>
              <div className="bg-emerald-50 border border-emerald-200 rounded p-3 text-sm text-emerald-900">
                Parsed <b>{preview.items.length}</b> rows · <b>{preview.valid_count}</b> valid · <b>{preview.needs_review_count}</b> flagged for review
              </div>
              <div className="border border-gray-200 rounded overflow-y-auto max-h-64">
                <table className="w-full text-xs">
                  <thead className="bg-gray-100 uppercase text-[10px] tracking-wider text-gray-600">
                    <tr><th className="px-2 py-1 text-left">Part no.</th><th className="px-2 py-1 text-left">Description</th><th className="px-2 py-1 text-left">Category</th><th className="px-2 py-1 text-right">Price</th></tr>
                  </thead>
                  <tbody>
                    {preview.items.slice(0, 20).map((r, i) => (
                      <tr key={i} className="border-t border-gray-100">
                        <td className="px-2 py-1 font-mono">{r.part_number}</td>
                        <td className="px-2 py-1">{r.description || <span className="italic text-amber-700">missing</span>}</td>
                        <td className="px-2 py-1 text-gray-500">{r.category}</td>
                        <td className="px-2 py-1 text-right">{fmtAud(r.unit_price)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="p-2 text-[11px] text-gray-500 italic">Showing first 20 of {preview.items.length}.</div>
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          {preview && (
            <Button onClick={doConfirm} disabled={loading} className="bg-[#F5C518] text-[#1F2A33] font-bold hover:bg-[#E0B416]" data-testid="stock-import-confirm-btn">
              {loading ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin"/> : null} Import all ({preview.items.length})
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StockAddModal({ open, onOpenChange, suppliers, onCreated }) {
  const empty = { part_number: "", description: "", category: "", unit_price: "", supplier_id: "", on_hand_qty: 0, unit_of_measure: "EA" };
  const [f, setF] = useState(empty);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (!open) setF(empty); }, [open]);
  const save = async () => {
    if (!f.part_number.trim()) { toast.error("Part number is required."); return; }
    setSaving(true);
    try {
      const payload = { ...f, unit_price: f.unit_price === "" ? null : parseFloat(f.unit_price),
                         on_hand_qty: parseInt(f.on_hand_qty, 10) || 0 };
      await api.post("/stock", payload);
      toast.success(`Created ${payload.part_number}.`);
      onCreated && onCreated(); onOpenChange(false);
    } catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message); }
    finally { setSaving(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="stock-add-modal">
        <DialogHeader><DialogTitle>Add stock item</DialogTitle></DialogHeader>
        <div className="space-y-2">
          <Input placeholder="Part number *" value={f.part_number} onChange={(e) => setF({ ...f, part_number: e.target.value })} data-testid="stock-add-partno"/>
          <Input placeholder="Description" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })}/>
          <Input placeholder="Category" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}/>
          <select value={f.supplier_id} onChange={(e) => setF({ ...f, supplier_id: e.target.value })} className="h-9 border border-gray-300 rounded px-2 text-sm bg-white w-full">
            <option value="">(select supplier)</option>
            {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <div className="grid grid-cols-2 gap-2">
            <Input type="number" step="0.01" placeholder="Unit price AUD" value={f.unit_price} onChange={(e) => setF({ ...f, unit_price: e.target.value })}/>
            <Input type="number" placeholder="On-hand qty" value={f.on_hand_qty} onChange={(e) => setF({ ...f, on_hand_qty: e.target.value })}/>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving} className="bg-[#F5C518] text-[#1F2A33] font-bold">{saving ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin"/> : null} Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
