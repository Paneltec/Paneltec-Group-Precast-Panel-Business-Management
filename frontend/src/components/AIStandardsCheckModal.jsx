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
  const [acceptedIds, setAcceptedIds] = useState(new Set());
  const [saving, setSaving] = useState(false);
  const nav = useNavigate();

  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        const s = await api.get("/admin/settings");
        const ai = s.data.ai_providers || {};
        const active = ai.active_text_provider;
        const prov = active ? ai[active] : null;
        const ready = !!(active && prov && (prov.status === "CONNECTED" || prov.status === "MANUAL"));
        setAiSettings({ provider: active, status: prov?.status || "NOT_CONFIGURED", ready });
        setTavilyReady(!!(s.data.tavily?.enabled && s.data.tavily?.status === "CONNECTED"));
        const list = await api.get("/admin/settings/compliance-standards");
        setStandards(list.data);
        const initial = {}; list.data.forEach(x => { initial[x.name] = true; });
        setSelected(initial);
      } catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message); }
    })();
    // Reset transient
    setResult(null); setStep(-1); setAcceptedIds(new Set());
  }, [open]);

  const canRun = aiSettings?.ready && tavilyReady && Object.values(selected).some(Boolean)
    && (mode === "generate" || templateId);

  const chosenStandards = () => standards.map(s => s.name).filter(n => selected[n]);

  const runCheck = async () => {
    if (!canRun) return;
    setRunning(true); setResult(null); setStep(0);
    // Progressive step ticks — cosmetic timing, real work is one HTTP call
    const ticker = setInterval(() => setStep(s => Math.min(s + 1, STEPS.length - 1)), 8000);
    try {
      const body = { mode, standards: chosenStandards() };
      if (mode === "update") body.template_id = templateId;
      else body.template_type = templateType === "Custom" ? (customType || "Custom") : templateType;
      const { data } = await api.post("/admin/compliance/ai-check", body);
      setResult(data);
      // Pre-check all changes by default
      if (data.mode === "update") setAcceptedIds(new Set((data.changes || []).map(c => c.id)));
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message);
    } finally { clearInterval(ticker); setRunning(false); setStep(STEPS.length); }
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

        {!result && (
          <div className="space-y-4 py-2">
            {/* Prerequisite check */}
            {aiSettings === null ? (
              <div className="text-xs text-gray-500 flex items-center gap-2"><Loader2 className="w-3 h-3 animate-spin"/> Loading settings…</div>
            ) : (!aiSettings.ready || !tavilyReady) && (
              <div className="bg-red-50 border border-red-200 text-red-800 rounded p-3 text-sm space-y-1">
                <div className="font-bold">Prerequisites missing:</div>
                {!aiSettings.ready && <div>• Active AI text provider is <code>{aiSettings.provider || "(none)"}</code> — status {aiSettings.status}. Connect one in Admin Settings → AI Providers.</div>}
                {!tavilyReady && <div>• Tavily web-search key not configured. Add it in Admin Settings → Integrations → Web Search.</div>}
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
                <Label className="text-[10px] uppercase tracking-wider font-bold text-gray-500">Template</Label>
                <Select value={templateId} onValueChange={setTemplateId}>
                  <SelectTrigger data-testid="ai-template-picker"><SelectValue placeholder="Pick a template to audit"/></SelectTrigger>
                  <SelectContent>
                    {templates.map(t => <SelectItem key={t.id} value={t.id}>{t.code} — {t.name}</SelectItem>)}
                  </SelectContent>
                </Select>
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

            <div className="bg-gray-50 border border-gray-200 rounded p-2 text-xs">
              Active AI provider: <strong className="font-mono">{aiSettings?.provider || "(none)"}</strong> · Region: <strong>Tasmania, Australia</strong> · Rate limit: 5 runs / hour
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
          {!result && (
            <>
              <Button variant="outline" onClick={onClose} disabled={running}>Cancel</Button>
              <Button onClick={runCheck} disabled={!canRun || running}
                      className="bg-[#F5C518] text-[#1F2A33] font-bold hover:bg-[#E0B416]"
                      data-testid="ai-run-btn">
                {running ? <Loader2 className="w-4 h-4 mr-2 animate-spin"/> : <AppIcon name="robot" size={16} className="mr-1" decorative/>}
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
