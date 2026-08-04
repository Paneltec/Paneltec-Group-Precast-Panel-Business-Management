import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, ExternalLink } from "lucide-react";
import AppIcon from "./AppIcon";
import { api, formatApiErrorDetail } from "../lib/api";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "./ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "./ui/dialog";
import { toast } from "sonner";

const STEPS = [
  "Searching standards (Tavily)",
  "Fetching clauses",
  "Analysing template",
  "Generating recommendations",
];

export default function AIStandardsCheckModal({ open, onClose, templates = [], onDone }) {
  const [mode, setMode] = useState("update");
  const [templateId, setTemplateId] = useState("");
  const [templateType, setTemplateType] = useState("Pre-Pour");
  const [customType, setCustomType] = useState("");
  const [standards, setStandards] = useState([]);
  const [selected, setSelected] = useState({});
  const [aiSettings, setAiSettings] = useState(null); // { provider, status, ready }
  const [tavilyReady, setTavilyReady] = useState(false);
  const [running, setRunning] = useState(false);
  const [step, setStep] = useState(-1);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null); // { status, detail, canRetry }
  const [acceptedIds, setAcceptedIds] = useState(new Set());
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [abortCtrl, setAbortCtrl] = useState(null);
  const nav = useNavigate();

  const loadStatus = async () => {
    setRefreshing(true);
    try {
      const s = await api.get("/admin/settings");
      const ai = s.data.ai_providers || {};
      const active = ai.active_text_provider;
      const prov = active ? ai[active] : null;
      const ready = !!(active && prov && (prov.status === "CONNECTED" || prov.status === "MANUAL"));
      // Phase 11.6.3 — surface any "orphan" connected text provider so we can
      // offer a one-click Set-as-active button inside the banner.
      const textOrder = ["openai", "anthropic", "google"];
      const orphan = !active
        ? textOrder.find(k => {
            const p = ai[k] || {};
            return p.status === "CONNECTED" || p.status === "MANUAL";
          })
        : null;
      setAiSettings({
        provider: active,
        status: prov?.status || "NOT_CONFIGURED",
        ready,
        orphan_text_provider: orphan || null,
      });
      setTavilyReady(!!(s.data.tavily?.enabled && s.data.tavily?.status === "CONNECTED"));
      const list = await api.get("/admin/settings/compliance-standards");
      setStandards(list.data);
      if (!Object.keys(selected).length) {
        const initial = {}; list.data.forEach(x => { initial[x.name] = true; });
        setSelected(initial);
      }
    } catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message); }
    finally { setRefreshing(false); }
  };

  const setActiveTextProvider = async (key) => {
    // Persist only the two active_* keys; backend does a shallow merge, so the
    // stored provider credentials remain untouched.
    try {
      await api.put("/admin/settings/ai_providers", { active_text_provider: key });
      toast.success(`Active text provider set to ${key}`);
      await loadStatus();
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message);
    }
  };

  useEffect(() => {
    if (!open) return;
    loadStatus();
    setResult(null); setError(null); setStep(-1); setAcceptedIds(new Set());
    setTemplateId(""); // Phase 11.6.2 — never pre-select a template; force explicit choice
    // eslint-disable-next-line
  }, [open]);

  const canRun = aiSettings?.ready && tavilyReady && Object.values(selected).some(Boolean)
    && (mode === "generate" || templateId);

  const chosenStandards = () => standards.map(s => s.name).filter(n => selected[n]);

  const runCheck = async () => {
    if (!canRun) return;
    setRunning(true); setResult(null); setError(null); setStep(0);
    // Progressive step ticks — cosmetic timing, real work is one HTTP call
    const ticker = setInterval(() => setStep(s => Math.min(s + 1, STEPS.length - 1)), 8000);
    const ctrl = new AbortController();
    setAbortCtrl(ctrl);
    try {
      const body = { mode, standards: chosenStandards() };
      if (mode === "update") body.template_id = templateId;
      else body.template_type = templateType === "Custom" ? (customType || "Custom") : templateType;
      const { data } = await api.post("/admin/compliance/ai-check", body, { signal: ctrl.signal });
      setResult(data);
      // Pre-check all changes by default
      if (data.mode === "update") setAcceptedIds(new Set((data.changes || []).map(c => c.id)));
    } catch (e) {
      // Distinguish user-cancel vs real failure
      const isCancel = e?.code === "ERR_CANCELED" || e?.name === "CanceledError" || e?.message === "canceled";
      if (isCancel) {
        // User pressed Cancel — silently return to form
        setError(null);
      } else {
        const status = e?.response?.status || 0;
        const detail = formatApiErrorDetail(e?.response?.data?.detail) || e?.message || "Unknown error";
        setError({ status, detail, provider: aiSettings?.provider || null });
      }
    } finally {
      clearInterval(ticker);
      setRunning(false);
      setStep(STEPS.length);
      setAbortCtrl(null);
    }
  };

  const cancelRun = () => {
    if (abortCtrl) abortCtrl.abort();
    setError(null);
    setRunning(false);
  };

  const dismissError = () => {
    setError(null);
    setStep(-1);
  };

  const toggleChange = (id) => {
    const n = new Set(acceptedIds);
    if (n.has(id)) n.delete(id); else n.add(id);
    setAcceptedIds(n);
  };
  const saveDraft = async () => {
    if (!result?.draft_id) return;
    setSaving(true);
    try {
      await api.post(`/admin/compliance/ai-check/${result.draft_id}/accept`,
        { accepted_change_ids: Array.from(acceptedIds) });
      toast.success("Saved as new draft template");
      onDone?.();
      onClose();
      nav(`/forms/templates/${result.draft_id}`);
    } catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !running && !saving && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" data-testid="ai-standards-modal">
        <DialogHeader>
          <DialogTitle className="inline-flex items-center gap-2">
            <AppIcon name="robot" size={22} decorative/> AI Standards Check
          </DialogTitle>
          <DialogDescription>
            Runs a live Tavily search across AU standards bodies (standards.org.au, abcb.gov.au, worksafe.tas.gov.au, cbos.tas.gov.au, legislation.tas.gov.au)
            and asks the active AI provider to compare / generate against Tasmania precast compliance rules.
            Existing templates are <strong>never overwritten</strong> — output lands as a new draft.
          </DialogDescription>
        </DialogHeader>

        {!result && !running && !error && (
          <div className="space-y-4 py-2">
            {/* Prerequisite check */}
            {aiSettings === null ? (
              <div className="text-xs text-gray-500 flex items-center gap-2"><Loader2 className="w-3 h-3 animate-spin"/> Loading settings…</div>
            ) : (!aiSettings.ready || !tavilyReady) && (
              <div className="bg-red-50 border border-red-200 text-red-800 rounded p-3 text-sm space-y-1" data-testid="ai-prereq-banner">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-bold">Prerequisites missing:</div>
                  <button onClick={loadStatus} disabled={refreshing}
                          className="text-[11px] font-semibold underline text-red-700 hover:text-red-900 inline-flex items-center gap-1"
                          data-testid="ai-refresh-status">
                    {refreshing ? <Loader2 className="w-3 h-3 animate-spin"/> : null} Refresh status
                  </button>
                </div>
                {!aiSettings.ready && (
                  <div>• Active AI text provider is <code>{aiSettings.provider || "(none)"}</code> — status {aiSettings.status}.
                    {aiSettings.orphan_text_provider ? (
                      <>
                        {" "}You have <code>{aiSettings.orphan_text_provider}</code> connected but not elected as the text provider.{" "}
                        <button onClick={() => setActiveTextProvider(aiSettings.orphan_text_provider)}
                                className="underline font-semibold text-red-900 hover:text-red-700"
                                data-testid="ai-set-active-inline">
                          Set {aiSettings.orphan_text_provider} as active text provider
                        </button>.
                      </>
                    ) : (
                      <>
                        {aiSettings.provider ? " Reconnect it or " : ""}
                        <a href="/admin/settings" className="underline font-semibold">open Admin Settings → AI Providers</a>
                        {aiSettings.provider ? "" : " and connect a provider (which auto-elects it)"}.
                      </>
                    )}
                  </div>
                )}
                {!tavilyReady && <div>• Tavily web-search key not configured. Add it in <a href="/admin/settings" className="underline font-semibold">Admin Settings → Web Search</a>.</div>}
              </div>
            )}

            <div>
              <Label className="text-[10px] uppercase tracking-wider font-bold text-gray-500">Mode</Label>
              <div className="flex gap-4 mt-1 text-sm">
                <label className="flex items-center gap-2"><input type="radio" name="mode" checked={mode==="update"} onChange={()=>setMode("update")} data-testid="ai-mode-update"/> Suggest updates to this template</label>
                <label className="flex items-center gap-2"><input type="radio" name="mode" checked={mode==="generate"} onChange={()=>setMode("generate")} data-testid="ai-mode-generate"/> Generate a brand new template</label>
              </div>
            </div>

            {mode === "update" && (
              <div>
                <div className="text-sm font-bold text-[#1F2A33] mb-1" data-testid="ai-tpl-picker-heading">
                  Choose the template to update
                </div>
                <div className="text-xs text-gray-500 mb-2">
                  Pick which template you want the AI to check and suggest updates for. Your source template is <strong>never modified</strong> — output lands as a new draft.
                </div>
                {templates.length === 0 ? (
                  <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 rounded p-3 text-sm" data-testid="ai-tpl-picker-empty">
                    No compliance templates found — create one in Form Templates first, then re-open this check.
                  </div>
                ) : (
                  <div className="border border-gray-200 rounded max-h-[260px] overflow-y-auto" data-testid="ai-tpl-picker">
                    {templates.map(t => {
                      const chosen = templateId === t.id;
                      const statusLabel = t.is_system ? "System" : (t.status === "ai_draft" ? "AI Draft" : (t.active ? "Active" : "Draft"));
                      const statusCls = t.is_system ? "bg-blue-100 text-blue-800"
                        : t.status === "ai_draft" ? "bg-purple-100 text-purple-800"
                        : t.active ? "bg-green-100 text-green-800"
                        : "bg-gray-100 text-gray-600";
                      const lm = (t.updated_at || t.created_at || "").slice(0,10);
                      return (
                        <label key={t.id}
                               className={`flex items-start gap-3 p-3 border-b border-gray-100 cursor-pointer last:border-b-0 hover:bg-gray-50 transition-colors ${chosen ? "bg-amber-50" : ""}`}
                               data-testid={`ai-tpl-option-${t.id}`}>
                          <input type="radio" name="ai-template" value={t.id}
                                 checked={chosen}
                                 onChange={() => setTemplateId(t.id)}
                                 className="mt-1"
                                 data-testid={`ai-tpl-radio-${t.id}`}/>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-bold text-[#1F2A33]">{t.name}</span>
                              <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${statusCls}`}>
                                {statusLabel}
                              </span>
                              <span className="text-[10px] font-mono text-gray-500">{t.code}</span>
                              {t.version != null && <span className="text-[10px] text-gray-500">v{t.version}</span>}
                              {lm && <span className="text-[10px] text-gray-400">· updated {lm}</span>}
                            </div>
                            {t.description && (
                              <div className="text-xs text-gray-600 mt-0.5 truncate">{t.description}</div>
                            )}
                          </div>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
            {mode === "generate" && (
              <div>
                <Label className="text-[10px] uppercase tracking-wider font-bold text-gray-500">Template type</Label>
                <Select value={templateType} onValueChange={setTemplateType}>
                  <SelectTrigger data-testid="ai-type-picker"><SelectValue/></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Pre-Pour">Pre-Pour Checklist</SelectItem>
                    <SelectItem value="Post-Pour">Post-Pour Checklist</SelectItem>
                    <SelectItem value="Compliance Certificate">Compliance Certificate</SelectItem>
                    <SelectItem value="Custom">Custom…</SelectItem>
                  </SelectContent>
                </Select>
                {templateType === "Custom" && (
                  <Input className="mt-2" placeholder="Describe the custom scope" value={customType}
                         onChange={(e)=>setCustomType(e.target.value)} data-testid="ai-custom-type"/>
                )}
              </div>
            )}

            <div>
              <Label className="text-[10px] uppercase tracking-wider font-bold text-gray-500">Standards to check against</Label>
              <div className="max-h-40 overflow-auto border border-gray-200 rounded p-2 space-y-1 bg-gray-50 mt-1">
                {standards.map(s => (
                  <label key={s.name} className="flex items-start gap-2 text-xs cursor-pointer">
                    <input type="checkbox" checked={!!selected[s.name]}
                           onChange={(e)=>setSelected({...selected,[s.name]:e.target.checked})}
                           data-testid={`ai-std-${s.name.slice(0,10)}`}/>
                    <span><strong>{s.name}</strong>{s.url && <a href={s.url} target="_blank" rel="noreferrer" className="ml-1 text-[#3A6B8C]"><ExternalLink className="w-3 h-3 inline"/></a>}</span>
                  </label>
                ))}
                {standards.length === 0 && <div className="text-xs text-gray-500">No standards configured — add them in Admin Settings → Compliance Standards.</div>}
              </div>
            </div>

            <div className="bg-gray-50 border border-gray-200 rounded p-2 text-xs" data-testid="ai-modal-footer">
              Active AI provider: <strong className="font-mono" data-testid="ai-modal-footer-provider">{aiSettings?.provider || "(none)"}</strong> · Region: <strong>Tasmania, Australia</strong> · Rate limit: 20 runs / hour <span className="text-gray-400">· ui v11.6.5</span>
            </div>
          </div>
        )}

        {running && (
          <div className="py-6 space-y-2" data-testid="ai-running">
            {STEPS.map((label, i) => (
              <div key={i} className={`flex items-center gap-2 text-sm ${i <= step ? "text-[#1F2A33] font-semibold" : "text-gray-400"}`}>
                {i < step ? <AppIcon name="success" size={16} decorative/>
                 : i === step ? <Loader2 className="w-4 h-4 animate-spin"/>
                 : <span className="w-4 h-4 rounded-full border border-gray-300 inline-block"/>}
                {label}
              </div>
            ))}
            <div className="text-[11px] text-gray-500 pt-2">Typical run: 30–90 s. Live calls in flight — do not close this window.</div>
          </div>
        )}

        {error && !running && (
          <div className="py-4" data-testid="ai-error-panel">
            <div className="bg-red-50 border border-red-300 text-red-900 rounded p-4 space-y-2">
              <div className="flex items-center gap-2 font-bold text-base">
                <AppIcon name="warning" size={18} decorative/> AI Standards Check failed
              </div>
              <div className="text-xs uppercase tracking-wider font-bold text-red-700">
                HTTP {error.status || "network"}
              </div>
              <div className="text-sm font-mono bg-white border border-red-200 rounded p-2 whitespace-pre-wrap break-words"
                   data-testid="ai-error-detail">
                {error.detail}
              </div>
              {(error.status === 429 || /quota|billing|credit/i.test(error.detail) || /HTTP 401|HTTP 403|invalid.*key/i.test(error.detail)) && (
                <div className="text-xs bg-yellow-50 border border-yellow-200 text-yellow-900 rounded p-2">
                  <strong>Hint:</strong> {error.status === 429 && !/HTTP 429/i.test(error.detail)
                    ? "You've hit the internal 20-runs-per-hour cap for AI Standards Check. Wait an hour or try a different super-admin account."
                    : "Your active AI provider is out of quota or the key is invalid. Try switching to a different active provider in Admin Settings → AI Providers, or top up your provider account."}
                </div>
              )}
              {(/^Tavily:/i.test(error.detail) || /tavily/i.test(error.detail)) && (
                <div className="text-xs bg-yellow-50 border border-yellow-200 text-yellow-900 rounded p-2">
                  <strong>Hint:</strong> The Tavily web-search key looks invalid or the query returned nothing. Reconnect Tavily in Admin Settings → Web Search.
                </div>
              )}
            </div>
          </div>
        )}

        {result && (
          <div className="py-2 space-y-3" data-testid="ai-result">
            <div className="bg-green-50 border border-green-200 text-green-800 rounded p-3 text-sm">
              <div className="font-bold">Draft created</div>
              <div>{result.summary || "No summary provided by model."}</div>
              <div className="text-[11px] mt-1 text-gray-600">Provider: <code>{result.provider_used}</code> · Model: <code>{result.model}</code> · Sources: {result.sources?.length || 0} · Rate remaining: {result.rate_remaining}</div>
              {result.dropped_for_missing_citation > 0 && (
                <div className="text-[11px] mt-1 text-amber-800">⚠ {result.dropped_for_missing_citation} suggestion(s) dropped — missing citation.</div>
              )}
            </div>

            {result.mode === "update" ? (
              <div className="space-y-2">
                <div className="text-[10px] uppercase tracking-wider font-bold text-[#3A6B8C]">Proposed changes ({result.changes?.length || 0})</div>
                {(result.changes || []).length === 0 && <div className="text-sm text-gray-500 italic">The AI found no divergence between the template and current standards.</div>}
                {(result.changes || []).map(c => (
                  <label key={c.id} className={`block bg-white border rounded p-3 cursor-pointer ${acceptedIds.has(c.id) ? "border-[#F5C518]" : "border-gray-200"}`}
                          data-testid={`ai-change-${c.id}`}>
                    <div className="flex items-start gap-2">
                      <input type="checkbox" checked={acceptedIds.has(c.id)} onChange={()=>toggleChange(c.id)} className="mt-1"/>
                      <div className="flex-1 text-xs">
                        <div className="font-bold text-[#1F2A33] text-sm">
                          <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 mr-2">{c.change_type}</span>
                          {c.section} → {c.field_id || "(new field)"}
                        </div>
                        {c.before && <div className="text-red-700 line-through">{c.before}</div>}
                        {c.after  && <div className="text-green-800">{c.after}</div>}
                        <div className="text-gray-600 italic mt-1">{c.rationale}</div>
                        {c.citation && (
                          <div className="mt-1 text-[10px]">
                            <strong>{c.citation.standard}</strong> {c.citation.clause}
                            {c.citation.source_url && <> · <a target="_blank" rel="noreferrer" href={c.citation.source_url} className="text-[#3A6B8C] underline">source</a></>}
                          </div>
                        )}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            ) : (
              <div className="space-y-2">
                <div className="text-[10px] uppercase tracking-wider font-bold text-[#3A6B8C]">New template preview</div>
                <div className="text-xs bg-white border border-gray-200 rounded p-3 max-h-80 overflow-auto">
                  <pre className="whitespace-pre-wrap font-mono text-[11px]">{JSON.stringify(result.template_preview, null, 2)}</pre>
                </div>
              </div>
            )}

            <div className="text-[11px] text-gray-500">
              Sources cited: {result.sources?.map(s => <a key={s.url} target="_blank" rel="noreferrer" href={s.url} className="text-[#3A6B8C] underline mr-2">{s.standard}</a>)}
            </div>
          </div>
        )}

        <DialogFooter>
          {running && (
            <Button variant="outline" onClick={cancelRun} data-testid="ai-cancel-run-btn"
                    className="text-red-700 border-red-200 hover:bg-red-50">
              <AppIcon name="cancel" size={14} decorative className="mr-1"/> Cancel run
            </Button>
          )}
          {error && !running && (
            <>
              <Button variant="outline" onClick={onClose} data-testid="ai-error-close-btn">Close</Button>
              <Button onClick={dismissError} data-testid="ai-error-retry-btn"
                      className="bg-[#F5C518] text-[#1F2A33] font-bold hover:bg-[#E0B416]">
                <AppIcon name="refresh" size={14} decorative className="mr-1"/> Try again
              </Button>
            </>
          )}
          {!result && !running && !error && (
            <>
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button onClick={runCheck} disabled={!canRun}
                      className="bg-[#F5C518] text-[#1F2A33] font-bold hover:bg-[#E0B416]"
                      data-testid="ai-run-btn">
                <AppIcon name="robot" size={16} className="mr-1" decorative/>
                Run
              </Button>
            </>
          )}
          {result && (
            <>
              <Button variant="outline" onClick={() => setResult(null)} disabled={saving}>Back</Button>
              <Button onClick={saveDraft} disabled={saving}
                      className="bg-[#F5C518] text-[#1F2A33] font-bold hover:bg-[#E0B416]"
                      data-testid="ai-save-draft-btn">
                {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin"/> : <AppIcon name="save" size={16} className="mr-1" decorative/>}
                Save as new draft
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
