import { useEffect, useState, useMemo } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { Loader2, ArrowLeft, Save, Send, Plus, Trash2, Edit2 } from "lucide-react";
import AppIcon from "../components/AppIcon";
import { api, formatApiErrorDetail } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "../components/ui/dialog";
import { formatAUD, formatNumber } from "../lib/format";
import { useAuth } from "../contexts/AuthContext";
import { Toaster, toast } from "sonner";
import StockPickerModal from "../components/StockPickerModal";
import StockLineEditModal from "../components/StockLineEditModal";
import ProjectCombobox from "../components/ProjectCombobox";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "../components/ui/alert-dialog";

const REINFORCEMENT_OPTIONS = [
  { value: "light", label: "Light (mesh)" },
  { value: "standard", label: "Standard (mesh + bars)" },
  { value: "heavy", label: "Heavy (rebar cage)" },
  { value: "prestressed", label: "Prestressed tendons" },
];

const LINE_DEFAULTS = {
  description: "", panel_type_key: "wall_standard",
  length_m: "6", height_m: "3", thickness_mm: "150",
  concrete_grade: "C30/37", quantity: "1",
  reinforcement_type: "standard", openings_m2: "0", finish_key: "smooth",
  // Phase 11.8 — stock catalogue traceability
  part_number: "", stock_item_id: "", supplier_id: "", supplier_name_override: "",
};

export default function QuoteEditor() {
  const { id } = useParams();
  const isNew = !id || id === "new";
  const navigate = useNavigate();
  const { hasPerm: rootHasPerm } = useAuth();

  const [quote, setQuote] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [options, setOptions] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lineDialog, setLineDialog] = useState({ open: false, mode: "add", line: null });
  const [stockPickerOpen, setStockPickerOpen] = useState(false);
  const [stockLineEdit, setStockLineEdit] = useState({ open: false, line: null });
  const [deleteConfirm, setDeleteConfirm] = useState({ open: false, line: null });
  const [stockCatalogPriceMap, setStockCatalogPriceMap] = useState({}); // { part_number: unit_price }
  useEffect(() => {
    // Build a catalogue-price lookup for all stock parts referenced by the current lines,
    // so we can flag override rows with a subtle chip.
    const parts = Array.from(new Set(
      (quote?.line_items || [])
        .filter(l => l.line_type === "stock" && l.part_number)
        .map(l => l.part_number)
    ));
    if (parts.length === 0) return;
    (async () => {
      const map = { ...stockCatalogPriceMap };
      for (const pn of parts) {
        if (map[pn] !== undefined) continue;
        try {
          const { data } = await api.get(`/stock/typeahead?q=${encodeURIComponent(pn)}`);
          const exact = (data || []).find(s => (s.part_number || "").toLowerCase() === pn.toLowerCase());
          map[pn] = exact?.unit_price ?? null;
        } catch { map[pn] = null; }
      }
      setStockCatalogPriceMap(map);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quote?.line_items]);

  const isOverridden = (l) => {
    if (l.line_type !== "stock" || !l.part_number) return false;
    const cat = stockCatalogPriceMap[l.part_number];
    if (cat === null || cat === undefined) return false;
    return Math.abs((Number(l.unit_price_aud) || 0) - cat) > 0.0049;
  };

  // Form state for top fields
  const [customerId, setCustomerId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [notesCustomer, setNotesCustomer] = useState("");
  const [notesInternal, setNotesInternal] = useState("");
  const [createdQuoteId, setCreatedQuoteId] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const [{ data: cust }, { data: opt }] = await Promise.all([
          api.get("/customers", { params: { active: true, page_size: 200 } }),
          api.get("/calculator/options"),
        ]);
        setCustomers(cust.items);
        setOptions(opt);
        if (!isNew) {
          const { data: q } = await api.get(`/quotes/${id}`);
          setQuote(q);
          setCustomerId(q.customer_id);
          setProjectId(q.project_id || "");
          setValidUntil(q.valid_until || "");
          setNotesCustomer(q.notes_to_customer || "");
          setNotesInternal(q.internal_notes || "");
          setCreatedQuoteId(q.id);
        } else {
          const d = new Date(); d.setDate(d.getDate() + 30);
          setValidUntil(d.toISOString().slice(0, 10));
        }
      } catch (e) {
        setError(formatApiErrorDetail(e.response?.data?.detail) || e.message);
      } finally { setLoading(false); }
    })();
  }, [id, isNew]);

  useEffect(() => {
    if (!customerId) { setProjects([]); return; }
    api.get(`/customers/${customerId}/projects`).then(r => setProjects(r.data)).catch(() => setProjects([]));
  }, [customerId]);

  const ensureQuoteExists = async () => {
    if (createdQuoteId) return createdQuoteId;
    if (!customerId) throw new Error("Pick a customer first");
    const { data } = await api.post("/quotes", {
      customer_id: customerId,
      project_id: projectId || null,
      valid_until: validUntil || undefined,
      notes_to_customer: notesCustomer,
      internal_notes: notesInternal,
    });
    setCreatedQuoteId(data.id);
    setQuote(data);
    return data.id;
  };

  const refreshQuote = async (qid) => {
    const { data } = await api.get(`/quotes/${qid}`);
    setQuote(data);
  };

  const saveTopFields = async () => {
    if (!createdQuoteId) {
      try {
        await ensureQuoteExists();
        toast.success("Draft created");
      } catch (e) {
        toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message);
      }
      return;
    }
    try {
      await api.patch(`/quotes/${createdQuoteId}`, {
        customer_id: customerId,
        project_id: projectId || null,
        valid_until: validUntil,
        notes_to_customer: notesCustomer,
        internal_notes: notesInternal,
      });
      await refreshQuote(createdQuoteId);
      toast.success("Saved");
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message);
    }
  };

  const onLineAdd = async (lineForm) => {
    const qid = await ensureQuoteExists();
    const payload = lineFormToPayload(lineForm);
    if (lineDialog.mode === "edit" && lineDialog.line) {
      await api.patch(`/quotes/${qid}/lines/${lineDialog.line.id}`, payload);
      toast.success("Line updated");
    } else {
      await api.post(`/quotes/${qid}/lines`, payload);
      toast.success("Line added");
    }
    await refreshQuote(qid);
    setLineDialog({ open: false, mode: "add", line: null });
  };

  const onLineDelete = async (lineId) => {
    if (!createdQuoteId) return;
    try {
      await api.delete(`/quotes/${createdQuoteId}/lines/${lineId}`);
      await refreshQuote(createdQuoteId);
      toast.success("Line removed");
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message);
    }
  };

  const lineLabelFor = (l) => l?.part_number
    ? l.part_number
    : (l?.panel_type_label ? `${l.panel_type_label} ${l.length_m || ""}×${l.height_m || ""}m` : "this line");

  const onSend = async () => {
    if (!createdQuoteId) { toast.error("Save the draft first"); return; }
    if (!quote?.line_items?.length) { toast.error("Add at least one line"); return; }
    await saveTopFields();
    try {
      await api.post(`/quotes/${createdQuoteId}/send`);
      toast.success("Quote sent");
      navigate(`/quotes/${createdQuoteId}`);
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message);
    }
  };

  if (loading) return <div className="flex items-center gap-2 text-gray-500 text-sm"><Loader2 className="w-4 h-4 animate-spin"/> Loading…</div>;
  if (error) return <div className="text-sm text-red-700">{error}</div>;
  if (!isNew && quote && quote.status !== "draft") {
    return (
      <div className="max-w-xl bg-white border border-amber-200 rounded p-6 text-sm">
        This quote is no longer editable (status: <b>{quote.status}</b>).
        <Link to={`/quotes/${id}`} className="ml-2 text-[#3A6B8C] font-bold">View instead →</Link>
      </div>
    );
  }

  return (
    <div className="max-w-[1500px] space-y-6" data-testid="quote-editor-page">
      <Toaster richColors position="top-right" />
      <div className="flex items-center justify-between gap-3">
        <div>
          <Link to="/quotes" className="inline-flex items-center text-xs uppercase tracking-wider text-[#3A6B8C] font-bold mb-2 hover:text-[#1F2A33]"><ArrowLeft className="w-3 h-3 mr-1"/> Back to quotes</Link>
          <h1 className="text-3xl md:text-4xl font-black tracking-tighter text-[#1F2A33]">
            {quote?.quote_number || "New quote"}
          </h1>
          <p className="text-xs text-gray-500 mt-1">Snapshot pricing — once sent, totals are frozen.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        <div className="xl:col-span-8 space-y-6">
          <section className="bg-white border border-gray-200 rounded p-6">
            <h2 className="text-sm font-bold uppercase tracking-[0.15em] text-[#3A6B8C] mb-4">Customer & project</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label className="text-xs uppercase tracking-wider text-[#3A6B8C] font-bold">Customer *</Label>
                <Select value={customerId} onValueChange={setCustomerId}>
                  <SelectTrigger className="mt-1 h-11" data-testid="quote-customer-select"><SelectValue placeholder="Select customer"/></SelectTrigger>
                  <SelectContent>{customers.map(c => <SelectItem key={c.id} value={c.id}>{c.company_name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wider text-[#3A6B8C] font-bold">Project (optional)</Label>
                <div className="mt-1">
                  <ProjectCombobox
                    projects={projects}
                    selectedId={projectId}
                    onSelect={(id) => setProjectId(id)}
                    onCreated={(p) => setProjects(prev => [...prev, p])}
                    customerId={customerId}
                    disabled={!customerId}
                  />
                </div>
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wider text-[#3A6B8C] font-bold">Valid until</Label>
                <Input type="date" value={validUntil} onChange={e => setValidUntil(e.target.value)}
                  className="mt-1 h-11" data-testid="quote-valid-until"/>
              </div>
            </div>
          </section>

          <section className="bg-white border border-gray-200 rounded p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-bold uppercase tracking-[0.15em] text-[#3A6B8C]">Line items</h2>
              <div className="flex items-center gap-2">
                {rootHasPerm("stock.view") && (
                  <Button onClick={async () => {
                          const qid = await ensureQuoteExists();
                          if (qid) setStockPickerOpen(true);
                        }}
                    className="bg-[#F5C518] text-[#1F2A33] font-bold hover:bg-[#E0B416] h-9"
                    data-testid="open-stock-picker-btn">
                    <AppIcon name="package" size={16} className="mr-1" decorative/> Add from Stock
                  </Button>
                )}
                <Button onClick={() => setLineDialog({ open: true, mode: "add", line: null })}
                  className="bg-[#3A6B8C] text-white hover:bg-[#2C526B] h-9" data-testid="add-line-btn">
                  <AppIcon name="add" size={16} className="mr-1" decorative/> Add line
                </Button>
              </div>
            </div>
            {(quote?.line_items?.length || 0) === 0 ? (
              <div className="text-sm text-gray-500 text-center py-8 border border-dashed border-gray-300 rounded">
                No line items yet. Click <b>Add line</b> to insert a calculator-derived item, or <b>Add from Stock</b> to pull parts from the catalogue.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-[10px] uppercase tracking-wider text-gray-600 border-b">
                    <tr>
                      <th className="px-3 py-2 text-left">Part no.</th>
                      <th className="px-3 py-2 text-left">Description</th>
                      <th className="px-3 py-2 text-left">Panel</th>
                      <th className="px-3 py-2 text-right">L × H</th>
                      <th className="px-3 py-2 text-right">Qty</th>
                      <th className="px-3 py-2 text-right">Subtotal</th>
                      <th className="px-3 py-2 text-right">Total</th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody data-testid="lines-table-body">
                    {quote.line_items.map(l => {
                      const isStock = l.line_type === "stock";
                      return (
                      <tr key={l.id} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="px-3 py-2.5 font-mono text-[11px] text-[#1F2A33] whitespace-nowrap">{l.part_number || <span className="text-gray-300">—</span>}</td>
                        <td className="px-3 py-2.5 text-[#1F2A33]">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {isStock && <span className="text-[9px] font-bold uppercase tracking-wider bg-[#F5C518]/25 text-[#1F2A33] px-1.5 py-0.5 rounded" data-testid={`line-stock-chip-${l.id}`}>Stock</span>}
                            {isStock && isOverridden(l) && (
                              <span className="text-[9px] font-bold uppercase tracking-wider bg-amber-100 border border-amber-300 text-amber-800 px-1.5 py-0.5 rounded" data-testid={`line-overridden-chip-${l.id}`}
                                    title={`Catalogue price: ${new Intl.NumberFormat("en-AU",{style:"currency",currency:"AUD"}).format(stockCatalogPriceMap[l.part_number])}`}>Overridden</span>
                            )}
                            <span>{l.description || <span className="text-gray-400 italic">No description</span>}</span>
                          </div>
                          <div className="text-[11px] text-gray-500 mt-0.5 tabular-nums" data-testid={`editor-line-formula-${l.id}`}>
                            {l.quantity} × {formatAUD(isStock
                              ? (Number(l.unit_price_aud) || 0)
                              : ((Number(l.subtotal_aud) || 0) / Math.max(1, Number(l.quantity) || 1)))} = {formatAUD(l.subtotal_aud)}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-gray-700">
                          {isStock
                            ? <span className="text-gray-400 italic text-xs">Stock item</span>
                            : <>{l.panel_type_label}<div className="text-[10px] text-gray-500">{l.thickness_mm}mm · {l.finish_label}</div></>}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-gray-700">
                          {isStock ? <span className="text-gray-300">—</span> : <>{l.length_m} × {l.height_m} m</>}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{l.quantity}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{formatAUD(l.subtotal_aud)}</td>
                        <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{formatAUD(l.total_aud)}</td>
                        <td className="px-3 py-2.5 text-right whitespace-nowrap">
                          {!isStock && rootHasPerm("quotes.edit") && (
                            <button onClick={() => setLineDialog({ open: true, mode: "edit", line: l })}
                                    className="p-1.5 hover:bg-gray-100 rounded"
                                    data-testid={`edit-line-${l.id}`}
                                    aria-label="Edit line">
                              <Edit2 size={14}/>
                            </button>
                          )}
                          {isStock && rootHasPerm("quotes.edit") && (
                            <button onClick={() => setStockLineEdit({ open: true, line: l })}
                                    className="p-2 mr-1 bg-yellow-50 hover:bg-[#F5C518] text-[#1F2A33] rounded transition-colors border border-yellow-200 hover:border-[#E0B416]"
                                    data-testid={`edit-stock-line-${l.id}`}
                                    aria-label={`Edit ${l.part_number}`}
                                    title={`Edit ${l.part_number}`}>
                              <Edit2 size={14}/>
                            </button>
                          )}
                          {rootHasPerm("quotes.edit") && (
                            <button onClick={() => setDeleteConfirm({ open: true, line: l })}
                                    className="p-2 ml-1 bg-red-50 hover:bg-red-600 text-red-600 hover:text-white rounded transition-colors border border-red-200 hover:border-red-600"
                                    data-testid={`delete-line-${l.id}`}
                                    aria-label={`Remove ${lineLabelFor(l)}`}
                                    title={`Remove ${lineLabelFor(l)}`}>
                              <Trash2 size={14}/>
                            </button>
                          )}
                        </td>
                      </tr>);
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="bg-white border border-gray-200 rounded p-6 space-y-4">
            <h2 className="text-sm font-bold uppercase tracking-[0.15em] text-[#3A6B8C]">Notes</h2>
            <div>
              <Label className="text-xs uppercase tracking-wider text-[#3A6B8C] font-bold">Notes to customer (visible on quote)</Label>
              <Textarea value={notesCustomer} onChange={e => setNotesCustomer(e.target.value)} rows={3} className="mt-1" data-testid="quote-notes-customer"/>
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-[#3A6B8C] font-bold">Internal notes (hidden from customer)</Label>
              <Textarea value={notesInternal} onChange={e => setNotesInternal(e.target.value)} rows={3} className="mt-1" data-testid="quote-notes-internal"/>
            </div>
          </section>
        </div>

        {/* Right rail */}
        <aside className="xl:col-span-4">
          <div className="xl:sticky xl:top-24 space-y-4">
            <div className="bg-white border border-gray-200 rounded p-6">
              <div className="overline mb-2">Running totals</div>
              <Row label="Subtotal" value={formatAUD(quote?.subtotal || 0)} testid="quote-subtotal"/>
              <Row label={`GST (${quote?.line_items?.[0]?.gst_rate_pct ?? 10}%)`} value={formatAUD(quote?.gst || 0)} testid="quote-gst"/>
              <div className="flex justify-between mt-3 pt-3 border-t-2 border-[#1F2A33]">
                <span className="text-sm font-bold text-[#1F2A33]">Total inc GST</span>
                <span className="text-xl font-black text-[#1F2A33] tabular-nums" data-testid="quote-total">{formatAUD(quote?.total || 0)}</span>
              </div>
              <div className="mt-3 text-[10px] uppercase tracking-wider text-gray-400 grid grid-cols-2 gap-2">
                <div>Volume<div className="text-gray-700 font-semibold">{formatNumber(quote?.total_volume_m3 || 0, 3)} m³</div></div>
                <div>Weight<div className="text-gray-700 font-semibold">{formatNumber(quote?.total_weight_tonnes || 0, 3)} t</div></div>
              </div>
            </div>

            <div className="bg-white border border-gray-200 rounded p-6 space-y-2">
              <Button onClick={saveTopFields} variant="outline" className="w-full border-[#1F2A33] text-[#1F2A33] font-semibold h-11" data-testid="quote-save-draft">
                <AppIcon name="save" size={16} className="mr-2" decorative/> Save draft
              </Button>
              <Button onClick={onSend} className="w-full bg-[#F5C518] text-[#1F2A33] font-bold hover:bg-[#E0B416] h-11" data-testid="quote-save-send">
                <AppIcon name="send" size={16} className="mr-2" decorative/> Save &amp; Send
              </Button>
            </div>
          </div>
        </aside>
      </div>

      <Dialog open={lineDialog.open} onOpenChange={(o) => setLineDialog({ ...lineDialog, open: o })}>
        <LineDialogContent
          mode={lineDialog.mode}
          line={lineDialog.line}
          options={options}
          onSubmit={onLineAdd}
        />
      </Dialog>

      {createdQuoteId && (
        <StockPickerModal
          open={stockPickerOpen}
          onOpenChange={setStockPickerOpen}
          quoteId={createdQuoteId}
          onAdded={() => refreshQuote(createdQuoteId)}
        />
      )}

      <StockLineEditModal
        open={stockLineEdit.open}
        onOpenChange={(v) => setStockLineEdit(s => ({ ...s, open: v }))}
        quoteId={createdQuoteId}
        line={stockLineEdit.line}
        onSaved={() => refreshQuote(createdQuoteId)}
      />

      <AlertDialog open={deleteConfirm.open} onOpenChange={(v) => !v && setDeleteConfirm({ open: false, line: null })}>
        <AlertDialogContent data-testid="line-delete-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {lineLabelFor(deleteConfirm.line)} from this quote?</AlertDialogTitle>
            <AlertDialogDescription>
              The line will be removed and quote totals will recalculate. This can&apos;t be undone from here — you&apos;ll need to re-add the line if you change your mind.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="line-delete-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                const id = deleteConfirm.line?.id;
                setDeleteConfirm({ open: false, line: null });
                if (id) await onLineDelete(id);
              }}
              className="bg-red-600 text-white hover:bg-red-700"
              data-testid="line-delete-confirm-btn">
              Delete line
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Row({ label, value, testid }) {
  return (
    <div className="flex justify-between py-1.5 text-sm">
      <span className="text-gray-600">{label}</span>
      <span className="font-semibold tabular-nums" data-testid={testid}>{value}</span>
    </div>
  );
}

function lineFormToPayload(f) {
  return {
    description: f.description,
    panel_type_key: f.panel_type_key,
    length_m: parseFloat(f.length_m),
    height_m: parseFloat(f.height_m),
    thickness_mm: parseInt(f.thickness_mm, 10),
    concrete_grade: f.concrete_grade,
    quantity: parseInt(f.quantity, 10),
    reinforcement_type: f.reinforcement_type,
    openings_m2: parseFloat(f.openings_m2),
    finish_key: f.finish_key,
    // Phase 11.8 — send only non-empty stock fields so legacy lines stay clean.
    part_number: f.part_number || null,
    stock_item_id: f.stock_item_id || null,
    supplier_id: f.supplier_id || null,
    supplier_name_override: f.supplier_name_override || null,
  };
}

function StockPartNumberField({ form, setForm }) {
  const { hasPerm } = useAuth();
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const [suppliers, setSuppliers] = useState({});
  useEffect(() => {
    if (!hasPerm("suppliers.view") && !hasPerm("stock.view")) return;
    api.get("/suppliers").then(({ data }) => {
      const map = {}; data.forEach(s => { map[s.id] = s.name; });
      setSuppliers(map);
    }).catch(() => {});
  }, [hasPerm]);
  useEffect(() => {
    if (!hasPerm("stock.view")) return;
    const q = (form.part_number || "").trim();
    if (q.length < 1) { setSuggestions([]); return; }
    const t = setTimeout(() => {
      api.get(`/stock/typeahead?q=${encodeURIComponent(q)}`).then(({ data }) => {
        setSuggestions(data); setOpen(data.length > 0);
      }).catch(() => setSuggestions([]));
    }, 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line
  }, [form.part_number]);
  const pick = (item) => {
    setForm({
      ...form,
      part_number: item.part_number,
      stock_item_id: item.id,
      supplier_id: item.supplier_id || "",
      supplier_name_override: suppliers[item.supplier_id] || item.brand || form.supplier_name_override,
      description: form.description || item.description || "",
    });
    setOpen(false);
  };
  if (!hasPerm("stock.view")) return null;
  return (
    <div className="relative">
      <Label className="text-xs uppercase tracking-wider text-[#3A6B8C] font-bold">Part number (stock catalogue)</Label>
      <Input value={form.part_number}
              onChange={e => setForm({ ...form, part_number: e.target.value, stock_item_id: "" })}
              onFocus={() => setOpen(suggestions.length > 0)}
              onBlur={() => setTimeout(() => setOpen(false), 150)}
              placeholder="Type part number or description to search stock…"
              className="font-mono"
              data-testid="line-part-number"/>
      {open && suggestions.length > 0 && (
        <div className="absolute z-30 left-0 right-0 mt-1 bg-white border border-gray-200 rounded shadow-lg max-h-72 overflow-y-auto"
             data-testid="line-part-suggestions">
          {suggestions.map(s => (
            <button key={s.id} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(s)}
                    className="w-full text-left px-3 py-2 hover:bg-gray-50 border-b border-gray-100 last:border-b-0"
                    data-testid={`line-part-pick-${s.id}`}>
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono font-bold text-[#1F2A33]">{s.part_number}</span>
                <span className="text-xs font-semibold text-gray-700">${(s.unit_price ?? 0).toFixed(2)}</span>
              </div>
              <div className="text-xs text-gray-600 truncate">{s.description || <span className="italic text-gray-400">no description</span>}</div>
              <div className="text-[10px] uppercase tracking-wider text-gray-500 mt-0.5">{suppliers[s.supplier_id] || s.brand || "—"}</div>
            </button>
          ))}
        </div>
      )}
      {form.stock_item_id && (
        <div className="text-[11px] text-emerald-700 mt-1">Linked to stock item · description &amp; supplier prefilled (still editable below).</div>
      )}
    </div>
  );
}

function LineDialogContent({ mode, line, options, onSubmit }) {
  const initial = useMemo(() => {
    if (line) {
      return {
        description: line.description || "",
        panel_type_key: line.panel_type_key,
        length_m: String(line.length_m),
        height_m: String(line.height_m),
        thickness_mm: String(line.thickness_mm),
        concrete_grade: line.concrete_grade,
        quantity: String(line.quantity),
        reinforcement_type: line.reinforcement_key,
        openings_m2: String(line.openings_m2_per_panel),
        finish_key: line.finish_key,
        part_number: line.part_number || "",
        stock_item_id: line.stock_item_id || "",
        supplier_id: line.supplier_id || "",
        supplier_name_override: line.supplier_name_override || "",
      };
    }
    return LINE_DEFAULTS;
  }, [line]);
  const [form, setForm] = useState(initial);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => { setForm(initial); }, [initial]);

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    setSubmitting(true);
    try {
      await onSubmit(form);
    } catch (ex) {
      // Prefer the message from a plain thrown Error (e.g. "Pick a customer first")
      // over the generic "Something went wrong" fallback.
      if (ex && !ex.response && ex.message) setErr(ex.message);
      else setErr(formatApiErrorDetail(ex.response?.data?.detail) || ex.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (!options) return null;
  return (
    <DialogContent data-testid="line-dialog" className="sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>{mode === "edit" ? "Edit line" : "Add line"}</DialogTitle>
        <DialogDescription>Calculator inputs — server computes the price snapshot on save.</DialogDescription>
      </DialogHeader>
      <form onSubmit={submit} className="space-y-3">
        <StockPartNumberField form={form} setForm={setForm}/>
        <div>
          <Label className="text-xs uppercase tracking-wider text-[#3A6B8C] font-bold">Description</Label>
          <Input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="e.g. North elevation, levels 1-6" data-testid="line-desc"/>
        </div>
        <div>
          <Label className="text-xs uppercase tracking-wider text-[#3A6B8C] font-bold">Supplier</Label>
          <Input value={form.supplier_name_override} onChange={e => setForm({ ...form, supplier_name_override: e.target.value })}
                  placeholder="Inherited from stock item — override if sourcing elsewhere"
                  data-testid="line-supplier"/>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <SelF label="Panel type" value={form.panel_type_key} onChange={(v) => setForm({ ...form, panel_type_key: v })} testid="line-panel">
            {options.panel_types.map(p => <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>)}
          </SelF>
          <NumF label="Length (m)" value={form.length_m} onChange={(v) => setForm({ ...form, length_m: v })} testid="line-length"/>
          <NumF label="Height (m)" value={form.height_m} onChange={(v) => setForm({ ...form, height_m: v })} testid="line-height"/>
          <SelF label="Thickness (mm)" value={form.thickness_mm} onChange={(v) => setForm({ ...form, thickness_mm: v })} testid="line-thickness">
            {options.thickness_options_mm.map(t => <SelectItem key={t} value={String(t)}>{t} mm</SelectItem>)}
          </SelF>
          <SelF label="Grade" value={form.concrete_grade} onChange={(v) => setForm({ ...form, concrete_grade: v })} testid="line-grade">
            {options.concrete_grades.map(g => <SelectItem key={g} value={g}>{g}</SelectItem>)}
          </SelF>
          <NumF label="Quantity" value={form.quantity} onChange={(v) => setForm({ ...form, quantity: v })} testid="line-qty" step="1" min="1"/>
          <SelF label="Reinforcement" value={form.reinforcement_type} onChange={(v) => setForm({ ...form, reinforcement_type: v })} testid="line-rein">
            {REINFORCEMENT_OPTIONS.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
          </SelF>
          <NumF label="Openings (m²/panel)" value={form.openings_m2} onChange={(v) => setForm({ ...form, openings_m2: v })} testid="line-openings"/>
          <SelF label="Finish" value={form.finish_key} onChange={(v) => setForm({ ...form, finish_key: v })} testid="line-finish">
            {options.finishes.map(f => <SelectItem key={f.key} value={f.key}>{f.label}</SelectItem>)}
          </SelF>
        </div>
        {err && <div className="text-sm text-red-700">{err}</div>}
        <DialogFooter>
          <Button type="submit" disabled={submitting} className="bg-[#F5C518] text-[#1F2A33] font-bold hover:bg-[#E0B416]" data-testid="line-submit-btn">
            {submitting ? "Calculating…" : (mode === "edit" ? "Save line" : "Calculate & add")}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

function SelF({ label, value, onChange, testid, children }) {
  return (
    <div>
      <Label className="text-xs uppercase tracking-wider text-[#3A6B8C] font-bold">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger data-testid={testid} className="mt-1 h-10"><SelectValue/></SelectTrigger>
        <SelectContent>{children}</SelectContent>
      </Select>
    </div>
  );
}

function NumF({ label, value, onChange, testid, step = "0.01", min = "0" }) {
  return (
    <div>
      <Label className="text-xs uppercase tracking-wider text-[#3A6B8C] font-bold">{label}</Label>
      <Input type="number" step={step} min={min} value={value} onChange={e => onChange(e.target.value)} data-testid={testid} className="mt-1 h-10 tabular-nums"/>
    </div>
  );
}
