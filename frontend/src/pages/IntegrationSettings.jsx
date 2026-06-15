import { useEffect, useState } from "react";
import { Loader2, Save, FlaskConical } from "lucide-react";
import AppIcon from "../components/AppIcon";
import { api, formatApiErrorDetail } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Switch } from "../components/ui/switch";
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
      <SimproCard section={data.simpro} onSave={(s) => onSectionSave("simpro", s)} onTest={() => onTest("simpro")} />
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

function SimproCard({ section, onSave, onTest }) {
  const [s, setS] = useState(section);
  useEffect(() => { setS(section); }, [section]);
  const required = ["build_name","client_id","client_secret"];
  const configured = required.every(k => s[k] && String(s[k]).trim().length > 0);
  const autoUrl = s.build_name ? `https://${s.build_name}.simprosuite.com/api/v1.0` : "";
  return (
    <CardShell title="Simpro (Customers + Employees)" testid="simpro-card" configured={configured}
      onSave={() => onSave({...s, api_base_url: s.api_base_url || autoUrl})} onTest={onTest}
      help="Used to import customers and sync employees. Generate API credentials in Simpro: Setup → System → Connect → API Keys.">
      <F label="Build name" hint="e.g. 'paneltec' for paneltec.simprosuite.com"><Input value={s.build_name} onChange={(e) => setS({...s, build_name: e.target.value, api_base_url: e.target.value ? `https://${e.target.value}.simprosuite.com/api/v1.0` : ""})} data-testid="simpro-build-name" className="h-10"/></F>
      <F label="API base URL" hint="Auto-filled"><Input value={s.api_base_url || autoUrl} onChange={(e) => setS({...s, api_base_url: e.target.value})} data-testid="simpro-api-url" className="h-10 font-mono text-xs"/></F>
      <F label="Client ID"><Input value={s.client_id} onChange={(e) => setS({...s, client_id: e.target.value})} data-testid="simpro-client-id" className="h-10"/></F>
      <F label="Client Secret"><Input type={isMasked(s.client_secret) ? "text" : "password"} value={s.client_secret} onChange={(e) => setS({...s, client_secret: e.target.value})} data-testid="simpro-client-secret" className="h-10"/></F>
      <EnabledRow value={s.enabled} onChange={(v) => setS({...s, enabled: v})} testid="simpro-enabled"/>
    </CardShell>
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
