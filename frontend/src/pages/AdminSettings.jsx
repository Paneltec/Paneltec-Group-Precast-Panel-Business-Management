import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Loader2, Download, ExternalLink } from "lucide-react";
import AppIcon from "../components/AppIcon";
import { api, tokenStore, formatApiErrorDetail } from "../lib/api";
import { useAuth } from "../contexts/AuthContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import { toast } from "sonner";

const TABS = [
  { key: "company",     label: "Company Details",   icon: "company" },
  { key: "users",       label: "Users & Roles",     icon: "users" },
  { key: "integrations",label: "Integrations",      icon: "settings" },
  { key: "ai_providers",label: "AI Providers",      icon: "settings" },
  { key: "account",     label: "Account Details",   icon: "profile" },
  { key: "numbering",   label: "Numbering",         icon: "reports" },
  { key: "tax",         label: "Tax",               icon: "money" },
  { key: "email_templates", label: "Email Templates", icon: "email" },
  { key: "form_templates",  label: "Form Templates",  icon: "compliance_forms" },
  { key: "bi_tokens",   label: "BI API Tokens",     icon: "download" },
  { key: "audit_log",   label: "Audit Log",         icon: "audit" },
  { key: "backup",      label: "Backup & Export",   icon: "download" },
];

export default function AdminSettings() {
  const { isSuperAdmin } = useAuth();
  const nav = useNavigate();
  const [tab, setTab] = useState("company");
  const [settings, setSettings] = useState(null);
  const load = async () => {
    try { const { data } = await api.get("/admin/settings"); setSettings(data); }
    catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message); }
  };
  useEffect(() => { if (isSuperAdmin) load(); }, [isSuperAdmin]);

  if (!isSuperAdmin) {
    return (
      <div className="p-12 text-center" data-testid="admin-settings-forbidden">
        <AppIcon name="locked" size={48} decorative/>
        <p className="mt-4 text-sm text-gray-600">Admin Settings is available to Super Admins only.</p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl" data-testid="admin-settings-page">
      <div className="mb-6">
        <div className="overline">Configuration</div>
        <h1 className="text-3xl md:text-4xl font-black tracking-tighter text-[#1F2A33] inline-flex items-center gap-2">
          <AppIcon name="settings" size={32} decorative/> Admin Settings
        </h1>
        <p className="text-sm text-gray-500 mt-1">Company, users, integrations, AI, numbering, tax, templates, backups.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-4">
        <nav className="bg-white border border-gray-200 rounded p-2 h-fit" data-testid="admin-tabs">
          {TABS.map(t => (
            <button key={t.key}
              onClick={() => setTab(t.key)}
              data-testid={`admin-tab-${t.key}`}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded text-sm text-left transition-colors ${
                tab === t.key ? "bg-[#1F2A33] text-white font-bold" : "hover:bg-gray-50 text-gray-700"}`}>
              <AppIcon name={t.icon} size={16} decorative/>
              <span className="truncate">{t.label}</span>
            </button>
          ))}
        </nav>

        <div className="min-h-[400px]" data-testid={`admin-pane-${tab}`}>
          {settings === null ? (
            <div className="flex items-center gap-2 text-sm text-gray-500 p-6"><Loader2 className="w-4 h-4 animate-spin"/> Loading…</div>
          ) : tab === "company" ? (
            <LinkTile to="/settings/company" title="Open Company Settings" desc="Business name, ABN, address, bank details for EFT — flows into every invoice."/>
          ) : tab === "users" ? (
            <LinkTile to="/users" title="Open User Management" desc="Create / edit users, reset passwords, custom permission overrides."/>
          ) : tab === "integrations" ? (
            <LinkTile to="/settings/integrations" title="Open Integration Settings" desc="M365, Simpro (LIVE-capable), Navixy, Xero. Enter credentials + test connection."/>
          ) : tab === "form_templates" ? (
            <LinkTile to="/forms/templates" title="Open Form Template Builder" desc="Data-driven compliance form templates with semantic cloning."/>
          ) : tab === "audit_log" ? (
            <LinkTile to="/admin/audit" title="Open Audit Trail" desc="Every business-critical action recorded and filterable."/>
          ) : tab === "bi_tokens" ? (
            <LinkTile to="/reports" title="Open BI API Tokens (Reports → Power BI Integration tab)" desc="Generate + revoke tokens for Power BI / external analytics."/>
          ) : tab === "ai_providers" ? (
            <AIProvidersPane settings={settings.ai_providers} onSaved={load}/>
          ) : tab === "account" ? (
            <AccountPane settings={settings.account} onSaved={load}/>
          ) : tab === "numbering" ? (
            <NumberingPane settings={settings.numbering} onSaved={load}/>
          ) : tab === "tax" ? (
            <TaxPane settings={settings.tax} onSaved={load}/>
          ) : tab === "email_templates" ? (
            <EmailTemplatesPane settings={settings.email_templates} onSaved={load}/>
          ) : tab === "backup" ? (
            <BackupPane/>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function LinkTile({ to, title, desc }) {
  return (
    <Link to={to} className="block bg-white border border-gray-200 rounded p-5 hover:border-[#F5C518] hover:shadow-md transition-all">
      <div className="flex items-start justify-between">
        <div>
          <div className="font-bold text-[#1F2A33]">{title}</div>
          <div className="text-sm text-gray-500 mt-1">{desc}</div>
        </div>
        <ExternalLink className="w-4 h-4 text-[#3A6B8C]"/>
      </div>
    </Link>
  );
}

// ---- Tab panes (functional forms) ----
function useSaver(tabKey, initial, onSaved) {
  const [form, setForm] = useState(initial || {});
  const [busy, setBusy] = useState(false);
  useEffect(() => { setForm(initial || {}); }, [initial]);
  const save = async (payload = form) => {
    setBusy(true);
    try { await api.put(`/admin/settings/${tabKey}`, payload); toast.success("Saved"); onSaved?.(); }
    catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message); }
    finally { setBusy(false); }
  };
  return { form, setForm, busy, save };
}

function TextRow({ label, value, onChange, type = "text", testid }) {
  return (
    <div>
      <Label className="text-[10px] uppercase tracking-wider font-bold text-gray-500">{label}</Label>
      <Input type={type} value={value ?? ""} onChange={(e) => onChange(type === "number" ? Number(e.target.value) : e.target.value)}
             className="mt-1" data-testid={testid}/>
    </div>
  );
}

function AccountPane({ settings, onSaved }) {
  const { form, setForm, busy, save } = useSaver("account", settings, onSaved);
  return (
    <div className="bg-white border border-gray-200 rounded p-6 space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <TextRow label="Primary contact name" value={form.primary_contact_name} onChange={(v)=>setForm({...form,primary_contact_name:v})} testid="account-contact-name"/>
        <TextRow label="Primary contact email" value={form.primary_contact_email} onChange={(v)=>setForm({...form,primary_contact_email:v})} testid="account-contact-email"/>
        <TextRow label="Primary contact phone" value={form.primary_contact_phone} onChange={(v)=>setForm({...form,primary_contact_phone:v})} testid="account-contact-phone"/>
        <TextRow label="Billing email"        value={form.billing_email}          onChange={(v)=>setForm({...form,billing_email:v})} testid="account-billing-email"/>
        <TextRow label="Timezone"             value={form.timezone}                onChange={(v)=>setForm({...form,timezone:v})} testid="account-timezone"/>
        <TextRow label="Fiscal year start month (1-12)" type="number" value={form.fiscal_year_start_month} onChange={(v)=>setForm({...form,fiscal_year_start_month:v})} testid="account-fy-month"/>
        <TextRow label="Backup email for admin alerts" value={form.backup_email} onChange={(v)=>setForm({...form,backup_email:v})} testid="account-backup-email"/>
        <div>
          <Label className="text-[10px] uppercase tracking-wider font-bold text-gray-500">Subscription plan</Label>
          <Input value={form.subscription_plan || "Self-hosted"} disabled className="mt-1 bg-gray-50"/>
        </div>
      </div>
      <Button onClick={() => save()} disabled={busy} className="bg-[#F5C518] text-[#1F2A33] font-bold hover:bg-[#E0B416]" data-testid="account-save-btn">
        {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin"/> : null} Save
      </Button>
    </div>
  );
}

function NumberingPane({ settings, onSaved }) {
  const { form, setForm, busy, save } = useSaver("numbering", settings, onSaved);
  const saveWithConfirm = () => {
    if (!window.confirm("Changing these values may cause number gaps in the sequence — continue?")) return;
    save();
  };
  return (
    <div className="bg-white border border-gray-200 rounded p-6 space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <TextRow label="Quote prefix"    value={form.quote_prefix}   onChange={(v)=>setForm({...form,quote_prefix:v})} testid="num-quote-prefix"/>
        <TextRow label="Invoice prefix"  value={form.invoice_prefix} onChange={(v)=>setForm({...form,invoice_prefix:v})} testid="num-inv-prefix"/>
        <TextRow label="Job prefix"      value={form.job_prefix}     onChange={(v)=>setForm({...form,job_prefix:v})} testid="num-job-prefix"/>
        <TextRow label="Next quote #"    type="number" value={form.next_quote}   onChange={(v)=>setForm({...form,next_quote:v})} testid="num-next-quote"/>
        <TextRow label="Next invoice #"  type="number" value={form.next_invoice} onChange={(v)=>setForm({...form,next_invoice:v})} testid="num-next-invoice"/>
        <TextRow label="Next job #"      type="number" value={form.next_job}     onChange={(v)=>setForm({...form,next_job:v})} testid="num-next-job"/>
      </div>
      <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
        Changing the "next" counters lower than the current used value may cause duplicate numbers. Only increase.
      </div>
      <Button onClick={saveWithConfirm} disabled={busy} className="bg-[#F5C518] text-[#1F2A33] font-bold hover:bg-[#E0B416]" data-testid="num-save-btn">
        {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin"/> : null} Save
      </Button>
    </div>
  );
}

function TaxPane({ settings, onSaved }) {
  const { form, setForm, busy, save } = useSaver("tax", settings, onSaved);
  return (
    <div className="bg-white border border-gray-200 rounded p-6 space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <TextRow label="GST rate (%)" type="number" value={form.gst_rate_pct} onChange={(v)=>setForm({...form,gst_rate_pct:v})} testid="tax-rate"/>
        <TextRow label="Tax code label" value={form.tax_code_label} onChange={(v)=>setForm({...form,tax_code_label:v})} testid="tax-label"/>
        <label className="flex items-center gap-2 mt-6 text-sm">
          <input type="checkbox" checked={!!form.tax_inclusive} onChange={(e)=>setForm({...form,tax_inclusive:e.target.checked})} data-testid="tax-inclusive"/>
          Tax-inclusive quotes
        </label>
      </div>
      <Button onClick={() => save()} disabled={busy} className="bg-[#F5C518] text-[#1F2A33] font-bold hover:bg-[#E0B416]" data-testid="tax-save-btn">
        {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin"/> : null} Save
      </Button>
    </div>
  );
}

function EmailTemplatesPane({ settings, onSaved }) {
  const { form, setForm, busy, save } = useSaver("email_templates", settings, onSaved);
  const keys = Object.keys(form || {});
  return (
    <div className="space-y-3">
      {keys.map(k => (
        <div key={k} className="bg-white border border-gray-200 rounded p-4 space-y-2" data-testid={`email-tpl-${k}`}>
          <div className="text-[10px] uppercase tracking-wider font-bold text-[#3A6B8C]">{k}</div>
          <Input value={form[k]?.subject || ""} placeholder="Subject"
                 onChange={(e)=>setForm({...form,[k]:{...(form[k]||{}),subject:e.target.value}})} data-testid={`email-tpl-subject-${k}`}/>
          <Textarea rows={4} value={form[k]?.body || ""} placeholder="Body — use {{variables}}"
                    onChange={(e)=>setForm({...form,[k]:{...(form[k]||{}),body:e.target.value}})} data-testid={`email-tpl-body-${k}`}/>
        </div>
      ))}
      <div className="text-xs text-gray-500">
        Available variables: <code>{"{{customer_name}} {{quote_number}} {{invoice_number}} {{total}} {{due_date}} {{form_number}} {{panel_id}} {{quote_link}}"}</code>
      </div>
      <Button onClick={() => save()} disabled={busy} className="bg-[#F5C518] text-[#1F2A33] font-bold hover:bg-[#E0B416]" data-testid="email-tpl-save-btn">
        {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin"/> : null} Save all templates
      </Button>
    </div>
  );
}

function AIProvidersPane({ settings, onSaved }) {
  const { form, setForm, busy, save } = useSaver("ai_providers", settings, onSaved);
  const [testing, setTesting] = useState(null);
  const providers = [
    { key: "openai",     label: "OpenAI (GPT)",       kind: "text" },
    { key: "anthropic",  label: "Anthropic (Claude)", kind: "text" },
    { key: "google",     label: "Google (Gemini)",    kind: "text" },
    { key: "nano_banana",label: "Nano Banana (image)",kind: "image" },
  ];
  const setActive = (kind, key) => {
    setForm({
      ...form,
      active_text_provider: kind === "text" ? key : form.active_text_provider,
      active_image_provider: kind === "image" ? key : form.active_image_provider,
    });
  };
  const testKey = async (key) => {
    setTesting(key);
    try {
      const { data } = await api.post("/admin/settings/ai_providers/test",
        { provider: key, api_key: form[key]?.api_key || undefined });
      toast[data.status === "OK" ? "success" : "info"](`${key}: ${data.message}`);
    } catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message); }
    finally { setTesting(null); }
  };
  return (
    <div className="space-y-3">
      {providers.map(p => {
        const isActive = p.kind === "text" ? form.active_text_provider === p.key : form.active_image_provider === p.key;
        return (
          <div key={p.key} className="bg-white border border-gray-200 rounded p-4 space-y-2" data-testid={`ai-card-${p.key}`}>
            <div className="flex items-center justify-between">
              <div className="font-bold text-[#1F2A33]">{p.label}</div>
              <label className="text-xs flex items-center gap-2">
                <input type="radio" name={`active_${p.kind}`} checked={isActive}
                       onChange={() => setActive(p.kind, p.key)} data-testid={`ai-active-${p.key}`}/>
                Set as active ({p.kind})
              </label>
            </div>
            <Input type="password" placeholder="API key" value={form[p.key]?.api_key || ""}
                   onChange={(e)=>setForm({...form,[p.key]:{...(form[p.key]||{}),api_key:e.target.value,enabled:!!e.target.value}})}
                   data-testid={`ai-key-${p.key}`}/>
            <div className="flex justify-end">
              <Button variant="outline" size="sm" disabled={testing === p.key} onClick={() => testKey(p.key)}
                      data-testid={`ai-test-${p.key}`}>
                {testing === p.key ? <Loader2 className="w-3 h-3 mr-1 animate-spin"/> : null} Test key
              </Button>
            </div>
          </div>
        );
      })}
      <div className="text-xs text-gray-500">
        Active text provider: <strong>{form.active_text_provider || "(none)"}</strong> · Active image provider: <strong>{form.active_image_provider || "(none)"}</strong>
      </div>
      <Button onClick={() => save()} disabled={busy} className="bg-[#F5C518] text-[#1F2A33] font-bold hover:bg-[#E0B416]" data-testid="ai-save-btn">
        {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin"/> : null} Save AI settings
      </Button>
    </div>
  );
}

function BackupPane() {
  const [busy, setBusy] = useState(null);
  const download = async (kind) => {
    setBusy(kind);
    try {
      const url = `${process.env.REACT_APP_BACKEND_URL}/api/admin/export/${kind === "json" ? "json" : "csv-bundle"}`;
      const r = await fetch(url, { headers: { "Authorization": `Bearer ${tokenStore.get()}` } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const blob = await r.blob();
      const cd = r.headers.get("Content-Disposition") || "";
      const m = cd.match(/filename="([^"]+)"/);
      const fname = m ? m[1] : (kind === "json" ? "paneltec_backup.json" : "paneltec_csv_bundle.zip");
      const u = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = u; a.download = fname; a.click();
      URL.revokeObjectURL(u);
      toast.success(`Downloaded ${fname}`);
    } catch (e) { toast.error(e.message); }
    finally { setBusy(null); }
  };
  return (
    <div className="space-y-3">
      <div className="bg-white border border-gray-200 rounded p-5">
        <div className="font-bold text-[#1F2A33]">Full JSON backup</div>
        <div className="text-sm text-gray-500 mt-1">Every business collection + settings + users + audit as a single JSON download.</div>
        <Button onClick={() => download("json")} disabled={busy === "json"}
                className="mt-3 bg-[#3A6B8C] text-white hover:bg-[#1F2A33]" data-testid="backup-json-btn">
          {busy === "json" ? <Loader2 className="w-4 h-4 mr-2 animate-spin"/> : <Download className="w-4 h-4 mr-2"/>}
          Export all data (JSON)
        </Button>
      </div>
      <div className="bg-white border border-gray-200 rounded p-5">
        <div className="font-bold text-[#1F2A33]">CSV bundle</div>
        <div className="text-sm text-gray-500 mt-1">ZIP containing one CSV per business collection (customers, quotes, jobs, invoices, vehicles, employees, projects, compliance_forms).</div>
        <Button onClick={() => download("csv")} disabled={busy === "csv"}
                className="mt-3 bg-[#3A6B8C] text-white hover:bg-[#1F2A33]" data-testid="backup-csv-btn">
          {busy === "csv" ? <Loader2 className="w-4 h-4 mr-2 animate-spin"/> : <Download className="w-4 h-4 mr-2"/>}
          Export CSV bundle
        </Button>
      </div>
    </div>
  );
}
