import { useEffect, useState, useCallback } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { Loader2, ArrowLeft } from "lucide-react";
import { api, formatApiErrorDetail } from "../lib/api";
import { useAuth } from "../contexts/AuthContext";
import AppIcon from "../components/AppIcon";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "../components/ui/select";
import { toast } from "sonner";
import { downloadPdf } from "../lib/print";

const STATUS_PILL = {
  draft:     "bg-gray-100 text-gray-700",
  completed: "bg-amber-100 text-amber-800",
  signed:    "bg-green-100 text-green-800",
};

export default function FormDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { hasPerm } = useAuth();
  const [form, setForm] = useState(null);
  const [schema, setSchema] = useState(null);
  const [users, setUsers] = useState([]);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async () => {
    const [f, s, u] = await Promise.all([
      api.get(`/compliance-forms/${id}`),
      api.get(`/compliance-forms/schemas`),
      api.get(`/users?status=active`).catch(() => ({ data: { items: [] } })),
    ]);
    setForm(f.data);
    setSchema(s.data[f.data.form_type]);
    setUsers(u.data.items || []);
    setDirty(false);
  }, [id]);
  useEffect(() => { load(); }, [load]);

  if (!form || !schema) return (
    <div className="p-12 flex items-center justify-center text-gray-500">
      <Loader2 className="w-5 h-5 mr-2 animate-spin"/> Loading…
    </div>
  );

  const update = (patch) => { setForm({ ...form, ...patch }); setDirty(true); };
  const updateSection = (sectionKey, criterionKey, field, value) => {
    const sections = { ...form.sections };
    sections[sectionKey] = { ...sections[sectionKey] };
    sections[sectionKey][criterionKey] = { ...sections[sectionKey][criterionKey], [field]: value };
    update({ sections });
  };

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        panel_id: form.panel_id, client_name: form.client_name, project_name: form.project_name,
        grade_of_concrete: form.grade_of_concrete, date_of_inspection: form.date_of_inspection,
        date_of_casting: form.date_of_casting, sections: form.sections,
        ncr_flag: form.ncr_flag, ncr_reference: form.ncr_reference,
        checked_by_user_id: form.checked_by_user_id, checked_by_qa_user_id: form.checked_by_qa_user_id,
      };
      await api.patch(`/compliance-forms/${id}`, payload);
      toast.success("Saved");
      setDirty(false);
      load();
    } catch (e) { toast.error(e.response?.data?.detail || "Save failed"); }
    finally { setSaving(false); }
  };

  const transition = async (to) => {
    if (dirty) { await save(); }
    try {
      await api.post(`/compliance-forms/${id}/transition`, { to });
      toast.success(to === "signed" ? "Signed ✓" : to === "completed" ? "Marked complete" : "Reverted to draft");
      load();
    } catch (e) { toast.error(e.response?.data?.detail || "Transition failed"); }
  };

  const locked = form.status === "signed";

  return (
    <div className="max-w-5xl" data-testid="form-detail-page">
      <Link to="/forms" className="inline-flex items-center text-xs text-[#3A6B8C] hover:text-[#1F2A33] mb-3">
        <ArrowLeft className="w-3 h-3 mr-1"/> Back to forms
      </Link>

      <div className="bg-white border border-gray-200 rounded p-5 mb-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-[#3A6B8C] font-bold">{schema.title}</div>
            <h1 className="text-2xl font-black tracking-tight text-[#1F2A33] font-mono" data-testid="form-number">{form.form_number}</h1>
            <div className="mt-1 flex items-center gap-2">
              <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${STATUS_PILL[form.status]}`} data-testid="form-status">{form.status}</span>
              {form.job_id && <Link to={`/jobs/${form.job_id}`} className="text-xs text-[#3A6B8C] hover:underline">↗ Linked job</Link>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!locked && dirty && (
              <Button onClick={save} disabled={saving} variant="outline" data-testid="save-draft-btn">
                {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin"/> : <AppIcon name="save" size={16} className="mr-2" decorative/>} Save draft
              </Button>
            )}
            {form.status === "draft" && (
              <Button onClick={() => transition("completed")} className="bg-amber-500 text-white hover:bg-amber-600" data-testid="mark-complete-btn">
                <AppIcon name="confirm" size={16} className="mr-2" decorative/> Mark Complete
              </Button>
            )}
            {form.status === "completed" && hasPerm("forms.sign") && (
              <Button onClick={() => transition("signed")} className="bg-green-700 text-white hover:bg-green-800" data-testid="sign-btn">
                <AppIcon name="success" size={16} className="mr-2" decorative/> Sign
              </Button>
            )}
            {form.status !== "draft" && hasPerm("forms.edit") && (
              <Button variant="outline" onClick={() => transition("draft")} data-testid="revert-btn">
                <AppIcon name="restore" size={16} className="mr-2" decorative/> Revert
              </Button>
            )}
            <Button variant="outline"
              onClick={async () => {
                try {
                  toast.loading("Generating PDF…", { id: "form-pdf" });
                  await downloadPdf(`/compliance-forms/${id}/pdf`, `paneltec_form_${form.form_number || id}.pdf`);
                  toast.success("Form PDF downloaded", { id: "form-pdf" });
                } catch (err) {
                  toast.error(formatApiErrorDetail(err.response?.data?.detail) || "Failed to generate PDF", { id: "form-pdf" });
                }
              }}
              data-testid="print-btn">
              <AppIcon name="print" size={16} className="mr-2" decorative/> Print
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-5">
          <Field label="Client" value={form.client_name} onChange={(v) => update({ client_name: v })} disabled={locked}/>
          <Field label="Project" value={form.project_name} onChange={(v) => update({ project_name: v })} disabled={locked}/>
          <Field label="Panel ID" value={form.panel_id} onChange={(v) => update({ panel_id: v })} disabled={locked} testid="panel-id-input"/>
          <Field label="Date of Inspection" type="date" value={form.date_of_inspection || ""} onChange={(v) => update({ date_of_inspection: v })} disabled={locked}/>
          <Field label="Date of Casting" type="date" value={form.date_of_casting || ""} onChange={(v) => update({ date_of_casting: v })} disabled={locked}/>
          <Field label="Grade of Concrete" value={form.grade_of_concrete} onChange={(v) => update({ grade_of_concrete: v })} disabled={locked}/>
        </div>
      </div>

      {/* Render schema sections */}
      {form.form_type !== "compliance_cert" && (schema.sections || []).map(section => (
        <div key={section.key} className="bg-white border border-gray-200 rounded p-5 mb-4">
          <h2 className="text-sm font-bold uppercase tracking-[0.15em] text-[#3A6B8C] mb-3">{section.label}</h2>
          {section.criteria && section.criteria.length > 0 ? (
            <div className="space-y-3">
              {section.criteria.map(c => {
                const v = (form.sections?.[section.key]?.[c.key]) || {};
                return (
                  <div key={c.key} className="border-b border-gray-100 pb-3 last:border-0" data-testid={`criterion-${c.key}`}>
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-[#1F2A33]">{c.label}</div>
                        {c.value_unit && (
                          <Input className="mt-1 w-48" placeholder={c.value_unit}
                                 value={v.value || ""} disabled={locked}
                                 onChange={(e) => updateSection(section.key, c.key, "value", e.target.value)}/>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5">
                        {["ok", "rectify", "na"].map(rec => (
                          <button key={rec} type="button" disabled={locked}
                                  onClick={() => updateSection(section.key, c.key, "record", rec)}
                                  data-testid={`record-${c.key}-${rec}`}
                                  className={`px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider border ${
                                    v.record === rec
                                      ? rec === "ok" ? "bg-green-700 text-white border-green-700"
                                        : rec === "rectify" ? "bg-red-700 text-white border-red-700"
                                        : "bg-gray-700 text-white border-gray-700"
                                      : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
                                  } disabled:opacity-50`}>
                            {rec === "ok" ? "✓ OK" : rec === "rectify" ? "✗ Rectify" : "N/A"}
                          </button>
                        ))}
                      </div>
                    </div>
                    <Textarea placeholder="Notes (optional)" rows={2} disabled={locked}
                              value={v.notes || ""}
                              onChange={(e) => updateSection(section.key, c.key, "notes", e.target.value)}
                              className="mt-2 text-xs"/>
                  </div>
                );
              })}
            </div>
          ) : section.defects_list ? (
            <DefectsEditor value={(form.sections?.[section.key]?._defects) || []}
                            onChange={(arr) => {
                              const sections = { ...form.sections };
                              sections[section.key] = { ...sections[section.key], _defects: arr };
                              update({ sections });
                            }}
                            locked={locked}/>
          ) : null}
        </div>
      ))}

      {form.form_type === "compliance_cert" && (
        <CertEditor schema={schema} form={form} update={update} locked={locked}/>
      )}

      {/* Photos */}
      <PhotoZone formId={id} photos={form.photos || []} locked={locked} onChange={load}/>

      {/* NCR + QA sign-off */}
      <div className="bg-white border border-gray-200 rounded p-5 mb-4">
        <h2 className="text-sm font-bold uppercase tracking-[0.15em] text-[#3A6B8C] mb-3">NCR &amp; Sign-off</h2>
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={!!form.ncr_flag} disabled={locked}
                   onChange={(e) => update({ ncr_flag: e.target.checked })} data-testid="ncr-flag"/>
            NCR raised
          </label>
          {form.ncr_flag && (
            <Input placeholder="NCR reference" value={form.ncr_reference || ""} disabled={locked}
                   onChange={(e) => update({ ncr_reference: e.target.value })} data-testid="ncr-ref"/>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <UserPick label="Checked by" value={form.checked_by_user_id} users={users}
                       onChange={(v) => update({ checked_by_user_id: v })} disabled={locked}
                       testid="checked-by"/>
            <UserPick label="Checked by QA" value={form.checked_by_qa_user_id} users={users}
                       onChange={(v) => update({ checked_by_qa_user_id: v })} disabled={locked}
                       testid="checked-by-qa"/>
          </div>
          {form.signed_at && (
            <div className="text-xs text-green-800 bg-green-50 rounded p-2">
              ✓ Signed at {form.signed_at} by user {form.signed_by_user_id}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, disabled, type = "text", testid }) {
  return (
    <div>
      <Label className="text-[10px] uppercase tracking-wider font-bold text-gray-500">{label}</Label>
      <Input type={type} value={value || ""} disabled={disabled}
             onChange={(e) => onChange(e.target.value)}
             className="mt-1" data-testid={testid}/>
    </div>
  );
}

function UserPick({ label, value, onChange, users, disabled, testid }) {
  return (
    <div>
      <Label className="text-[10px] uppercase tracking-wider font-bold text-gray-500">{label}</Label>
      <Select value={value || "none"} onValueChange={(v) => onChange(v === "none" ? null : v)} disabled={disabled}>
        <SelectTrigger className="mt-1" data-testid={testid}><SelectValue placeholder="— Select —"/></SelectTrigger>
        <SelectContent>
          <SelectItem value="none">— Unassigned —</SelectItem>
          {users.map(u => (
            <SelectItem key={u.id} value={u.id}>{u.name || u.email}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function DefectsEditor({ value, onChange, locked }) {
  const add = () => onChange([...(value || []), { location: "", description: "", remedy: "" }]);
  const update = (i, field, v) => {
    const arr = [...value]; arr[i] = { ...arr[i], [field]: v }; onChange(arr);
  };
  const remove = (i) => { const arr = [...value]; arr.splice(i, 1); onChange(arr); };
  return (
    <div className="space-y-3" data-testid="defects-editor">
      {(value || []).map((d, i) => (
        <div key={i} className="grid grid-cols-1 md:grid-cols-4 gap-2 border border-gray-200 rounded p-3">
          <Input placeholder="Location" value={d.location} disabled={locked} onChange={(e) => update(i, "location", e.target.value)}/>
          <Input placeholder="Description" value={d.description} disabled={locked} onChange={(e) => update(i, "description", e.target.value)} className="md:col-span-2"/>
          <div className="flex gap-2">
            <Input placeholder="Remedy" value={d.remedy} disabled={locked} onChange={(e) => update(i, "remedy", e.target.value)}/>
            {!locked && <Button variant="outline" size="sm" onClick={() => remove(i)}><AppIcon name="delete" size={14} decorative/></Button>}
          </div>
        </div>
      ))}
      {!locked && (
        <Button variant="outline" size="sm" onClick={add} data-testid="add-defect">
          <AppIcon name="add" size={14} className="mr-1" decorative/> Add defect
        </Button>
      )}
    </div>
  );
}

function CertEditor({ schema, form, update, locked }) {
  const header = form.sections?.header || {};
  const schedule = form.sections?.schedule_of_elements || [];
  const sig = form.sections?.signature || {};
  const setHeader = (k, v) => {
    const sections = { ...form.sections, header: { ...header, [k]: v } };
    update({ sections });
  };
  const setSchedule = (arr) => {
    const sections = { ...form.sections, schedule_of_elements: arr }; update({ sections });
  };
  const setSig = (k, v) => {
    const sections = { ...form.sections, signature: { ...sig, [k]: v } }; update({ sections });
  };
  return (
    <>
      <div className="bg-white border border-gray-200 rounded p-5 mb-4">
        <h2 className="text-sm font-bold uppercase tracking-[0.15em] text-[#3A6B8C] mb-3">Header</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {schema.header_fields.map(f => (
            <Field key={f.key} label={f.label} value={header[f.key] || ""} onChange={(v) => setHeader(f.key, v)} disabled={locked}/>
          ))}
        </div>
      </div>
      <div className="bg-white border border-gray-200 rounded p-5 mb-4">
        <h2 className="text-sm font-bold uppercase tracking-[0.15em] text-[#3A6B8C] mb-3">{schema.schedule_of_elements_label}</h2>
        <div className="space-y-2" data-testid="cert-schedule">
          {schedule.map((row, i) => (
            <div key={i} className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <Input placeholder="Identification Number" value={row.identification_number || ""} disabled={locked}
                     onChange={(e) => { const arr = [...schedule]; arr[i] = { ...arr[i], identification_number: e.target.value }; setSchedule(arr); }}/>
              <Input placeholder="Casting Date" type="date" value={row.casting_date || ""} disabled={locked}
                     onChange={(e) => { const arr = [...schedule]; arr[i] = { ...arr[i], casting_date: e.target.value }; setSchedule(arr); }}/>
              {!locked && <Button variant="outline" size="sm" onClick={() => { const arr = [...schedule]; arr.splice(i, 1); setSchedule(arr); }}><AppIcon name="delete" size={14} decorative/></Button>}
            </div>
          ))}
          {!locked && (
            <Button variant="outline" size="sm" onClick={() => setSchedule([...schedule, { identification_number: "", casting_date: "" }])}>
              <AppIcon name="add" size={14} className="mr-1" decorative/> Add element
            </Button>
          )}
        </div>
        <div className="mt-4 text-xs text-gray-600 italic border-l-4 border-amber-300 pl-3 py-2 bg-amber-50">
          {schema.declaration_text}
        </div>
        <div className="mt-2 text-[10px] text-gray-500">
          Standards referenced: {(schema.standards_referenced || []).join(" · ")}
        </div>
      </div>
      <div className="bg-white border border-gray-200 rounded p-5 mb-4">
        <h2 className="text-sm font-bold uppercase tracking-[0.15em] text-[#3A6B8C] mb-3">Signatory</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Field label="Name" value={sig.name} onChange={(v) => setSig("name", v)} disabled={locked}/>
          <Field label="Signature (typed)" value={sig.signature} onChange={(v) => setSig("signature", v)} disabled={locked}/>
          <Field label="Date" type="date" value={sig.date} onChange={(v) => setSig("date", v)} disabled={locked}/>
        </div>
      </div>
    </>
  );
}

function PhotoZone({ formId, photos, locked, onChange }) {
  const [busy, setBusy] = useState(false);
  const upload = async (file) => {
    setBusy(true);
    try {
      const fd = new FormData(); fd.append("file", file); fd.append("caption", "");
      await api.post(`/compliance-forms/${formId}/photos`, fd, { headers: { "Content-Type": "multipart/form-data" } });
      toast.success("Uploaded"); onChange();
    } catch (e) { toast.error(e.response?.data?.detail || "Upload failed"); }
    finally { setBusy(false); }
  };
  const remove = async (pid) => {
    if (!window.confirm("Delete this photo?")) return;
    try { await api.delete(`/compliance-forms/${formId}/photos/${pid}`); toast.success("Deleted"); onChange(); }
    catch (e) { toast.error(e.response?.data?.detail || "Delete failed"); }
  };
  return (
    <div className="bg-white border border-gray-200 rounded p-5 mb-4" data-testid="photo-zone">
      <h2 className="text-sm font-bold uppercase tracking-[0.15em] text-[#3A6B8C] mb-3">Photos</h2>
      {!locked && (
        <label className="block border-2 border-dashed border-gray-300 rounded p-4 text-center cursor-pointer hover:border-[#3A6B8C] mb-3" data-testid="photo-upload-zone">
          <input type="file" accept="image/*" capture="environment" className="hidden"
                 disabled={busy}
                 onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}/>
          <div className="text-sm text-gray-600">
            {busy ? "Uploading…" : <><AppIcon name="add" size={18} decorative className="inline mr-1"/> Click to upload photo (JPG/PNG, max 10 MB)</>}
          </div>
        </label>
      )}
      {photos.length === 0 ? (
        <div className="text-xs text-gray-500 italic">No photos uploaded yet.</div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {photos.map(p => (
            <div key={p.id} className="border border-gray-200 rounded overflow-hidden" data-testid={`photo-${p.id}`}>
              <img src={p.url} alt={p.caption || p.filename} className="w-full h-32 object-cover bg-gray-100"/>
              <div className="p-2 text-xs">
                <div className="font-mono text-[10px] text-gray-500 truncate">{p.filename}</div>
                {(p.gps_lat || p.gps_lng || p.taken_at) ? (
                  <div className="text-[10px] text-[#3A6B8C] mt-1">
                    📍 {p.gps_lat != null ? `${p.gps_lat}, ${p.gps_lng}` : "—"}
                    {p.taken_at && <span className="ml-1">· {p.taken_at}</span>}
                  </div>
                ) : (
                  <div className="text-[10px] text-gray-400 mt-1">No GPS data</div>
                )}
                {!locked && (
                  <button onClick={() => remove(p.id)} className="text-[10px] text-red-700 hover:underline mt-1" data-testid={`delete-photo-${p.id}`}>
                    Delete
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

