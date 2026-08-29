import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { Loader2, ArrowLeft } from "lucide-react";
import AppIcon from "../components/AppIcon";
import { api, formatApiErrorDetail } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../components/ui/tabs";
import { Toaster, toast } from "sonner";
import { formatAUD } from "../lib/format";
import { useAuth } from "../contexts/AuthContext";

const SECTIONS = [
  { key: "panel_supply",    label: "Panel Supply Rates" },
  { key: "formwork_labour", label: "Formwork Labour" },
  { key: "rebar_labour",    label: "Reinforcement Labour" },
  { key: "logistics",       label: "Logistics" },
];

function SourceChip({ source }) {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider
      bg-[#FFF4CC] text-[#7a5b00] border border-[#F5C518]">{source}</span>
  );
}

function num(v) { return v == null || v === "" ? "—" : Number(v).toLocaleString(undefined, { maximumFractionDigits: 3 }); }

export default function LabourRates() {
  const { isSuperAdmin } = useAuth();
  const [grouped, setGrouped] = useState({});
  const [loading, setLoading] = useState(true);
  const [edits, setEdits] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/pricing-rates");
      setGrouped(data.grouped || {});
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const saveRow = async (row, patch) => {
    try {
      const { data } = await api.patch(`/pricing-rates/${row.id}`, patch);
      setGrouped(g => {
        const section = data.section;
        const list = (g[section] || []).map(r => r.id === row.id ? data : r);
        return { ...g, [section]: list };
      });
      setEdits(e => { const { [row.id]: _drop, ...rest } = e; return rest; });
      toast.success("Rate updated");
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message);
    }
  };

  const dirty = (rowId) => Boolean(edits[rowId]);
  const currentVal = (row, field) => (edits[row.id]?.[field] ?? row[field]);

  if (loading) return <div className="flex items-center gap-2 text-gray-500 text-sm"><Loader2 className="w-4 h-4 animate-spin"/> Loading rates…</div>;

  return (
    <div className="max-w-6xl space-y-6" data-testid="labour-rates-page">
      <Toaster richColors position="top-right"/>
      <div>
        <Link to="/settings/pricing" className="inline-flex items-center text-xs uppercase tracking-wider text-[#3A6B8C] font-bold mb-2 hover:text-[#1F2A33]">
          <ArrowLeft className="w-3 h-3 mr-1"/> Back to Pricing
        </Link>
        <h1 className="text-3xl md:text-4xl font-black tracking-tighter text-[#1F2A33]">Labour & Productivity Rates</h1>
        <p className="text-sm text-gray-500 mt-1">
          Reference catalogue — imported from CCC / Firmus 2026. Estimators can look these up side-by-side with calculator outputs.
          These rates do <strong>not</strong> feed the calculator; they are a manual reference.
        </p>
      </div>

      <Tabs defaultValue="panel_supply">
        <TabsList className="bg-white border border-gray-200">
          {SECTIONS.map(s => (
            <TabsTrigger key={s.key} value={s.key} data-testid={`tab-${s.key}`}
              className="data-[state=active]:bg-[#1F2A33] data-[state=active]:text-white">
              {s.label} <span className="ml-2 text-[10px] opacity-70">{(grouped[s.key] || []).length}</span>
            </TabsTrigger>
          ))}
        </TabsList>

        {SECTIONS.map(s => (
          <TabsContent key={s.key} value={s.key} className="mt-4">
            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-[#1F2A33] text-white uppercase text-[9px] tracking-wider">
                  <tr>
                    <th className="px-3 py-2 text-left w-[42%]">Description</th>
                    {s.key === "panel_supply" && (<>
                      <th className="px-3 py-2 text-right">Sqm / Panel</th>
                      <th className="px-3 py-2 text-right">Rate AUD / sqm</th>
                      <th className="px-3 py-2 text-right">Offer / Panel</th>
                    </>)}
                    {s.key === "logistics" && (<>
                      <th className="px-3 py-2 text-right">Value</th>
                      <th className="px-3 py-2 text-left">Unit</th>
                    </>)}
                    {(s.key === "formwork_labour" || s.key === "rebar_labour") && (<>
                      <th className="px-3 py-2 text-right">Slow</th>
                      <th className="px-3 py-2 text-right">Ave</th>
                      <th className="px-3 py-2 text-right">Fast</th>
                      <th className="px-3 py-2 text-left">Unit</th>
                    </>)}
                    <th className="px-3 py-2 text-left">Source</th>
                    {isSuperAdmin && <th className="px-3 py-2 text-right">Action</th>}
                  </tr>
                </thead>
                <tbody>
                  {(grouped[s.key] || []).map(r => (
                    <tr key={r.id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-3 py-2">{r.label}</td>
                      {s.key === "panel_supply" && (<>
                        <td className="px-3 py-2 text-right tabular-nums font-mono">{num(r.sqm_per_panel)}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-mono font-bold text-[#059669]">{r.rate_aud_per_sqm != null ? formatAUD(r.rate_aud_per_sqm) : "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-mono">{r.offer_per_panel != null ? formatAUD(r.offer_per_panel) : "—"}</td>
                      </>)}
                      {s.key === "logistics" && (<>
                        <td className="px-3 py-2 text-right">
                          {isSuperAdmin ? (
                            <Input type="number" step="any"
                              className="h-7 w-24 text-right tabular-nums font-mono text-xs ml-auto"
                              value={currentVal(r, "value") ?? ""}
                              onChange={e => setEdits(x => ({ ...x, [r.id]: { ...(x[r.id]||{}), value: e.target.value === "" ? null : Number(e.target.value) } }))}
                              data-testid={`rate-value-${r.id}`}/>
                          ) : <span className="tabular-nums font-mono">{num(r.value)}</span>}
                        </td>
                        <td className="px-3 py-2 text-gray-500">{r.unit}</td>
                      </>)}
                      {(s.key === "formwork_labour" || s.key === "rebar_labour") && (
                        ["value_slow","value_ave","value_fast"].map(f => (
                          <td key={f} className="px-3 py-2 text-right">
                            {isSuperAdmin ? (
                              <Input type="number" step="any"
                                className="h-7 w-20 text-right tabular-nums font-mono text-xs ml-auto"
                                value={currentVal(r, f) ?? ""}
                                onChange={e => setEdits(x => ({ ...x, [r.id]: { ...(x[r.id]||{}), [f]: e.target.value === "" ? null : Number(e.target.value) } }))}
                                data-testid={`${f}-${r.id}`}/>
                            ) : <span className="tabular-nums font-mono">{num(r[f])}</span>}
                          </td>
                        ))
                      )}
                      {(s.key === "formwork_labour" || s.key === "rebar_labour") && (
                        <td className="px-3 py-2 text-gray-500">{r.unit}</td>
                      )}
                      <td className="px-3 py-2"><SourceChip source={r.source || "—"}/></td>
                      {isSuperAdmin && (
                        <td className="px-3 py-2 text-right">
                          {dirty(r.id) && (
                            <Button size="sm" onClick={() => saveRow(r, edits[r.id])}
                              className="h-7 px-3 text-[10px] bg-[#1F2A33] text-white hover:bg-[#3A6B8C]"
                              data-testid={`save-${r.id}`}>
                              <AppIcon name="save" size={12} className="mr-1" decorative/> Save
                            </Button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                  {(grouped[s.key] || []).length === 0 && (
                    <tr><td colSpan={10} className="p-6 text-center text-gray-400 italic">No rows in this section.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
