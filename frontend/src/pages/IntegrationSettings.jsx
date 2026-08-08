import { useEffect, useState } from "react";
import { Loader2, Save, FlaskConical, Link2, X, List as ListIcon } from "lucide-react";
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

function ChipInput({ chips, onChange, placeholder, prefix = "", tone = "green", testid }) {
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
    : "bg-emerald-100 border-emerald-300 text-emerald-900";
  return (
    <div className="flex flex-wrap items-center gap-1.5 bg-[#FCFBF7] border border-gray-300 rounded px-2 py-2 min-h-[44px]" data-testid={testid}>
      {chips.map((c, i) => (
        <span key={`${c}-${i}`}
              className={`inline-flex items-center gap-1 text-xs font-semibold border rounded-full px-2 py-0.5 ${toneCls}`}
              data-testid={`${testid}-chip-${i}`}>
          {prefix && <span className="opacity-60 uppercase tracking-wider text-[10px]">{prefix}</span>}
          <span>{c}</span>
          <button type="button" onClick={() => remove(i)} className="hover:text-red-700"
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

function SimproTestPill({ state }) {
  if (!state) return null;
  const map = {
    testing: { txt: "Testing…", cls: "bg-yellow-100 border-yellow-300 text-yellow-900" },
    ok:      { txt: `CONNECTED${state.company_name ? " · " + state.company_name : ""}`,
                cls: "bg-emerald-100 border-emerald-300 text-emerald-900" },
    error:   { txt: `ERROR: ${state.message || "connection failed"}`,
                cls: "bg-red-100 border-red-300 text-red-900" },
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

function SimproCompanyPickerModal({ open, onOpenChange, form, onPick }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    if (!open) { setRows(null); setErr(""); return; }
    (async () => {
      setRows(null); setErr("");
      try {
        const { data } = await api.post("/integrations/simpro/companies",
          { url: form.url, api_token: form.api_token });
        setRows(data.items || []);
      } catch (e) {
        setErr(formatApiErrorDetail(e.response?.data?.detail) || e.message);
      }
    })();
  }, [open, form.url, form.api_token]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="simpro-companies-modal">
        <DialogHeader>
          <DialogTitle>Pick a Simpro company</DialogTitle>
          <DialogDescription>
            Companies visible to the API token stored in this Simpro build.
            Click a row to fill Company ID.
          </DialogDescription>
        </DialogHeader>
        {err && <div className="text-xs bg-red-50 border border-red-200 text-red-800 rounded p-2" data-testid="simpro-companies-err">{err}</div>}
        {!err && rows === null && <div className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="w-4 h-4 animate-spin"/> Loading…</div>}
        {rows !== null && !err && rows.length === 0 && <div className="text-xs text-gray-500 italic">No companies returned.</div>}
        {rows !== null && rows.length > 0 && (
          <div className="border border-gray-200 rounded overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-100 uppercase text-[10px] tracking-wider text-gray-600">
                <tr><th className="px-3 py-2 text-left w-16">ID</th><th className="px-3 py-2 text-left">Name</th>
                  <th className="px-3 py-2 text-left w-20">Enabled</th><th className="w-16"/></tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} className="border-t border-gray-200 hover:bg-gray-50" data-testid={`simpro-company-row-${r.id}`}>
                    <td className="px-3 py-2 font-mono">{r.id}</td>
                    <td className="px-3 py-2">{r.name}</td>
                    <td className="px-3 py-2 text-xs">{r.enabled ? "Yes" : "No"}</td>
                    <td className="px-3 py-2 text-right">
                      <Button size="sm" variant="outline" onClick={() => onPick(r)} data-testid={`simpro-company-pick-${r.id}`}>Pick</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="simpro-companies-close">Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SimproCard({ section, onSave }) {
  const defaults = {
    url: "https://paneltec.simprosuite.com/",
    company_id: 2,
    api_token: "",
    whitelist_source_companies: [2, 3],
    staff_custom_field: "Interactive Scheduler Status",
    staff_field_value: "Assign This User To The White Board",
    position_filter: ["Construction Worker L1", "Construction Worker", "Construction Worker L2", "Construction Worker L3", "Construction Worker CW2"],
    sync_interval_minutes: 60,
    auto_sync_enabled: true,
    completed_jobs_history_days: 30,
    enabled: false,
  };
  const [s, setS] = useState({ ...defaults, ...(section || {}) });
  useEffect(() => { setS({ ...defaults, ...(section || {}) }); /* eslint-disable-next-line */ }, [section]);
  const [testState, setTestState] = useState(null); // {kind:'testing'|'ok'|'error', ...}
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const canProbe = !!(s.url && s.api_token && !isMasked(s.api_token));

  const doTest = async () => {
    if (!canProbe) {
      toast.error("Enter URL and API token before testing.");
      return;
    }
    setTestState({ kind: "testing" });
    try {
      const { data } = await api.post("/integrations/simpro/test-connection", {
        url: s.url, api_token: s.api_token, company_id: Number(s.company_id) || null,
      });
      setTestState(data.ok
        ? { kind: "ok", company_name: data.company_name, message: data.message }
        : { kind: "error", message: data.message });
    } catch (e) {
      setTestState({ kind: "error", message: formatApiErrorDetail(e.response?.data?.detail) || e.message });
    }
  };
  const doSave = async () => {
    setSaving(true);
    try {
      // Cast numeric-looking chips to integers on save.
      const wl = (s.whitelist_source_companies || []).map(v => parseInt(v, 10)).filter(Number.isFinite);
      const payload = { ...s,
        company_id: parseInt(s.company_id, 10) || 0,
        whitelist_source_companies: wl,
        sync_interval_minutes: parseInt(s.sync_interval_minutes, 10) || 60,
        completed_jobs_history_days: Math.min(365, Math.max(7, parseInt(s.completed_jobs_history_days, 10) || 30)),
      };
      await onSave(payload);
      setTestState(null);
    } finally { setSaving(false); }
  };
  const configured = !!(s.url && s.api_token);

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
        <div className="flex items-center gap-2">
          <StatusBadge configured={configured}/>
          <SimproTestPill state={testState}/>
        </div>
      </div>

      {/* Row 1 — URL + Company ID */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <F label="URL" hint="Your SimPRO build URL — the same hostname you use in the browser.">
          <Input value={s.url} onChange={(e) => setS({ ...s, url: e.target.value })}
                  className="h-10 bg-[#FCFBF7] font-mono text-xs"
                  data-testid="simpro-url" placeholder="https://your-build.simprosuite.com/"/>
        </F>
        <F label="Company ID" hint={<span>If <em>&ldquo;Company does not exist&rdquo;</em>, tap <strong>List Companies</strong> to pick the right one.</span>}>
          <div className="flex items-center gap-2">
            <Input type="number" value={s.company_id} onChange={(e) => setS({ ...s, company_id: e.target.value })}
                    className="h-10 bg-[#FCFBF7] w-32" data-testid="simpro-company-id"/>
            <Button type="button" variant="outline" onClick={() => setPickerOpen(true)}
                     disabled={!canProbe}
                     title={!canProbe ? "Enter URL and API token first." : undefined}
                     data-testid="simpro-list-companies-btn">
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

      {/* Row 3 — Whitelist Source Companies */}
      <div className="mb-4">
        <F label="Whitelist Source Companies" hint="SimPRO company IDs whose employee directory the Gate Whitelist Name typeahead searches. Leave empty to use just the main Company ID. Example: 2, 3.">
          <ChipInput chips={(s.whitelist_source_companies || []).map(String)}
                      onChange={(chips) => setS({ ...s, whitelist_source_companies: chips.map(x => parseInt(x, 10)).filter(Number.isFinite) })}
                      prefix="CO" tone="green" testid="simpro-whitelist"
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

      {/* Row 5 — Position Filter */}
      <div className="mb-4">
        <F label="Position Filter (fallback)" hint="Add one or more positions. Case-insensitive substring match on the employee Position in SimPRO. Press Enter or , to add; tap × to remove.">
          <ChipInput chips={s.position_filter || []}
                      onChange={(chips) => setS({ ...s, position_filter: chips })}
                      tone="blue" testid="simpro-position-filter"
                      placeholder="Type a position and press Enter"/>
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
        onPick={(r) => { setS({ ...s, company_id: r.id }); setPickerOpen(false); toast.success(`Company ${r.id} · ${r.name}`); }}
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
