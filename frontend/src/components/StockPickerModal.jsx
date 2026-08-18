import { useEffect, useMemo, useState, Fragment } from "react";
import { Loader2, Search, Package } from "lucide-react";
import AppIcon from "./AppIcon";
import { api, formatApiErrorDetail } from "../lib/api";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Checkbox } from "./ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "./ui/dialog";
import { toast } from "sonner";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || "";
const fmtAud = (v) => v === null || v === undefined ? "—"
  : new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(v);
const fmtNum = (v, digits = 2) => v === null || v === undefined || v === ""
  ? "—" : Number(v).toLocaleString("en-AU", { minimumFractionDigits: 0, maximumFractionDigits: digits });
const imgSrc = (u) => (u && !/^https?:/.test(u)) ? `${BACKEND_URL}${u}` : (u || "");

// Category → icon (same rules as Stock.jsx — kept inline to avoid extra utility file).
const CAT_RULES = [
  { test: /chain|clutch/i,                  icon: "chains" },
  { test: /lift|anchor/i,                   icon: "link" },
  { test: /shackle|hook|rigging|sling/i,    icon: "link" },
  { test: /bar chair|spacer|cover/i,        icon: "donut" },
  { test: /ferrule|insert|thread/i,         icon: "nut_and_bolt" },
  { test: /bolt|nut|coach|hex/i,            icon: "nut_and_bolt" },
  { test: /screw|dyna|fix|fastener/i,       icon: "screw" },
  { test: /rebar|steel|mesh|reinforc/i,     icon: "chair" },
  { test: /brace|prop|strut|scaffold/i,     icon: "hammer" },
  { test: /form|edge|profile|ruler|mould/i, icon: "straight_ruler" },
  { test: /sealant|glue|adhesive|spray/i,   icon: "spray_bottle" },
  { test: /grout|oil|release|chemical/i,    icon: "oil_drum" },
  { test: /precast|panel|concrete|construct/i, icon: "building_construction" },
];
const iconForCategory = (cat) => {
  const c = (cat || "").toLowerCase();
  for (const r of CAT_RULES) if (r.test.test(c)) return r.icon;
  return "package";
};

const BRAND_CHIPS = [
  { key: "__all__", label: "All" },
  { key: "Reid",    label: "Reid" },
  { key: "Ramset",  label: "Ramset" },
  { key: "Genuine", label: "Genuine" },     // category text contains "Genuine"
  { key: "Peltzer Con", label: "Peltzer Con" },
];

const bannerSupplierFor = (rows, suppliers) => {
  const sids = new Set(rows.map(r => r.supplier_id).filter(Boolean));
  if (sids.size === 1) return suppliers.find(s => s.id === [...sids][0])?.name || "";
  if (sids.size > 1)   return "Multiple";
  const brands = new Set(rows.map(r => (r.brand || "").trim()).filter(Boolean));
  if (brands.size === 1) return [...brands][0];
  if (brands.size > 1)   return "Multiple";
  return "";
};

export default function StockPickerModal({ open, onOpenChange, quoteId, onAdded }) {
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [brand, setBrand] = useState("__all__");
  const [category, setCategory] = useState("__all__");
  const [items, setItems] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [picks, setPicks] = useState({});   // {id: qty}
  const [submitting, setSubmitting] = useState(false);

  // Debounce search input (200ms)
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 200);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    if (!open) return;
    // reset on open
    setPicks({}); setQ(""); setDebouncedQ(""); setBrand("__all__"); setCategory("__all__");
    api.get("/suppliers").then(({ data }) => setSuppliers(data)).catch(() => setSuppliers([]));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    const params = new URLSearchParams();
    if (debouncedQ) params.set("q", debouncedQ);
    if (category !== "__all__") params.set("category", category);
    params.set("limit", "500");
    api.get(`/stock?${params}`)
      .then(({ data }) => setItems(data.items || []))
      .catch((e) => toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message))
      .finally(() => setLoading(false));
  }, [open, debouncedQ, category]);

  const suppliersById = useMemo(() => {
    const m = {}; suppliers.forEach(s => { m[s.id] = s.name; }); return m;
  }, [suppliers]);

  // Client-side brand filter — Reid/Ramset/Peltzer match brand; Genuine matches category regex.
  const filteredItems = useMemo(() => {
    if (brand === "__all__") return items;
    if (brand === "Genuine") return items.filter(i => /genuine/i.test(i.category || ""));
    return items.filter(i => (i.brand || "").toLowerCase() === brand.toLowerCase());
  }, [items, brand]);

  const categoriesList = useMemo(() => {
    const set = new Set();
    items.forEach(i => { if (i.category) set.add(i.category); });
    return [...set].sort();
  }, [items]);

  const grouped = useMemo(() => {
    const groups = new Map();
    for (const it of filteredItems) {
      const key = it.category || "Uncategorised";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(it);
    }
    const keys = [...groups.keys()].sort((a, b) => {
      if (a === "Uncategorised") return 1;
      if (b === "Uncategorised") return -1;
      return a.localeCompare(b);
    });
    return keys.map(k => ({
      category: k, rows: groups.get(k),
      catSupplier: bannerSupplierFor(groups.get(k), suppliers),
    }));
  }, [filteredItems, suppliers]);

  const togglePick = (item) => {
    setPicks(prev => {
      const next = { ...prev };
      if (item.id in next) delete next[item.id];
      else next[item.id] = "1";      // strings — allows in-progress empty state
      return next;
    });
  };
  // Accept any string during typing (including "" while the user is clearing/retyping);
  // final coercion happens in doAdd. onBlur normalises empty/invalid to "1".
  const setQty = (id, qty) => {
    setPicks(prev => (id in prev) ? { ...prev, [id]: qty } : prev);
  };
  const commitQty = (id) => {
    setPicks(prev => {
      if (!(id in prev)) return prev;
      const n = parseInt(prev[id], 10);
      return { ...prev, [id]: (Number.isFinite(n) && n > 0) ? String(n) : "1" };
    });
  };
  // Bulk-set: apply a single qty value to every currently-ticked row.
  const [bulkQty, setBulkQty] = useState("");
  const applyBulkQty = () => {
    const n = parseInt(bulkQty, 10);
    if (!Number.isFinite(n) || n <= 0) { toast.error("Enter a positive integer to bulk-set."); return; }
    setPicks(prev => {
      const next = {};
      for (const k of Object.keys(prev)) next[k] = String(n);
      return next;
    });
    toast.success(`Set qty ${n} on ${Object.keys(picks).length} row${Object.keys(picks).length === 1 ? "" : "s"}.`);
  };

  const pickedCount = Object.keys(picks).length;
  const runningTotal = useMemo(() => {
    let t = 0;
    for (const it of items) {
      const raw = picks[it.id];
      if (!raw) continue;
      const q = parseInt(raw, 10);
      if (Number.isFinite(q) && q > 0 && it.unit_price) t += q * it.unit_price;
    }
    return t;
  }, [picks, items]);

  const doAdd = async () => {
    if (!quoteId) { toast.error("Save the draft quote first."); return; }
    if (pickedCount === 0) return;
    setSubmitting(true);
    // Build payload
    const rowsById = {}; items.forEach(i => { rowsById[i.id] = i; });
    const payload = {
      items: Object.entries(picks).map(([id, qty]) => {
        const it = rowsById[id];
        const n = parseInt(qty, 10);
        return {
          line_type: "stock",
          description: it.description || it.part_number,
          quantity: (Number.isFinite(n) && n > 0) ? n : 1,
          part_number: it.part_number,
          stock_item_id: it.id,
          supplier_id: it.supplier_id || null,
          supplier_name_override: suppliersById[it.supplier_id] || it.brand || null,
          unit_price: it.unit_price ?? 0,
        };
      }),
    };
    try {
      const { data } = await api.post(`/quotes/${quoteId}/lines/batch`, payload);
      const { added = 0, updated = 0, failed = 0, results = [] } = data;
      if (failed > 0) {
        const failedIds = new Set(
          results.filter(r => !r.ok).map(r => r.stock_item_id).filter(Boolean)
        );
        setPicks(prev => {
          const next = {};
          for (const [id, q] of Object.entries(prev)) if (failedIds.has(id)) next[id] = q;
          return next;
        });
        toast.error(`Added ${added} · updated ${updated} · ${failed} failed. Review remaining rows.`);
        onAdded && onAdded();
      } else {
        // Compose a friendly toast covering both new + merged cases
        const parts = [];
        if (added   > 0) parts.push(`Added ${added} new item${added === 1 ? "" : "s"}`);
        if (updated > 0) parts.push(`updated ${updated} existing ${updated === 1 ? "quantity" : "quantities"}`);
        toast.success(parts.length ? parts.join(", ") + "." : "Quote updated.");
        onAdded && onAdded();
        onOpenChange(false);
      }
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !submitting && onOpenChange(v)}>
      <DialogContent className="max-w-6xl max-h-[92vh] p-0 overflow-hidden flex flex-col" data-testid="stock-picker-modal">
        <DialogHeader className="px-6 pt-6 pb-3 border-b border-gray-200">
          <DialogTitle className="text-2xl font-black text-[#1F2A33] flex items-center gap-2">
            <Package className="w-6 h-6 text-[#3A6B8C]"/> Add items from Stock
          </DialogTitle>
          <DialogDescription>Browse the stock catalogue, tick items and set quantities, then add them to the quote in one action.</DialogDescription>
        </DialogHeader>

        {/* Filter bar */}
        <div className="px-6 py-3 border-b border-gray-200 space-y-2" data-testid="stock-picker-filters">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[240px]">
              <Search className="absolute left-2 top-2.5 w-4 h-4 text-gray-400"/>
              <Input value={q} onChange={e => setQ(e.target.value)}
                     placeholder="Search part number or description…"
                     className="h-9 pl-8 text-sm" data-testid="stock-picker-search"/>
            </div>
            <select value={category} onChange={e => setCategory(e.target.value)}
                    className="h-9 border border-gray-300 rounded px-2 text-sm bg-white min-w-[200px]"
                    data-testid="stock-picker-category">
              <option value="__all__">All categories</option>
              {categoriesList.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <span className="text-[11px] uppercase tracking-wider font-bold bg-[#1F2A33] text-white rounded-full px-2.5 py-1"
                  data-testid="stock-picker-count">
              {filteredItems.length} match{filteredItems.length === 1 ? "" : "es"}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5" data-testid="stock-picker-brand-chips">
            {BRAND_CHIPS.map(b => (
              <button key={b.key} type="button"
                onClick={() => setBrand(b.key)}
                className={`text-[11px] uppercase tracking-wider font-bold border rounded-full px-3 py-1 transition-colors ${
                  brand === b.key
                    ? "bg-[#3A6B8C] border-[#3A6B8C] text-white"
                    : "bg-white border-gray-300 text-gray-600 hover:border-[#3A6B8C] hover:text-[#3A6B8C]"
                }`}
                data-testid={`stock-picker-brand-${b.key}`}>
                {b.label}
              </button>
            ))}
          </div>
        </div>

        {/* Body — scrollable table */}
        <div className="flex-1 overflow-y-auto" data-testid="stock-picker-body">
          {loading ? (
            <div className="p-6 text-sm text-gray-500 flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin"/> Loading…
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="p-6 text-sm text-gray-500">No items match your filters.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-[#3A6B8C] text-white sticky top-0 z-30 uppercase text-[10px] tracking-wider">
                <tr>
                  <th className="px-3 py-2 text-left w-10"></th>
                  <th className="px-4 py-2 text-left w-14"></th>
                  <th className="px-4 py-2 text-left">Part number</th>
                  <th className="px-4 py-2 text-left">Description</th>
                  <th className="px-4 py-2 text-right">Pack qty</th>
                  <th className="px-4 py-2 text-right">Pack wt (kg)</th>
                  <th className="px-4 py-2 text-right">Unit price</th>
                  <th className="px-4 py-2 text-right w-24">Qty</th>
                </tr>
              </thead>
              <tbody>
                {grouped.map(({ category: catName, rows, catSupplier }) => (
                  <Fragment key={`grp-${catName}`}>
                    <tr data-testid={`stock-picker-group-${catName}`}>
                      <td colSpan={8} className="p-0">
                        <div className="sticky top-[32px] z-20 bg-[#F97316] text-white uppercase tracking-widest text-xs font-bold px-4 py-2 flex items-center gap-2 border-y border-orange-800/40 shadow-sm">
                          <AppIcon name={iconForCategory(catName)} size={20} decorative
                                    className="drop-shadow-[0_1px_1px_rgba(0,0,0,0.35)]"/>
                          <span>{catName}</span>
                          {catSupplier && (<>
                            <span className="text-white/60">·</span>
                            <span className="normal-case tracking-normal font-medium text-white/85">{catSupplier}</span>
                          </>)}
                          <span className="ml-auto normal-case tracking-normal text-[11px] font-semibold bg-white/20 rounded-full px-2 py-0.5">{rows.length} item{rows.length === 1 ? "" : "s"}</span>
                        </div>
                      </td>
                    </tr>
                    <tr className="bg-gray-100 text-gray-600 border-b border-gray-300">
                      <th className="px-3 py-1 w-10"></th>
                      <th className="px-4 py-1 w-14"></th>
                      <th className="px-4 py-1 text-left uppercase tracking-wider text-[10px] font-bold">Part number</th>
                      <th className="px-4 py-1 text-left uppercase tracking-wider text-[10px] font-bold">Description</th>
                      <th className="px-4 py-1 text-right uppercase tracking-wider text-[10px] font-bold">Pack qty</th>
                      <th className="px-4 py-1 text-right uppercase tracking-wider text-[10px] font-bold">Pack wt (kg)</th>
                      <th className="px-4 py-1 text-right uppercase tracking-wider text-[10px] font-bold">Unit price</th>
                      <th className="px-4 py-1 text-right uppercase tracking-wider text-[10px] font-bold w-24">Qty</th>
                    </tr>
                    {rows.map(it => {
                      const isPicked = it.id in picks;
                      return (
                        <tr key={it.id}
                            className={`border-t border-gray-200 ${isPicked ? "bg-yellow-50" : "hover:bg-gray-50"}`}
                            data-testid={`stock-picker-row-${it.id}`}>
                          <td className="px-3 py-2">
                            <Checkbox checked={isPicked} onCheckedChange={() => togglePick(it)}
                                      data-testid={`stock-picker-check-${it.id}`}/>
                          </td>
                          <td className="px-4 py-2">
                            {it.image_url ? (
                              <img src={imgSrc(it.image_url)} alt={it.part_number}
                                    className="w-10 h-10 object-cover rounded border border-gray-200 bg-white"
                                    loading="lazy"
                                    onError={(e) => { e.currentTarget.style.display = "none"; }}/>
                            ) : (
                              <div className="w-10 h-10 bg-gray-50 rounded border border-gray-200 flex items-center justify-center">
                                <AppIcon name={iconForCategory(it.category)} size={20} decorative/>
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-2 font-mono text-xs font-bold text-[#1F2A33]">{it.part_number}</td>
                          <td className="px-4 py-2 text-gray-700">
                            <div>{it.description || <span className="italic text-gray-400">No description</span>}</div>
                            {(it.wll_tonnes || it.length_mm || it.bar_size) && (
                              <div className="mt-0.5 flex flex-wrap gap-1 text-[10px] font-medium text-gray-500">
                                {it.wll_tonnes && <span className="bg-blue-50 text-blue-700 px-1.5 rounded">{it.wll_tonnes}t WLL</span>}
                                {it.length_mm  && <span className="bg-emerald-50 text-emerald-700 px-1.5 rounded">{it.length_mm}mm</span>}
                                {it.bar_size   && <span className="bg-slate-100 text-slate-700 px-1.5 rounded">{it.bar_size}</span>}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-2 text-right text-xs text-gray-700">{fmtNum(it.pack_qty, 0)}</td>
                          <td className="px-4 py-2 text-right text-xs text-gray-700">{fmtNum(it.pack_weight, 2)}</td>
                          <td className="px-4 py-2 text-right font-semibold">{fmtAud(it.unit_price)}</td>
                          <td className="px-4 py-2 text-right">
                            <Input
                              type="number"
                              inputMode="numeric"
                              min={1}
                              step={1}
                              value={picks[it.id] ?? ""}
                              onChange={e => setQty(it.id, e.target.value)}
                              onBlur={() => commitQty(it.id)}
                              onFocus={(e) => {
                                if (!(it.id in picks)) togglePick(it);
                                e.target.select();
                              }}
                              className="h-8 w-20 text-right tabular-nums"
                              disabled={!isPicked}
                              data-testid={`stock-picker-qty-${it.id}`}/>
                          </td>
                        </tr>
                      );
                    })}
                  </Fragment>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer with running tally + bulk-set qty + primary action */}
        <DialogFooter className="px-6 py-4 border-t border-gray-200 flex-shrink-0 items-center justify-between bg-gray-50 sm:justify-between">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="text-sm text-gray-700" data-testid="stock-picker-tally">
              <span className="font-semibold text-[#1F2A33]">{pickedCount}</span> item{pickedCount === 1 ? "" : "s"} selected
              {" · "}
              <span className="font-semibold text-[#1F2A33]">{fmtAud(runningTotal)}</span>
              <span className="text-gray-500"> ex GST</span>
            </div>
            {pickedCount > 0 && (
              <div className="flex items-center gap-1.5" data-testid="stock-picker-bulk-qty">
                <span className="text-[10px] uppercase tracking-wider font-bold text-[#3A6B8C]">Set all to</span>
                <Input type="number" inputMode="numeric" min={1} step={1}
                       value={bulkQty} onChange={e => setBulkQty(e.target.value)}
                       onKeyDown={(e) => { if (e.key === "Enter") applyBulkQty(); }}
                       placeholder="qty" className="h-8 w-20 text-right tabular-nums"
                       data-testid="stock-picker-bulk-qty-input"/>
                <Button size="sm" variant="outline" onClick={applyBulkQty}
                        className="h-8 px-2 text-xs"
                        data-testid="stock-picker-bulk-qty-apply">Apply</Button>
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}
                    data-testid="stock-picker-cancel">Cancel</Button>
            <Button onClick={doAdd} disabled={submitting || pickedCount === 0}
                    className="bg-[#F5C518] text-[#1F2A33] font-bold hover:bg-[#E0B416]"
                    data-testid="stock-picker-add-btn">
              {submitting ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin"/> : null}
              Add {pickedCount || ""} {pickedCount === 1 ? "item" : "items"} to quote
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
