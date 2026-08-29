import { useEffect, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { Loader2, ArrowLeft, Save, Trash2 } from "lucide-react";
import AppIcon from "../components/AppIcon";
import { api, formatApiErrorDetail } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import { Checkbox } from "../components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { toast, Toaster } from "sonner";
import { formatDateTime } from "../lib/format";
import EmailModal, { LastEmailedLabel } from "../components/EmailModal";
import AbnLookupCombobox from "../components/AbnLookupCombobox";
import { openPdf } from "../lib/print";
import DeleteRowActions from "../components/DeleteRowActions";
import { useAuth } from "../contexts/AuthContext";

const AU_STATES = ["NSW", "VIC", "QLD", "WA", "SA", "TAS", "ACT", "NT"];
const PAYMENT_TERMS = ["Net 14 days", "Net 30 days", "Net 60 days", "COD"];
const STATUSES = ["Active", "Inactive", "Prospect", "On Hold"];

const EMPTY_ADDR = { street: "", suburb: "", state: "", postcode: "" };
const EMPTY = {
  company_name: "", trading_name: "", abn: "", gst_registered: false,
  contact_name: "", contact_email: "", contact_phone: "",
  secondary_contact_name: "", secondary_contact_email: "", secondary_contact_phone: "",
  billing_address: { ...EMPTY_ADDR, state: "TAS" },
  site_address:    { ...EMPTY_ADDR },
  site_same_as_billing: true,
  account_terms: "30 days",
  payment_terms: "Net 30 days",
  tax_exempt: false,
  status: "Active",
  simpro_customer_id: "",
  notes: "",
};

export default function CustomerForm() {
  const { id } = useParams();
  const isNew = !id || id === "new";
  const [form, setForm] = useState(EMPTY);
  const [loaded, setLoaded] = useState(isNew);
  const [projects, setProjects] = useState([]);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [abnLoading, setAbnLoading] = useState(false);
  const [abnLookupNote, setAbnLookupNote] = useState("");
  const [abnLookupError, setAbnLookupError] = useState(false);

  // Shared auto-fill applied by BOTH the name-search combobox AND the ABN Lookup button
  // `source` ∈ {"business","trading","abn"} — controls whether `trading_name` is
  // written from the picked entry (trading-name search) or left alone.
  const applyAbrMatch = (m, source = "business") => {
    const isTradingLikePick = /trading|business/i.test(m.entity_type || "");
    setForm(f => {
      const next = { ...f };
      // Legal / entity name → company_name unless the pick is clearly a trading-name match
      if (source === "trading" && isTradingLikePick) {
        next.trading_name = m.entity_name || f.trading_name;
        // Keep existing company_name unless it's empty
        if (!f.company_name) next.company_name = m.entity_name;
      } else {
        next.company_name = m.entity_name || f.company_name;
        if (source === "trading") next.trading_name = m.entity_name || f.trading_name;
      }
      next.abn = (m.abn || f.abn || "").replace(/\D/g, "");
      next.gst_registered = !!m.gst_registered;
      next.billing_address = {
        ...(f.billing_address || {}),
        state: m.state || f.billing_address?.state || "TAS",
        postcode: m.postcode || f.billing_address?.postcode || "",
      };
      return next;
    });
  };

  const onAbnLookup = async () => {
    setAbnLookupError(false);
    const digits = (form.abn || "").replace(/\D/g, "");
    if (digits.length !== 11) {
      setAbnLookupError(true);
      setAbnLookupNote("ABN must be 11 digits.");
      return;
    }
    setAbnLoading(true);
    try {
      const { data } = await api.get(`/lookup/abn/${digits}`);
      if (!data.configured) {
        setAbnLookupError(false);
        setAbnLookupNote(data.message || "ABN lookup not configured — set ABR_LOOKUP_GUID env var.");
        return;
      }
      if (data.result) {
        applyAbrMatch(data.result, "abn");
        setAbnLookupNote(`Matched: ${data.result.entity_name} · ${data.result.gst_registered ? "GST registered" : "Not GST registered"}`);
      }
    } catch (e) {
      setAbnLookupError(true);
      setAbnLookupNote(formatApiErrorDetail(e.response?.data?.detail) || e.message);
    } finally {
      setAbnLoading(false);
    }
  };
  const navigate = useNavigate();

  useEffect(() => {
    if (isNew) return;
    (async () => {
      try {
        const [{ data }, { data: projData }] = await Promise.all([
          api.get(`/customers/${id}`),
          api.get(`/customers/${id}/projects`),
        ]);
        setForm({
          ...EMPTY, ...data,
          billing_address: { ...EMPTY_ADDR, ...(data.billing_address || {}) },
          site_address: { ...EMPTY_ADDR, ...(data.site_address || {}) },
        });
        setProjects(projData);
        setLoaded(true);
      } catch (e) {
        setError(formatApiErrorDetail(e.response?.data?.detail) || e.message);
        setLoaded(true);
      }
    })();
  }, [id, isNew]);

  const update = (path, v) => setForm((prev) => {
    const next = { ...prev };
    const keys = path.split(".");
    let cur = next;
    for (let i = 0; i < keys.length - 1; i++) {
      cur[keys[i]] = { ...cur[keys[i]] };
      cur = cur[keys[i]];
    }
    cur[keys[keys.length - 1]] = v;
    return next;
  });

  const onSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (!(form.contact_email || (form.contact_phone || "").trim())) {
      setError("Provide at least one primary contact method — email or phone.");
      return;
    }
    setSubmitting(true);
    try {
      const payload = { ...form };
      if (payload.site_same_as_billing) payload.site_address = payload.billing_address;
      if (isNew) {
        const { data } = await api.post("/customers", payload);
        toast.success("Customer created");
        navigate(`/customers/${data.id}`);
      } else {
        const { data } = await api.patch(`/customers/${id}`, payload);
        setForm({ ...form, ...data });
        toast.success("Saved");
      }
    } catch (err) {
      setError(formatApiErrorDetail(err.response?.data?.detail) || err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const onDelete = async () => {
    if (!window.confirm("Delete this customer? If linked to quotes/projects it will be soft-deleted.")) return;
    try {
      const { data } = await api.delete(`/customers/${id}`);
      toast.success(data.soft_deleted ? "Customer deactivated (linked records exist)" : "Customer deleted");
      navigate("/customers");
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message);
    }
  };

  if (!loaded) return <div className="flex items-center gap-2 text-gray-500 text-sm"><Loader2 className="w-4 h-4 animate-spin"/> Loading…</div>;

  return (
    <div className="max-w-5xl space-y-6" data-testid="customer-form-page">
      <Toaster richColors position="top-right" />
      <div className="flex items-center justify-between gap-3">
        <div>
          <Link to="/customers" className="inline-flex items-center text-xs uppercase tracking-wider text-[#3A6B8C] font-bold mb-2 hover:text-[#1F2A33]"><ArrowLeft className="w-3 h-3 mr-1"/> Back to customers</Link>
          <h1 className="text-3xl md:text-4xl font-black tracking-tighter text-[#1F2A33]">
            {isNew ? "New customer" : form.company_name}
          </h1>
          {!isNew && (
            <div className="flex items-center gap-2 mt-2">
              {form.gst_registered ? (
                <span data-testid="gst-pill-registered"
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider
                             bg-[#E4F2E4] text-[#1F5F1F] border border-[#B7D9B7]">GST ✓</span>
              ) : (
                <span data-testid="gst-pill-none"
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider
                             bg-gray-100 text-gray-500 border border-gray-200">Not registered</span>
              )}
              {form.abn && (
                <span className="text-[10px] tabular-nums font-mono text-gray-500">ABN {form.abn}</span>
              )}
            </div>
          )}
          {!isNew && <p className="text-xs text-gray-500 mt-1">Updated {formatDateTime(form.updated_at)}</p>}
          {!isNew && <LastEmailedLabel at={form.last_email_sent_at} subject={form.last_email_subject}/>}
        </div>
        {!isNew && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline"
              onClick={async () => {
                try {
                  toast.loading("Opening PDF…", { id: "cust-pdf" });
                  const r = await openPdf(`/customers/${id}/pdf`, `paneltec_customer_${id}.pdf`);
                  if (r?.blocked) toast.error("Popup blocked — PDF downloaded instead. Allow popups from this site to view inline.", { id: "cust-pdf" });
                  else toast.success("Customer PDF opened", { id: "cust-pdf" });
                } catch (err) {
                  toast.error(formatApiErrorDetail(err.response?.data?.detail) || "Failed to generate PDF", { id: "cust-pdf" });
                }
              }}
              className="border-[#1F2A33] text-[#1F2A33] font-semibold" data-testid="customer-print-btn">
              <AppIcon name="print" size={18} className="mr-2" decorative/> Print
            </Button>
            <Button variant="outline" onClick={() => setEmailOpen(true)} className="border-[#3A6B8C] text-[#3A6B8C] font-semibold" data-testid="customer-email-btn">
              <AppIcon name="email" size={18} className="mr-2" decorative/> Email
            </Button>
            <Button variant="outline" onClick={onDelete} data-testid="delete-customer-btn"
              className="border-red-300 text-red-700 hover:bg-red-50">
              <AppIcon name="delete" size={16} className="mr-2" decorative/> Delete
            </Button>
          </div>
        )}
      </div>

      <form onSubmit={onSubmit} className="space-y-6">
        <Section title="Business">
          <Field label="Business name" required>
            <AbnLookupCombobox
              value={form.company_name}
              onChange={(name) => update("company_name", name)}
              onPick={(m) => applyAbrMatch(m, "business")}
              dataTestId="cust-company-input"
              className="h-11"
            />
          </Field>
          <Field label="Trading name">
            <AbnLookupCombobox
              value={form.trading_name || ""}
              onChange={(name) => update("trading_name", name)}
              onPick={(m) => applyAbrMatch(m, "trading")}
              placeholder="If different from business name — type to search ABR"
              dataTestId="cust-trading-name"
              className="h-11"
            />
          </Field>
          <Field label="ABN (11 digits, spaces allowed)">
            <div className="flex gap-2">
              <Input value={form.abn || ""} onChange={(e) => update("abn", e.target.value)}
                data-testid="cust-abn-input" className="h-11 tabular-nums flex-1" placeholder="e.g. 53 004 085 616"/>
              <Button type="button" variant="outline"
                onClick={onAbnLookup} disabled={abnLoading}
                className="h-11 border-[#3A6B8C] text-[#3A6B8C] font-semibold"
                data-testid="cust-abn-lookup-btn">
                {abnLoading ? "…" : "Lookup"}
              </Button>
            </div>
            {abnLookupNote && (
              <div className={`mt-1 text-[10px] italic ${abnLookupError ? "text-red-600" : "text-gray-500"}`}
                   data-testid="cust-abn-lookup-note">
                {abnLookupNote}
              </div>
            )}
          </Field>
          <Field label="Status">
            <Select value={form.status} onValueChange={(v) => update("status", v)}>
              <SelectTrigger data-testid="cust-status" className="h-11"><SelectValue/></SelectTrigger>
              <SelectContent>{STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Simpro customer ID">
            <Input value={form.simpro_customer_id || ""} onChange={(e) => update("simpro_customer_id", e.target.value)}
              data-testid="cust-simpro-id" className="h-11 tabular-nums" placeholder="Optional — links to Simpro"/>
          </Field>
        </Section>

        <Section title="Primary contact">
          <Field label="Contact name" required>
            <Input value={form.contact_name} onChange={(e) => update("contact_name", e.target.value)} required
              data-testid="cust-contact-name" className="h-11"/>
          </Field>
          <Field label="Contact email">
            <Input type="email" value={form.contact_email || ""} onChange={(e) => update("contact_email", e.target.value)}
              data-testid="cust-contact-email" className="h-11"
              placeholder="Provide email or phone"/>
          </Field>
          <Field label="Contact phone">
            <Input value={form.contact_phone || ""} onChange={(e) => update("contact_phone", e.target.value)}
              data-testid="cust-contact-phone" className="h-11"
              placeholder="Provide email or phone"/>
          </Field>
          <div className="col-span-full text-[11px] text-gray-500 italic -mt-2">
            At least one contact method is required (email or phone).
          </div>
        </Section>

        <Section title="Secondary contact (optional)">
          <Field label="Name">
            <Input value={form.secondary_contact_name || ""} onChange={(e) => update("secondary_contact_name", e.target.value)}
              data-testid="cust-sec-name" className="h-11"/>
          </Field>
          <Field label="Email">
            <Input type="email" value={form.secondary_contact_email || ""} onChange={(e) => update("secondary_contact_email", e.target.value)}
              data-testid="cust-sec-email" className="h-11"/>
          </Field>
          <Field label="Phone">
            <Input value={form.secondary_contact_phone || ""} onChange={(e) => update("secondary_contact_phone", e.target.value)}
              data-testid="cust-sec-phone" className="h-11"/>
          </Field>
        </Section>

        <Section title="Billing address">
          <AddressFields value={form.billing_address} prefix="bill" onChange={(k, v) => update(`billing_address.${k}`, v)} />
        </Section>

        <Section title="Site address" action={
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <Checkbox checked={form.site_same_as_billing}
              onCheckedChange={(v) => update("site_same_as_billing", !!v)}
              data-testid="cust-same-as-billing"/>
            Same as billing
          </label>
        }>
          {!form.site_same_as_billing && (
            <AddressFields value={form.site_address} prefix="site" onChange={(k, v) => update(`site_address.${k}`, v)} />
          )}
        </Section>

        <Section title="Terms">
          <Field label="Payment terms">
            <Select value={form.payment_terms} onValueChange={(v) => update("payment_terms", v)}>
              <SelectTrigger data-testid="cust-payment-terms" className="h-11"><SelectValue/></SelectTrigger>
              <SelectContent>{PAYMENT_TERMS.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Legacy account terms (free text)">
            <Input value={form.account_terms} onChange={(e) => update("account_terms", e.target.value)}
              data-testid="cust-terms-input" className="h-11"/>
          </Field>
          <div className="flex items-end pb-2">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox checked={form.tax_exempt} onCheckedChange={(v) => update("tax_exempt", !!v)}
                         data-testid="cust-tax-exempt"/>
              Tax exempt (GST not charged)
            </label>
          </div>
          <div className="flex items-end pb-2">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox checked={form.gst_registered} onCheckedChange={(v) => update("gst_registered", !!v)}
                         data-testid="cust-gst-registered"/>
              Registered for GST
            </label>
          </div>
        </Section>

        <Section title="Notes">
          <div className="col-span-full">
            <Textarea value={form.notes} onChange={(e) => update("notes", e.target.value)}
              placeholder="Delivery preferences, key contacts, history…" rows={4} data-testid="cust-notes"/>
          </div>
        </Section>

        {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded" data-testid="cust-error">{error}</div>}

        <div className="flex justify-end">
          <Button type="submit" disabled={submitting} data-testid="cust-save-btn"
            className="bg-[#F5C518] text-[#1F2A33] font-bold hover:bg-[#E0B416] h-11 px-6">
            {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin"/> : <AppIcon name="save" size={16} className="mr-2" decorative/>}
            {isNew ? "Create customer" : "Save changes"}
          </Button>
        </div>
      </form>

      {!isNew && (
        <ProjectsCard customerId={id} projects={projects} onChanged={(p) => setProjects(p)} customerSiteAddress={form.site_address} reloadProjects={async () => { try { const { data } = await api.get(`/customers/${id}/projects`); setProjects(data); } catch { /* ignore */ } }} />
      )}

      {!isNew && (
        <EmailModal
          open={emailOpen} onOpenChange={setEmailOpen}
          defaultRecipient={form.contact_email}
          defaultSubject={`Hello from Paneltec Group`}
          defaultBody={`Hi ${form.contact_name || form.company_name},\n\nWe wanted to check in on ${form.company_name} and see how we can help with your next project.\n\nKind regards,\nPaneltec Group`}
          endpoint={`/customers/${id}/email-sent`}
          onSent={() => api.get(`/customers/${id}`).then(({ data }) => setForm({ ...form, ...data }))}
        />
      )}
    </div>
  );
}

function Section({ title, action, children }) {
  return (
    <section className="bg-white border border-gray-200 rounded p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-bold uppercase tracking-[0.15em] text-[#3A6B8C]">{title}</h2>
        {action}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">{children}</div>
    </section>
  );
}

function Field({ label, required, children }) {
  return (
    <div>
      <Label className="text-xs uppercase tracking-wider text-[#3A6B8C] font-bold">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </Label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function AddressFields({ value, prefix, onChange }) {
  return (
    <>
      <Field label="Street"><Input value={value.street} onChange={(e) => onChange("street", e.target.value)} data-testid={`${prefix}-street`} className="h-11"/></Field>
      <Field label="Suburb"><Input value={value.suburb} onChange={(e) => onChange("suburb", e.target.value)} data-testid={`${prefix}-suburb`} className="h-11"/></Field>
      <Field label="State">
        <Select value={value.state || undefined} onValueChange={(v) => onChange("state", v)}>
          <SelectTrigger data-testid={`${prefix}-state`} className="h-11"><SelectValue placeholder="Select…"/></SelectTrigger>
          <SelectContent>{AU_STATES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
        </Select>
      </Field>
      <Field label="Postcode (4 digits)"><Input value={value.postcode} onChange={(e) => onChange("postcode", e.target.value)} maxLength={4} data-testid={`${prefix}-postcode`} className="h-11 tabular-nums"/></Field>
    </>
  );
}

function ProjectsCard({ customerId, projects, onChanged, customerSiteAddress, reloadProjects }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { hasPerm, isSuperAdmin } = useAuth();
  const canDelete = hasPerm("projects.delete");

  const add = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.post("/projects", {
        customer_id: customerId, project_name: name, description: desc,
        site_address: customerSiteAddress,
      });
      const { data } = await api.get(`/customers/${customerId}/projects`);
      onChanged(data);
      setName(""); setDesc(""); setOpen(false);
      toast.success("Project added");
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message);
    } finally { setSubmitting(false); }
  };

  return (
    <section className="bg-white border border-gray-200 rounded p-6" data-testid="customer-projects">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-bold uppercase tracking-[0.15em] text-[#3A6B8C]">Projects</h2>
        <Button variant="outline" size="sm" onClick={() => setOpen(v => !v)} data-testid="add-project-btn">
          {open ? "Cancel" : "+ Add project"}
        </Button>
      </div>
      {open && (
        <form onSubmit={add} className="mb-4 grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
          <div className="md:col-span-2"><Label className="text-xs uppercase tracking-wider text-[#3A6B8C] font-bold">Project name</Label>
            <Input value={name} onChange={e => setName(e.target.value)} required className="h-10 mt-1" data-testid="proj-name-input"/></div>
          <div className="md:col-span-3"><Label className="text-xs uppercase tracking-wider text-[#3A6B8C] font-bold">Description</Label>
            <Textarea value={desc} onChange={e => setDesc(e.target.value)} rows={2} className="mt-1" data-testid="proj-desc-input"/></div>
          <Button type="submit" disabled={submitting} className="bg-[#3A6B8C] text-white hover:bg-[#2C526B]" data-testid="proj-create-btn">Add</Button>
        </form>
      )}
      {projects.length === 0 ? (
        <div className="text-sm text-gray-500">No projects yet.</div>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-[10px] uppercase tracking-wider text-gray-500 border-b">
            <tr><th className="text-left py-2">Name</th><th className="text-left">Status</th><th className="text-left">Created</th><th className="text-right"></th></tr>
          </thead>
          <tbody>
            {(projects ?? []).map(p => (
              <tr key={p.id} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="py-2.5 font-semibold text-[#1F2A33]">
                  <Link to={`/projects/${p.id}`} className="hover:text-[#3A6B8C]" data-testid={`proj-link-${p.id}`}>
                    {p.project_name}
                  </Link>
                  <div className="text-xs text-gray-500 font-normal">{p.description}</div>
                </td>
                <td><span className="text-[10px] font-bold uppercase tracking-wider bg-gray-100 text-gray-600 px-2 py-0.5 rounded">{p.status}</span></td>
                <td className="text-xs text-gray-500">{formatDateTime(p.created_at)}</td>
                <td className="text-right">
                  <button type="button"
                    onClick={async () => {
                      try {
                        toast.loading("Opening PDF…", { id: `proj-pdf-${p.id}` });
                        const r = await openPdf(`/projects/${p.id}/pdf`, `paneltec_project_${p.id}.pdf`);
                        if (r?.blocked) toast.error("Popup blocked — PDF downloaded instead.", { id: `proj-pdf-${p.id}` });
                        else toast.success("Project PDF opened", { id: `proj-pdf-${p.id}` });
                      } catch (err) {
                        toast.error(formatApiErrorDetail(err.response?.data?.detail) || "Failed to generate PDF", { id: `proj-pdf-${p.id}` });
                      }
                    }}
                    data-testid={`proj-print-${p.id}`}
                    className="text-[11px] font-bold uppercase tracking-wider text-[#3A6B8C] hover:text-[#1F2A33]">Print</button>
                  <span className="inline-block ml-2 align-middle">
                    <DeleteRowActions entity="projects" row={p}
                      label={(r) => r.project_name}
                      canDelete={canDelete} isSuperAdmin={isSuperAdmin}
                      onChanged={reloadProjects} />
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
