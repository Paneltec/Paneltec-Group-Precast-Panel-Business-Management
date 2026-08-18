import { useEffect, useMemo, useState } from "react";
import { Loader2, RotateCcw, AlertTriangle } from "lucide-react";
import { api, formatApiErrorDetail } from "../lib/api";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "./ui/dialog";
import { toast } from "sonner";

const fmtAud = (v) => v === null || v === undefined || isNaN(v)
  ? "—"
  : new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(v);

/**
 * StockLineEditModal — reusable modal for editing a stock line's quantity and unit price.
 *
 * Props:
 *   open, onOpenChange   : shadcn Dialog controls
 *   quoteId              : parent quote id
 *   line                 : the stock line object being edited (must have line_type === "stock")
 *   onSaved(updatedLine, totals) : called after PATCH succeeds
 */
export default function StockLineEditModal({ open, onOpenChange, quoteId, line, onSaved }) {
  const [qty, setQty] = useState("1");
  const [price, setPrice] = useState("0");
  const [catalogPrice, setCatalogPrice] = useState(null);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [saving, setSaving] = useState(false);

  // Reset local state when the modal opens for a new line
  useEffect(() => {
    if (!open || !line) return;
    setQty(String(line.quantity ?? 1));
    setPrice(String(line.unit_price_aud ?? 0));
    setCatalogPrice(null);
    // Fetch current catalogue price for this part_number so we can compute the discount
    if (line.part_number) {
      setLoadingCatalog(true);
      api.get(`/stock/typeahead?q=${encodeURIComponent(line.part_number)}`)
        .then(({ data }) => {
          const exact = (data || []).find(s =>
            (s.part_number || "").trim().toLowerCase() === (line.part_number || "").trim().toLowerCase()
          );
          if (exact) setCatalogPrice(exact.unit_price ?? null);
        })
        .catch(() => setCatalogPrice(null))
        .finally(() => setLoadingCatalog(false));
    }
  }, [open, line]);

  const priceNum = Number.isFinite(parseFloat(price)) ? parseFloat(price) : 0;
  const qtyNum   = Math.max(1, parseInt(qty, 10) || 1);
  const subtotal = priceNum * qtyNum;

  const overridden = catalogPrice !== null && Math.abs(priceNum - catalogPrice) > 0.0049;
  const discountPct = useMemo(() => {
    if (catalogPrice === null || catalogPrice <= 0) return null;
    return ((catalogPrice - priceNum) / catalogPrice) * 100;
  }, [catalogPrice, priceNum]);

  const resetToCatalogue = () => {
    if (catalogPrice === null) { toast.error("Catalogue price not found for this part."); return; }
    setPrice(String(catalogPrice));
  };

  const invalid = priceNum < 0 || !Number.isFinite(priceNum) || qtyNum < 1;

  const save = async () => {
    if (invalid) return;
    setSaving(true);
    try {
      const payload = {
        line_type: "stock",
        description: line.description || line.part_number,
        quantity: qtyNum,
        part_number: line.part_number,
        stock_item_id: line.stock_item_id || null,
        supplier_id: line.supplier_id || null,
        supplier_name_override: line.supplier_name_override || null,
        unit_price: priceNum,
      };
      const { data } = await api.patch(`/quotes/${quoteId}/lines/${line.id}`, payload);
      toast.success("Line updated.");
      onSaved && onSaved(data.line, data.totals);
      onOpenChange(false);
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message);
    } finally {
      setSaving(false);
    }
  };

  if (!line) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => !saving && onOpenChange(v)}>
      <DialogContent className="max-w-lg" data-testid="stock-line-edit-modal">
        <DialogHeader>
          <DialogTitle>Edit stock line: <span className="font-mono">{line.part_number}</span></DialogTitle>
          <DialogDescription>Override quantity or unit price for this quote line only. The master stock catalogue is not affected.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label className="text-[10px] uppercase tracking-wider font-bold text-[#3A6B8C] block mb-1">Description</label>
            <div className="text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded px-3 py-2" data-testid="sle-desc">
              {line.description || <span className="italic text-gray-400">No description</span>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] uppercase tracking-wider font-bold text-[#3A6B8C] block mb-1">Quantity</label>
              <Input type="number" inputMode="numeric" min={1} step={1}
                     value={qty} onChange={(e) => setQty(e.target.value)}
                     onBlur={() => { const n = parseInt(qty, 10); setQty(String(Number.isFinite(n) && n > 0 ? n : 1)); }}
                     className="h-10 text-right tabular-nums"
                     data-testid="sle-qty"/>
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider font-bold text-[#3A6B8C] block mb-1">Unit price (AUD)</label>
              <div className="relative">
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
                <Input type="number" step="0.01" min={0} value={price}
                       onChange={(e) => setPrice(e.target.value)}
                       className="h-10 pl-6 text-right tabular-nums"
                       data-testid="sle-price"/>
              </div>
            </div>
          </div>

          {/* Override / discount indicator */}
          <div className="flex items-center flex-wrap gap-2 text-xs">
            {loadingCatalog && <span className="text-gray-500 italic">Loading catalogue price…</span>}
            {!loadingCatalog && overridden && (
              <>
                <span className="inline-flex items-center gap-1 bg-amber-100 border border-amber-300 text-amber-800 font-bold uppercase tracking-wider text-[10px] px-2 py-0.5 rounded-full"
                      data-testid="sle-overridden-pill">
                  <AlertTriangle className="w-3 h-3"/> Overridden from {fmtAud(catalogPrice)}
                </span>
                {discountPct !== null && discountPct > 0 && (
                  <span className="text-emerald-700 font-semibold" data-testid="sle-discount">
                    {discountPct.toFixed(1)}% off
                  </span>
                )}
                {discountPct !== null && discountPct < 0 && (
                  <span className="text-rose-700 font-semibold">
                    {Math.abs(discountPct).toFixed(1)}% above catalogue
                  </span>
                )}
                <Button type="button" size="sm" variant="outline"
                        onClick={resetToCatalogue}
                        className="h-7 px-2 text-xs ml-auto"
                        data-testid="sle-reset-catalogue">
                  <RotateCcw className="w-3 h-3 mr-1"/> Reset to catalogue
                </Button>
              </>
            )}
            {!loadingCatalog && !overridden && catalogPrice !== null && (
              <span className="text-emerald-700 text-[11px] font-medium">Matches catalogue price {fmtAud(catalogPrice)}.</span>
            )}
          </div>

          {priceNum === 0 && (
            <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-2 flex items-start gap-1.5" data-testid="sle-zero-warning">
              <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5"/>
              <span><b>Zero price:</b> this line won&apos;t contribute to the quote total. Confirm this is intentional (e.g. free-of-charge sample).</span>
            </div>
          )}

          <div className="border-t border-gray-200 pt-3">
            <div className="text-[10px] uppercase tracking-wider font-bold text-[#3A6B8C] mb-1">Line total (ex GST)</div>
            <div className="text-2xl font-black text-[#1F2A33] tabular-nums" data-testid="sle-subtotal">
              {qtyNum} × {fmtAud(priceNum)} = {fmtAud(subtotal)}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving} data-testid="sle-cancel">Cancel</Button>
          <Button onClick={save} disabled={saving || invalid}
                  className="bg-[#F5C518] text-[#1F2A33] font-bold hover:bg-[#E0B416]"
                  data-testid="sle-save">
            {saving ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin"/> : null} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
