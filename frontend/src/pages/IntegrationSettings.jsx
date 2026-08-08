import { useEffect, useState } from "react";
import { Loader2, Save, FlaskConical, Link2, X, List as ListIcon, ChevronDown as ChevronDownIcon, ChevronUp as ChevronUpIcon } from "lucide-react";
import AppIcon from "../components/AppIcon";
import { api, formatApiErrorDetail } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Switch } from "../components/ui/switch";
import { Checkbox } from "../components/ui/checkbox";
import PasswordInput from "../components/PasswordInput";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "../components/ui/dialog";
import { Toaster, toast } from "sonner";

const MASK_PREFIX = "••••••••";

export default function IntegrationSettings() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");

  const load = async () => {
    try { const { data } = await api.get("/settings/integrations"); setData(data); }
    catch (e) { setErr(formatApiErrorDetail(e.response?.data?.detail) || e.message); }
  };
  useEffect(() => { load(); }, []);

  if (err) return <div className="text-sm text-red-700">{err}</div>;
  if (!data) return <div className="flex items-center gap-2 text-gray-500 text-sm"><Loader2 className="w-4 h-4 animate-spin"/> Loading…</div>;

  const onSectionSave = async (key, section) => {
    try {
      const payload = { ...data, [key]: section };
      const { data: saved } = await api.put("/settings/integrations", payload);
      setData(saved);
      toast.success(`${LABELS[key]} saved`);
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message);
    }
  };
  const onTest = async (key) => {
    try {
      const { data: r } = await api.post(`/settings/integrations/${key}/test`);
      toast.success(`${r.status} · ${r.message}`);
    } catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message); }
  };

  return (
    <div className="max-w-5xl space-y-6" data-testid="integrations-page">
      <Toaster richColors position="top-right"/>
      <div>
        <div className="overline">Admin</div>
        <h1 className="text-3xl md:text-4xl font-black tracking-tighter text-[#1F2A33]">Integrations</h1>
        <p className="text-sm text-gray-500 mt-1">Connect Paneltec to Microsoft 365, Simpro, Navixy and Xero.</p>
      </div>

      <div className="bg-[#F5C518]/30 border border-[#F5C518] rounded p-4 text-sm" data-testid="integrations-mocked-banner">
        <span className="font-bold uppercase tracking-wider text-xs text-[#1F2A33]">⚙️ Integration templates ready</span>
        <div className="text-[#1F2A33]/80 text-xs mt-0.5">Credentials are stored but no real API calls are made yet. Connect &amp; test in Phase 4 Part 2.</div>
      </div>

      <M365Card section={data.m365} onSave={(s) => onSectionSave("m365", s)} onTest={() => onTest("m365")} />
      <SimproCard section={data.simpro} onSave={(s) => onSectionSave("simpro", s)} />
      <NavixyCard section={data.navixy} onSave={(s) => onSectionSave("navixy", s)} onTest={() => onTest("navixy")} />
      <XeroCard section={data.xero} onSave={(s) => onSectionSave("xero", s)} onTest={() => onTest("xero")} />
    </div>
  );
}

const LABELS = { m365: "Microsoft 365", simpro: "Simpro", navixy: "Navixy", xero: "Xero" };

function StatusBadge({ configured }) {
  return configured ? (
    <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-[#F5C518] text-[#1F2A33]" data-testid="status-configured">Configured — Not Wired</span>
  ) : (
    <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-gray-200 text-gray-600" data-testid="status-not-configured">Not Configured</span>
  );
}

function CardShell({ title, help, configured, onSave, onTest, testid, children }) {
  return (
    <section className="bg-white border border-gray-200 rounded p-6" data-testid={testid}>
      <div className="flex items-start justify-between mb-3">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-[0.15em] text-[#3A6B8C]">{title}</h2>
          <p className="text-xs text-gray-500 mt-1 max-w-2xl">{help}</p>
        </div>
        <StatusBadge configured={configured}/>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">{children}</div>
      <div className="flex gap-2 justify-end">
        <Button variant="outline" onClick={onTest} data-testid={`${testid}-test`}><AppIcon name="mocked" size={16} className="mr-2" decorative/> Test Connection</Button>
        <Button onClick={onSave} className="bg-[#F5C518] text-[#1F2A33] font-bold hover:bg-[#E0B416]" data-testid={`${testid}-save`}>
          <AppIcon name="save" size={16} className="mr-2" decorative/> Save
        </Button>
      </div>
    </section>
  );
}

function F({ label, hint, children }) {
  return (
    <div>
      <Label className="text-xs uppercase tracking-wider text-[#3A6B8C] font-bold">{label}</Label>
      <div className="mt-1">{children}</div>
      {hint && <div className="text-[10px] text-gray-400 mt-1">{hint}</div>}
    </div>
  );
}

function EnabledRow({ value, onChange, testid }) {
  return (
    <div className="md:col-span-2 flex items-center justify-between border-t pt-3 mt-1">
      <Label className="text-sm font-semibold">Enabled</Label>
      <Switch checked={!!value} onCheckedChange={onChange} data-testid={testid}/>
    </div>
  );
}

function isMasked(v) { return typeof v === "string" && v.startsWith(MASK_PREFIX); }

function M365Card({ section, onSave, onTest }) {
  const [s, setS] = useState(section);
  useEffect(() => { setS(section); }, [section]);
  const required = ["tenant_id","client_id","client_secret","sender_mailbox"];
  const configured = required.every(k => s[k] && String(s[k]).trim().length > 0);
  return (
    <CardShell title="Microsoft 365 (Email)" testid="m365-card" configured={configured}
      onSave={() => onSave(s)} onTest={onTest}
      help="Used to send quotes, invoices, and customer emails. Requires Azure AD app registration with Mail.Send application permission. Configure in Microsoft Entra admin centre.">
      <F label="Tenant ID" hint="UUID format"><Input value={s.tenant_id} onChange={(e) => setS({...s, tenant_id: e.target.value})} data-testid="m365-tenant-id" className="h-10 tabular-nums" placeholder="00000000-0000-0000-0000-000000000000"/></F>
      <F label="Client ID" hint="UUID format"><Input value={s.client_id} onChange={(e) => setS({...s, client_id: e.target.value})} data-testid="m365-client-id" className="h-10 tabular-nums"/></F>
      <F label="Client Secret"><Input type={isMasked(s.client_secret) ? "text" : "password"} value={s.client_secret} onChange={(e) => setS({...s, client_secret: e.target.value})} data-testid="m365-client-secret" className="h-10"/></F>
      <F label="Sender mailbox"><Input value={s.sender_mailbox} onChange={(e) => setS({...s, sender_mailbox: e.target.value})} placeholder="quotes@paneltec.com.au" data-testid="m365-sender-mailbox" className="h-10"/></F>
      <EnabledRow value={s.enabled} onChange={(v) => setS({...s, enabled: v})} testid="m365-enabled"/>
    </CardShell>
  );
}

function ChipInput({ chips, onChange, placeholder, prefix = "", tone = "green", testid, emptyHint = null }) {
  const [draft, setDraft] = useState("");
  const commit = (raw) => {
    const value = String(raw).trim();
    if (!value) return;
    const next = [...chips];
    if (!next.includes(value)) next.push(value);
    onChange(next);
    setDraft("");
  };
  const remove = (idx) => onChange(chips.filter((_, i) => i !== idx));
  const toneCls = tone === "blue"
    ? "bg-blue-100 border-blue-300 text-blue-900"
    : tone === "green-outline"
    ? "bg-transparent border-emerald-400 text-emerald-800 border-dashed"
    : "bg-emerald-500 border-emerald-600 text-white shadow-sm";
  return (
    <div className="flex flex-wrap items-center gap-1.5 bg-[#FCFBF7] border border-gray-300 rounded px-2 py-2 min-h-[44px]" data-testid={testid}>
      {chips.length === 0 && emptyHint && (
        <span className="text-[11px] italic text-gray-400 mr-1">{emptyHint}</span>
      )}
      {chips.map((c, i) => (
        <span key={`${c}-${i}`}
              className={`inline-flex items-center gap-1 text-xs font-semibold border rounded-full px-2 py-0.5 ${toneCls}`}
              data-testid={`${testid}-chip-${i}`}>
          {prefix && <span className="opacity-70 uppercase tracking-wider text-[10px]">{prefix}</span>}
          <span>{c}</span>
          <button type="button" onClick={() => remove(i)} className={tone === "green" ? "hover:text-red-200" : "hover:text-red-700"}
                  aria-label={`Remove ${c}`} data-testid={`${testid}-chip-remove-${i}`}>
            <X className="w-3 h-3"/>
          </button>
        </span>
      ))}
      <input
        type="text"
        className="flex-1 min-w-[120px] bg-transparent outline-none text-sm placeholder:text-gray-400"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") { e.preventDefault(); commit(draft); }
          else if (e.key === "Backspace" && !draft && chips.length) remove(chips.length - 1);
        }}
        onBlur={() => draft && commit(draft)}
        placeholder={placeholder}
        data-testid={`${testid}-input`}/>
    </div>
  );
}

function SimproPositionFilterPerCompany({ companyIds, value, onChange, companyNames }) {
  // `value` is a { [str(cid)]: string[] } dict. `companyIds` is int[].
  // `companyNames` is optional { [id]: string } cache used to label the accordion.
  const [openSet, setOpenSet] = useState(() => new Set(companyIds.map(String)));
  const toggle = (k) => {
    const next = new Set(openSet);
    if (next.has(k)) next.delete(k); else next.add(k);
    setOpenSet(next);
  };
  if (!companyIds.length) {
    return (
      <div className="text-xs italic text-gray-500 border border-dashed border-gray-300 rounded p-3 bg-[#FCFBF7]"
           data-testid="simpro-position-filter-empty-companies">
        Add at least one Company ID above to configure per-company position filters.
      </div>
    );
  }
  return (
    <div className="space-y-2" data-testid="simpro-position-filter-accordion">
      {companyIds.map((cid) => {
        const key = String(cid);
        const chips = Array.isArray(value?.[key]) ? value[key] : [];
        const open = openSet.has(key);
        const label = companyNames?.[cid] ? `${companyNames[cid]} (CO ${cid})` : `CO ${cid}`;
        return (
          <div key={key} className="border border-gray-200 rounded bg-white"
               data-testid={`simpro-pf-section-${cid}`}>
            <button type="button"
                    onClick={() => toggle(key)}
                    className="w-full flex items-center justify-between px-3 py-2 hover:bg-gray-50"
                    data-testid={`simpro-pf-toggle-${cid}`}>
              <span className="text-xs font-bold uppercase tracking-wider text-[#3A6B8C] inline-flex items-center gap-2">
                <span className="bg-[#1F2A33] text-white rounded px-1.5 py-0.5 text-[10px] font-mono">CO {cid}</span>
                {companyNames?.[cid] && <span className="text-[#1F2A33]">{companyNames[cid]}</span>}
                <span className="text-gray-500 text-[10px] normal-case tracking-normal font-normal">
                  {chips.length === 0 ? "no filter — all positions imported" : `${chips.length} position${chips.length === 1 ? "" : "s"}`}
                </span>
              </span>
              {open ? <ChevronUpIcon className="w-4 h-4 text-gray-500"/> : <ChevronDownIcon className="w-4 h-4 text-gray-500"/>}
            </button>
            {open && (
              <div className="px-3 pb-3">
                <ChipInput chips={chips}
                            onChange={(next) => {
                              const nextDict = { ...(value || {}) };
                              if (next.length === 0) delete nextDict[key];
                              else nextDict[key] = next;
                              onChange(nextDict);
                            }}
                            tone="blue" testid={`simpro-pf-chips-${cid}`}
                            emptyHint="No filter — all positions from this company will be imported."
                            placeholder="Type a position and press Enter"/>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function SimproTestPill({ state }) {
  if (!state) return null;
  const map = {
    testing: { txt: "Testing…", cls: "bg-yellow-100 border-yellow-300 text-yellow-900" },
    ok:      { txt: "ALL CONNECTED", cls: "bg-emerald-100 border-emerald-300 text-emerald-900" },
    partial: { txt: "PARTIAL — SEE PER-COMPANY BELOW", cls: "bg-amber-100 border-amber-300 text-amber-900" },
    error:   { txt: "ERROR — SEE PER-COMPANY BELOW", cls: "bg-red-100 border-red-300 text-red-900" },
  };
  const cfg = map[state.kind] || null;
  if (!cfg) return null;
  return (
    <span className={`text-[11px] font-bold uppercase tracking-wider px-2 py-1 rounded border ${cfg.cls}`}
          data-testid="simpro-test-pill">
      {state.kind === "testing" && <Loader2 className="w-3 h-3 mr-1 inline animate-spin"/>}
      {cfg.txt}
    </span>
  );
}

function SimproPerCompanyPills({ results }) {
  if (!results || results.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mt-2" data-testid="simpro-per-company-pills">
      {results.map((r, i) => (
        <span key={`${r.company_id}-${i}`}
              className={`inline-flex items-center gap-1 text-[11px] font-semibold border rounded-full px-2 py-0.5
                          ${r.ok ? "bg-emerald-50 border-emerald-300 text-emerald-900"
                                 : "bg-red-50 border-red-300 text-red-800"}`}
              data-testid={`simpro-per-company-pill-${r.company_id}`}>
          <span className="uppercase tracking-wider text-[9px] opacity-70">CO {r.company_id ?? "?"}</span>
          <span>{r.ok ? "✓" : "✗"}</span>
          <span className="truncate max-w-[220px]">{r.ok ? (r.company_name || "OK") : r.message}</span>
        </span>
      ))}
    </div>
  );
}

function SimproCompanyPickerModal({ open, onOpenChange, form, onPick }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState("");
  const [ticked, setTicked] = useState(new Set());
  useEffect(() => {
    if (!open) { setRows(null); setErr(""); setTicked(new Set()); return; }
    (async () => {
      setRows(null); setErr("");
      try {
        const { data } = await api.post("/integrations/simpro/companies",
          { url: form.url, api_token: form.api_token });
        setRows(data.items || []);
        // Pre-tick companies already in company_ids
        const existing = new Set((form.company_ids || []).map(Number));
        setTicked(new Set((data.items || []).filter(x => existing.has(x.id)).map(x => x.id)));
      } catch (e) {
        setErr(formatApiErrorDetail(e.response?.data?.detail) || e.message);
      }
    })();
  }, [open, form.url, form.api_token, form.company_ids]);
  const toggleRow = (id) => {
    const next = new Set(ticked);
    if (next.has(id)) next.delete(id); else next.add(id);
    setTicked(next);
  };
  const pickSelected = () => {
    if (!rows) return;
    const picked = rows.filter(r => ticked.has(r.id));
    onPick(picked);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="simpro-companies-modal">
        <DialogHeader>
          <DialogTitle>Pick Simpro companies</DialogTitle>
          <DialogDescription>
            Tick one or more companies. Duplicates are ignored. Rows already in
            your Company IDs list are pre-selected.
          </DialogDescription>
        </DialogHeader>
        {err && <div className="text-xs bg-red-50 border border-red-200 text-red-800 rounded p-2" data-testid="simpro-companies-err">{err}</div>}
        {!err && rows === null && <div className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="w-4 h-4 animate-spin"/> Loading…</div>}
        {rows !== null && !err && rows.length === 0 && <div className="text-xs text-gray-500 italic">No companies returned.</div>}
        {rows !== null && rows.length > 0 && (
          <div className="border border-gray-200 rounded overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-100 uppercase text-[10px] tracking-wider text-gray-600">
                <tr>
                  <th className="px-3 py-2 text-left w-10"/>
                  <th className="px-3 py-2 text-left w-16">ID</th>
                  <th className="px-3 py-2 text-left">Name</th>
                  <th className="px-3 py-2 text-left w-20">Enabled</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} className="border-t border-gray-200 hover:bg-gray-50 cursor-pointer"
                      onClick={() => toggleRow(r.id)}
                      data-testid={`simpro-company-row-${r.id}`}>
                    <td className="px-3 py-2">
                      <Checkbox checked={ticked.has(r.id)} onCheckedChange={() => toggleRow(r.id)}
                                 data-testid={`simpro-company-tick-${r.id}`}/>
                    </td>
                    <td className="px-3 py-2 font-mono">{r.id}</td>
                    <td className="px-3 py-2">{r.name}</td>
                    <td className="px-3 py-2 text-xs">{r.enabled ? "Yes" : "No"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <DialogFooter>
          <span className="mr-auto text-xs text-gray-500 self-center" data-testid="simpro-companies-tick-count">{ticked.size} ticked</span>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="simpro-companies-close">Close</Button>
          <Button onClick={pickSelected}
                   disabled={ticked.size === 0}
                   className="bg-[#F5C518] text-[#1F2A33] font-bold hover:bg-[#E0B416]"
                   data-testid="simpro-companies-pick-selected">
            Pick selected
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SimproCard({ section, onSave }) {
  const defaults = {
    url: "https://paneltec.simprosuite.com/",
    company_ids: [2, 3],
    api_token: "",
    whitelist_source_companies: [2, 3],
    staff_custom_field: "Interactive Scheduler Status",
    staff_field_value: "Assign This User To The White Board",
    position_filter: {},   // Phase 11.7.5 — { [str(company_id)]: string[] }
    sync_interval_minutes: 60,
    auto_sync_enabled: true,
    completed_jobs_history_days: 30,
    enabled: false,
  };
  // Coerce legacy list-form position_filter to {} on load (belt-and-braces —
  // backend already normalises on read).
  const normaliseSection = (raw) => {
    if (!raw) return {};
    const out = { ...raw };
    if (!out.position_filter || Array.isArray(out.position_filter)) {
      out.position_filter = {};
    } else if (typeof out.position_filter === "object") {
      const clean = {};
      Object.entries(out.position_filter).forEach(([k, v]) => {
        if (Array.isArray(v)) clean[String(k)] = v.map(String);
      });
      out.position_filter = clean;
    }
    return out;
  };
  const [s, setS] = useState({ ...defaults, ...normaliseSection(section) });
  useEffect(() => { setS({ ...defaults, ...normaliseSection(section) }); /* eslint-disable-next-line */ }, [section]);
  const [testState, setTestState] = useState(null); // {kind, results}
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  // Cache of company names discovered via LIST modal or test-connection.
  const [companyNames, setCompanyNames] = useState({});

  const canProbe = !!(s.url && s.api_token && !isMasked(s.api_token));
  const companyIds = (s.company_ids || []).map(x => parseInt(x, 10)).filter(Number.isFinite);

  const doTest = async () => {
    if (!canProbe) {
      toast.error("Enter URL and API token before testing.");
      return;
    }
    if (companyIds.length === 0) {
      toast.error("Add at least one Company ID before testing.");
      return;
    }
    setTestState({ kind: "testing", results: [] });
    try {
      const { data } = await api.post("/integrations/simpro/test-connection", {
        url: s.url, api_token: s.api_token, company_ids: companyIds,
      });
      const results = data.results || [];
      const okCount = results.filter(r => r.ok).length;
      const kind = okCount === results.length ? "ok"
                  : okCount === 0 ? "error"
                  : "partial";
      // Cache any company names returned by the probe for the PF accordion.
      const learned = {};
      results.forEach(r => { if (r.ok && r.company_id && r.company_name) learned[r.company_id] = r.company_name; });
      if (Object.keys(learned).length) setCompanyNames(prev => ({ ...prev, ...learned }));
      setTestState({ kind, results });
    } catch (e) {
      setTestState({ kind: "error", results: [{ ok: false, company_id: null,
        message: formatApiErrorDetail(e.response?.data?.detail) || e.message }] });
    }
  };
  const doSave = async () => {
    setSaving(true);
    try {
      // De-dupe whitelist against company_ids (drop any whitelist entry that's already primary).
      const primarySet = new Set(companyIds);
      const rawWl = (s.whitelist_source_companies || []).map(v => parseInt(v, 10)).filter(Number.isFinite);
      const wl = rawWl.filter(x => !primarySet.has(x));
      if (wl.length < rawWl.length) {
        toast.info(`Removed ${rawWl.length - wl.length} duplicate${rawWl.length - wl.length === 1 ? "" : "s"} from whitelist (already in Company IDs).`);
      }
      const payload = { ...s,
        company_ids: companyIds,
        whitelist_source_companies: wl,
        sync_interval_minutes: parseInt(s.sync_interval_minutes, 10) || 60,
        completed_jobs_history_days: Math.min(365, Math.max(7, parseInt(s.completed_jobs_history_days, 10) || 30)),
      };
      // Prune orphaned position-filter entries for companies no longer configured.
      const validKeys = new Set(companyIds.map(String));
      const pf = payload.position_filter || {};
      payload.position_filter = Object.fromEntries(
        Object.entries(pf).filter(([k, v]) => validKeys.has(String(k)) && Array.isArray(v) && v.length > 0)
      );
      // Server rejects extra keys — strip legacy `company_id` if the section still had it.
      delete payload.company_id;
      await onSave(payload);
      setTestState(null);
    } finally { setSaving(false); }
  };
  const configured = !!(s.url && s.api_token && companyIds.length > 0);

  return (
    <section className="bg-white border border-gray-200 rounded p-6" data-testid="simpro-card">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-[0.15em] text-[#3A6B8C]">Simpro (Customers + Employees + Jobs)</h2>
          <p className="text-xs text-gray-500 mt-1 max-w-2xl">
            Personal-access-token flow. Fill URL + API token, tap <span className="font-semibold">Test Connection</span> to verify,
            then <span className="font-semibold">Save Simpro</span> to persist.
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-2">
            <StatusBadge configured={configured}/>
            <SimproTestPill state={testState}/>
          </div>
          <SimproPerCompanyPills results={testState?.results}/>
        </div>
      </div>

      {/* Row 1 — URL + Company IDs */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <F label="URL" hint="Your SimPRO build URL — the same hostname you use in the browser.">
          <Input value={s.url} onChange={(e) => setS({ ...s, url: e.target.value })}
                  className="h-10 bg-[#FCFBF7] font-mono text-xs"
                  data-testid="simpro-url" placeholder="https://your-build.simprosuite.com/"/>
        </F>
        <F label="Company IDs" hint={<span>One or more SimPRO company IDs to sync from. If <em>&ldquo;Company does not exist&rdquo;</em>, tap <strong>List Companies</strong> to pick from your Simpro account.</span>}>
          <div className="flex items-start gap-2">
            <div className="flex-1">
              <ChipInput chips={(s.company_ids || []).map(String)}
                          onChange={(chips) => setS({ ...s, company_ids: chips.map(x => parseInt(x, 10)).filter(Number.isFinite) })}
                          prefix="CO" tone="green" testid="simpro-company-ids"
                          placeholder="Enter a company ID and press Enter"/>
            </div>
            <Button type="button" variant="outline" onClick={() => setPickerOpen(true)}
                     disabled={!canProbe}
                     title={!canProbe ? "Enter URL and API token first." : undefined}
                     data-testid="simpro-list-companies-btn"
                     className="h-11">
              <ListIcon className="w-4 h-4 mr-1.5"/> LIST
            </Button>
          </div>
        </F>
      </div>

      {/* Row 2 — API Token */}
      <div className="mb-4">
        <F label="API Token" hint="Found in SimPRO → System → Setup → System Settings → API → Generate Key. Click 👁 to reveal the saved token.">
          <PasswordInput value={s.api_token} onChange={(e) => setS({ ...s, api_token: e.target.value })}
                          className="h-10 bg-[#FCFBF7]" data-testid="simpro-api-token"
                          testIdSuffix="simpro-api-token"
                          placeholder="paste the token here"/>
        </F>
      </div>

      {/* Row 3 — Whitelist Source Companies (dashed-outline green = secondary) */}
      <div className="mb-4">
        <F label="Whitelist Source Companies" hint="SimPRO company IDs whose employee directory the Gate Whitelist Name typeahead searches. Any ID that's already in Company IDs above is dropped on save. Leave empty to use just the Company IDs above. Example: 2, 3.">
          <ChipInput chips={(s.whitelist_source_companies || []).map(String)}
                      onChange={(chips) => setS({ ...s, whitelist_source_companies: chips.map(x => parseInt(x, 10)).filter(Number.isFinite) })}
                      prefix="CO" tone="green-outline" testid="simpro-whitelist"
                      placeholder="Enter a company ID and press Enter"/>
        </F>
      </div>

      {/* Row 4 — Staff Custom Field + Value */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <F label="Staff Custom Field" hint="SimPRO custom field name for whiteboard filtering (optional).">
          <Input value={s.staff_custom_field} onChange={(e) => setS({ ...s, staff_custom_field: e.target.value })}
                  className="h-10 bg-[#FCFBF7]" data-testid="simpro-staff-custom-field"/>
        </F>
        <F label="Staff Field Value" hint="Value that marks a staff member for the whiteboard.">
          <Input value={s.staff_field_value} onChange={(e) => setS({ ...s, staff_field_value: e.target.value })}
                  className="h-10 bg-[#FCFBF7]" data-testid="simpro-staff-field-value"/>
        </F>
      </div>

      {/* Row 5 — Position Filter (per-company accordion) */}
      <div className="mb-4">
        <F label="Position Filter (per company)"
            hint="Restrict which Simpro positions are imported for each configured company. Leave a company empty to import all positions from that company. Case-insensitive substring match on the employee Position in SimPRO.">
          <SimproPositionFilterPerCompany
            companyIds={companyIds}
            value={s.position_filter || {}}
            onChange={(next) => setS({ ...s, position_filter: next })}
            companyNames={companyNames}/>
        </F>
      </div>

      {/* Row 6 — Sync Interval + Auto Sync */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <F label="Sync Interval (minutes)" hint="How often to pull new jobs from SimPRO.">
          <Input type="number" min={5} value={s.sync_interval_minutes}
                  onChange={(e) => setS({ ...s, sync_interval_minutes: e.target.value })}
                  className="h-10 bg-[#FCFBF7] w-40" data-testid="simpro-sync-interval"/>
        </F>
        <F label="Auto Sync" hint="Automatically pull jobs on schedule.">
          <div className="flex items-center gap-2 h-10">
            <Checkbox checked={!s.auto_sync_enabled}
                       onCheckedChange={(v) => setS({ ...s, auto_sync_enabled: !v })}
                       id="simpro-auto-sync-disabled"
                       data-testid="simpro-auto-sync-disabled"/>
            <label htmlFor="simpro-auto-sync-disabled" className="text-sm cursor-pointer">Disabled</label>
          </div>
        </F>
      </div>

      {/* Row 7 — Completed Jobs History (Days) */}
      <div className="mb-4">
        <F label="Completed Jobs History (days)" hint="How many days of Complete / Archived / Invoiced jobs to keep on the board (7–365).">
          <Input type="number" min={7} max={365} value={s.completed_jobs_history_days}
                  onChange={(e) => setS({ ...s, completed_jobs_history_days: e.target.value })}
                  className="h-10 bg-[#FCFBF7] w-40" data-testid="simpro-history-days"/>
        </F>
      </div>

      {/* Enabled toggle (from legacy Simpro OAuth flow — kept for sync workers) */}
      <EnabledRow value={s.enabled} onChange={(v) => setS({ ...s, enabled: v })} testid="simpro-enabled"/>

      {/* Footer buttons */}
      <div className="flex gap-2 justify-end mt-6">
        <Button type="button" variant="outline"
                 onClick={doTest}
                 disabled={!canProbe || testState?.kind === "testing"}
                 className="bg-[#1F2A33] border-[#1F2A33] text-white hover:bg-[#374a58] hover:text-white disabled:opacity-50"
                 data-testid="simpro-test-btn">
          <Link2 className="w-4 h-4 mr-1.5"/> TEST CONNECTION
        </Button>
        <Button type="button" onClick={doSave}
                 disabled={saving}
                 className="bg-[#F5C518] text-[#1F2A33] font-bold hover:bg-[#E0B416]"
                 data-testid="simpro-save-btn">
          {saving ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin"/> : <Save className="w-4 h-4 mr-1.5"/>}
          SAVE SIMPRO
        </Button>
      </div>

      <SimproCompanyPickerModal
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        form={s}
        onPick={(picked) => {
          const nextIds = [...(s.company_ids || [])];
          let added = 0;
          picked.forEach(r => {
            if (!nextIds.includes(r.id)) { nextIds.push(r.id); added++; }
          });
          // Cache the picked names for the PF accordion labels.
          const learned = {};
          picked.forEach(r => { if (r.id && r.name) learned[r.id] = r.name; });
          if (Object.keys(learned).length) setCompanyNames(prev => ({ ...prev, ...learned }));
          setS({ ...s, company_ids: nextIds });
          setPickerOpen(false);
          if (added === 0) toast.info("All ticked companies were already in the list.");
          else toast.success(`Added ${added} compan${added === 1 ? "y" : "ies"} to Company IDs.`);
        }}
      />
    </section>
  );
}

function NavixyCard({ section, onSave, onTest }) {
  const [s, setS] = useState(section);
  useEffect(() => { setS(section); }, [section]);
  const configured = !!(s.api_key && String(s.api_key).trim());
  return (
    <CardShell title="Navixy (Fleet)" testid="navixy-card" configured={configured}
      onSave={() => onSave(s)} onTest={onTest}
      help="Used to display live vehicle locations and status. Get API key from Navixy admin panel → Settings → Integrations → API.">
      <F label="API key"><Input type={isMasked(s.api_key) ? "text" : "password"} value={s.api_key} onChange={(e) => setS({...s, api_key: e.target.value})} data-testid="navixy-api-key" className="h-10"/></F>
      <F label="API base URL"><Input value={s.api_base_url} onChange={(e) => setS({...s, api_base_url: e.target.value})} data-testid="navixy-api-url" className="h-10 font-mono text-xs"/></F>
      <F label="Account ID (optional)"><Input value={s.account_id} onChange={(e) => setS({...s, account_id: e.target.value})} data-testid="navixy-account-id" className="h-10"/></F>
      <div/>
      <EnabledRow value={s.enabled} onChange={(v) => setS({...s, enabled: v})} testid="navixy-enabled"/>
    </CardShell>
  );
}

function XeroCard({ section, onSave, onTest }) {
  const [s, setS] = useState(section);
  useEffect(() => { setS(section); }, [section]);
  const required = ["client_id","client_secret","tenant_id"];
  const configured = required.every(k => s[k] && String(s[k]).trim().length > 0);
  const redirectUri = `${window.location.origin}/settings/integrations/xero/callback`;
  return (
    <CardShell title="Xero (Accounting)" testid="xero-card" configured={configured}
      onSave={() => onSave({...s, redirect_uri: redirectUri})} onTest={onTest}
      help="Used to push invoices and sync payment status. Create OAuth2 app at developer.xero.com → My Apps → New App.">
      <F label="Client ID"><Input value={s.client_id} onChange={(e) => setS({...s, client_id: e.target.value})} data-testid="xero-client-id" className="h-10"/></F>
      <F label="Client Secret"><Input type={isMasked(s.client_secret) ? "text" : "password"} value={s.client_secret} onChange={(e) => setS({...s, client_secret: e.target.value})} data-testid="xero-client-secret" className="h-10"/></F>
      <F label="Tenant ID" hint="Xero organisation ID"><Input value={s.tenant_id} onChange={(e) => setS({...s, tenant_id: e.target.value})} data-testid="xero-tenant-id" className="h-10 tabular-nums"/></F>
      <F label="Redirect URI" hint="Auto-filled, read-only"><Input value={redirectUri} readOnly data-testid="xero-redirect-uri" className="h-10 font-mono text-xs bg-gray-50"/></F>
      <EnabledRow value={s.enabled} onChange={(v) => setS({...s, enabled: v})} testid="xero-enabled"/>
    </CardShell>
  );
}
