import { useEffect, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { api, formatApiErrorDetail } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Toaster, toast } from "sonner";

const AU_STATES = ["NSW","VIC","QLD","WA","SA","TAS","ACT","NT"];

export default function CompanySettings() {
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    api.get("/settings/company").then(r => setForm(r.data)).catch(e => setErr(formatApiErrorDetail(e.response?.data?.detail) || e.message));
  }, []);

  const u = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = { ...form };
      delete payload.updated_at;
      const { data } = await api.put("/settings/company", payload);
      setForm(data);
      toast.success("Company settings saved");
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message);
    } finally { setSaving(false); }
  };

  if (err) return <div className="text-sm text-red-700">{err}</div>;
  if (!form) return <div className="flex items-center gap-2 text-gray-500 text-sm"><Loader2 className="w-4 h-4 animate-spin"/> Loading…</div>;

  return (
    <div className="max-w-5xl space-y-6" data-testid="company-settings-page">
      <Toaster richColors position="top-right"/>
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <div className="overline">Admin</div>
          <h1 className="text-3xl md:text-4xl font-black tracking-tighter text-[#1F2A33]">Company Settings</h1>
          <p className="text-sm text-gray-500 mt-1">These details appear on every quote and invoice. Changes apply immediately.</p>
        </div>
        <Button onClick={save} disabled={saving} className="bg-[#F5C518] text-[#1F2A33] font-bold hover:bg-[#E0B416] h-11 px-6" data-testid="company-save-btn">
          {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin"/> : <Save className="w-4 h-4 mr-2"/>}
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </div>

      <form onSubmit={save} className="space-y-6">
        <Card title="Business identity">
          <F label="Business name *"><Input value={form.business_name} onChange={e => u("business_name", e.target.value)} required data-testid="cs-business-name" className="h-11"/></F>
          <F label="ABN (11 digits)"><Input value={form.abn} onChange={e => u("abn", e.target.value)} placeholder="e.g. 12 345 678 901" data-testid="cs-abn" className="h-11 tabular-nums"/></F>
          <F label="ACN (optional)"><Input value={form.acn} onChange={e => u("acn", e.target.value)} data-testid="cs-acn" className="h-11 tabular-nums"/></F>
        </Card>

        <Card title="Registered address">
          <F label="Street"><Input value={form.address_street} onChange={e => u("address_street", e.target.value)} data-testid="cs-street" className="h-11"/></F>
          <F label="Suburb"><Input value={form.address_suburb} onChange={e => u("address_suburb", e.target.value)} data-testid="cs-suburb" className="h-11"/></F>
          <F label="State">
            <Select value={form.address_state || undefined} onValueChange={(v) => u("address_state", v)}>
              <SelectTrigger className="h-11" data-testid="cs-state"><SelectValue placeholder="Select…"/></SelectTrigger>
              <SelectContent>{AU_STATES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </F>
          <F label="Postcode"><Input value={form.address_postcode} onChange={e => u("address_postcode", e.target.value)} maxLength={4} data-testid="cs-postcode" className="h-11 tabular-nums"/></F>
        </Card>

        <Card title="Contact">
          <F label="Phone"><Input value={form.phone} onChange={e => u("phone", e.target.value)} data-testid="cs-phone" className="h-11"/></F>
          <F label="Email"><Input value={form.email} onChange={e => u("email", e.target.value)} type="email" data-testid="cs-email" className="h-11"/></F>
          <F label="Website"><Input value={form.website} onChange={e => u("website", e.target.value)} data-testid="cs-website" className="h-11"/></F>
        </Card>

        <Card title="Banking (EFT details on invoices)">
          <F label="Bank name"><Input value={form.bank_name} onChange={e => u("bank_name", e.target.value)} data-testid="cs-bank-name" className="h-11"/></F>
          <F label="BSB (XXX-XXX)"><Input value={form.bsb} onChange={e => u("bsb", e.target.value)} placeholder="012-345" data-testid="cs-bsb" className="h-11 tabular-nums"/></F>
          <F label="Account number"><Input value={form.account_number} onChange={e => u("account_number", e.target.value)} data-testid="cs-account-number" className="h-11 tabular-nums"/></F>
          <F label="Account name"><Input value={form.account_name} onChange={e => u("account_name", e.target.value)} data-testid="cs-account-name" className="h-11"/></F>
        </Card>

        <Card title="Defaults">
          <F label="Payment terms (days)"><Input type="number" min={0} value={form.default_payment_terms_days} onChange={e => u("default_payment_terms_days", parseInt(e.target.value,10)||0)} data-testid="cs-terms" className="h-11 tabular-nums w-32"/></F>
          <div className="md:col-span-3">
            <Label className="text-xs uppercase tracking-wider text-[#3A6B8C] font-bold">Invoice footer note</Label>
            <Textarea value={form.invoice_footer_note} onChange={e => u("invoice_footer_note", e.target.value)} rows={2} data-testid="cs-footer" className="mt-1"/>
          </div>
        </Card>
      </form>
    </div>
  );
}

function Card({ title, children }) {
  return (
    <section className="bg-white border border-gray-200 rounded p-6">
      <h2 className="text-sm font-bold uppercase tracking-[0.15em] text-[#3A6B8C] mb-4">{title}</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">{children}</div>
    </section>
  );
}
function F({ label, children }) {
  return <div><Label className="text-xs uppercase tracking-wider text-[#3A6B8C] font-bold">{label}</Label><div className="mt-1">{children}</div></div>;
}
