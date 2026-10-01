import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Loader2, ArrowLeft, ChevronUp, ChevronDown } from "lucide-react";
import { api } from "../lib/api";
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

const INPUT_TYPES = [
  { value: "yes_no", label: "Yes / No / N/A" },
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "dimension_lw_mm", label: "Dimension (L × W mm)" },
  { value: "date", label: "Date" },
  { value: "checkbox", label: "Checkbox" },
  { value: "signature", label: "Signature" },
];

const slug = (s) => String(s).toLowerCase().trim().replace(/[^a-z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");

export default function TemplateEditor() {
  const { id } = useParams();
  const nav = useNavigate();
  const { hasPerm } = useAuth();
  const [tpl, setTpl] = useState(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  const load = async () => {
    try {
      const r = await api.get(`/compliance-templates/${id}`);
      setTpl(r.data); setDirty(false);
    } catch (e) { toast.error(e.response?.data?.detail || "Load failed"); }
  };
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!hasPerm("forms.template_manage")) {
    return <div className="p-12 text-center text-sm text-gray-500">forms.template_manage permission required.</div>;
  }
  if (!tpl) {
    return <div className="p-12 flex items-center justify-center text-gray-500"><Loader2 className="w-5 h-5 mr-2 animate-spin"/> Loading…</div>;
  }

  const isLocked = !!tpl.is_system;
  const update = (patch) => { setTpl({...tpl, ...patch}); setDirty(true); };
  const updateSections = (sections) => update({ sections });
  const updateHeader = (header_fields) => update({ header_fields });

  // ---- Section ops ----
  const addSection = () => {
    const key = `section_${tpl.sections.length + 1}`;
    updateSections([...tpl.sections, { key, title: "New section", defects_list: false, criteria: [] }]);
  };
  const patchSection = (idx, patch) => {
    const s = [...tpl.sections]; s[idx] = {...s[idx], ...patch}; updateSections(s);
  };
  const moveSection = (idx, dir) => {
    const to = idx + dir; if (to < 0 || to >= tpl.sections.length) return;
    const s = [...tpl.sections]; [s[idx], s[to]] = [s[to], s[idx]]; updateSections(s);
  };
  const removeSection = (idx) => {
    if (!window.confirm(`Delete section "${tpl.sections[idx].title}"?`)) return;
    updateSections(tpl.sections.filter((_, i) => i !== idx));
  };

  // ---- Criterion ops ----
  const addCriterion = (sIdx) => {
    const s = [...tpl.sections]; const c = s[sIdx].criteria || [];
    s[sIdx] = {...s[sIdx], criteria: [...c, {
      key: `criterion_${c.length + 1}`, label: "New criterion",
      input_type: "yes_no", unit: null, required: false, allow_photo: false, allow_notes: true, help_text: "",
    }]};
    updateSections(s);
  };
  const patchCriterion = (sIdx, cIdx, patch) => {
    const s = [...tpl.sections]; const c = [...s[sIdx].criteria];
    c[cIdx] = {...c[cIdx], ...patch}; s[sIdx] = {...s[sIdx], criteria: c}; updateSections(s);
  };
  const moveCriterion = (sIdx, cIdx, dir) => {
    const to = cIdx + dir; const s = [...tpl.sections]; const c = [...s[sIdx].criteria];
    if (to < 0 || to >= c.length) return;
    [c[cIdx], c[to]] = [c[to], c[cIdx]]; s[sIdx] = {...s[sIdx], criteria: c}; updateSections(s);
  };
  const removeCriterion = (sIdx, cIdx) => {
    const s = [...tpl.sections]; const c = s[sIdx].criteria.filter((_, i) => i !== cIdx);
    s[sIdx] = {...s[sIdx], criteria: c}; updateSections(s);
  };

  // ---- Header field ops ----
  const addHeader = () => updateHeader([...(tpl.header_fields || []), { key: `field_${(tpl.header_fields||[]).length+1}`, label: "New field", required: false, input_type: "text" }]);
  const patchHeader = (idx, patch) => { const h = [...tpl.header_fields]; h[idx] = {...h[idx], ...patch}; updateHeader(h); };
  const removeHeader = (idx) => updateHeader(tpl.header_fields.filter((_, i) => i !== idx));
  const moveHeader = (idx, dir) => {
    const to = idx + dir; if (to < 0 || to >= tpl.header_fields.length) return;
    const h = [...tpl.header_fields]; [h[idx], h[to]] = [h[to], h[idx]]; updateHeader(h);
  };

  const save = async () => {
    // Validation: unique keys
    const allKeys = [];
    for (const s of tpl.sections) {
      if (!s.key || !/^[a-z0-9_]+$/.test(s.key)) { toast.error(`Section key "${s.key}" invalid (lowercase + underscores only)`); return; }
      allKeys.push(`s:${s.key}`);
      const cKeys = new Set();
      for (const c of (s.criteria || [])) {
        if (!c.key || !/^[a-z0-9_]+$/.test(c.key)) { toast.error(`Criterion key "${c.key}" invalid`); return; }
        if (cKeys.has(c.key)) { toast.error(`Duplicate criterion key "${c.key}" in section "${s.title}"`); return; }
        cKeys.add(c.key);
      }
    }
    if (new Set(tpl.sections.map(s => s.key)).size !== tpl.sections.length) {
      toast.error("Duplicate section keys"); return;
    }
    setBusy(true);
    try {
      await api.patch(`/compliance-templates/${id}`, {
        name: tpl.name, description: tpl.description, category: tpl.category,
        sections: tpl.sections, header_fields: tpl.header_fields,
      });
      toast.success(`Saved — now v${tpl.version + 1}`);
      load();
    } catch (e) { toast.error(e.response?.data?.detail || "Save failed"); }
    finally { setBusy(false); }
  };

  return (
    <div className="max-w-6xl space-y-5" data-testid="template-editor-page">
      <Link to="/forms/templates" className="inline-flex items-center text-xs uppercase tracking-wider text-[#3A6B8C] font-bold hover:text-[#1F2A33]">
        <ArrowLeft className="w-3 h-3 mr-1"/> Back to templates
      </Link>

      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-[0.18em] text-[#3A6B8C] font-bold">Template editor</div>
          <h1 className="text-3xl font-black tracking-tighter text-[#1F2A33] truncate" data-testid="template-name-header">{tpl.name}</h1>
          <div className="text-xs text-gray-500 mt-1 flex flex-wrap gap-2 items-center">
            <code className="font-mono bg-gray-100 px-2 py-0.5 rounded">{tpl.code}</code>
            <span>·</span><span>v{tpl.version}</span>
            <span>·</span><span>{tpl.category}</span>
            {tpl.is_system && <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-blue-100 text-blue-800">System (read-only)</span>}
            {!tpl.is_system && <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${tpl.active ? "bg-green-100 text-green-800" : "bg-gray-200 text-gray-600"}`}>{tpl.active ? "Active" : "Inactive"}</span>}
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          {!isLocked && (
            <Button onClick={save} disabled={busy || !dirty}
                    className="bg-[#F5C518] text-[#1F2A33] font-bold hover:bg-[#E0B416]" data-testid="save-template-btn">
              {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin"/> : <AppIcon name="save" size={16} decorative className="mr-1"/>}
              Save changes
            </Button>
          )}
        </div>
      </div>

      {isLocked && (
        <div className="bg-blue-50 border border-blue-200 text-blue-900 rounded p-3 text-sm" data-testid="system-template-banner">
          This is a system template. To customise, use <strong>Clone</strong> on the templates list — it produces an editable copy (e.g. <code className="bg-white px-1 rounded">{tpl.code}_v2</code>).
        </div>
      )}

      {/* Metadata */}
      <div className="bg-white border border-gray-200 rounded p-5 space-y-3" data-testid="template-meta">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <Label className="text-[10px] uppercase tracking-wider font-bold text-gray-500">Name</Label>
            <Input value={tpl.name} disabled={isLocked} onChange={(e) => update({ name: e.target.value })} data-testid="meta-name"/>
          </div>
          <div>
            <Label className="text-[10px] uppercase tracking-wider font-bold text-gray-500">Category</Label>
            <Input value={tpl.category} disabled={isLocked} onChange={(e) => update({ category: e.target.value })} data-testid="meta-category"/>
          </div>
        </div>
        <div>
          <Label className="text-[10px] uppercase tracking-wider font-bold text-gray-500">Description</Label>
          <Textarea value={tpl.description || ""} disabled={isLocked} rows={2}
                    onChange={(e) => update({ description: e.target.value })} data-testid="meta-description"/>
        </div>
      </div>

      {/* Header fields */}
      <div className="bg-white border border-gray-200 rounded p-5 space-y-3" data-testid="header-fields-card">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-wider font-bold text-[#3A6B8C]">Header fields</div>
            <div className="text-xs text-gray-500">Top-of-form metadata captured before checklist items.</div>
          </div>
          {!isLocked && <Button size="sm" variant="outline" onClick={addHeader} data-testid="add-header-btn"><AppIcon name="add" size={14} decorative className="mr-1"/> Add field</Button>}
        </div>
        {(tpl.header_fields || []).length === 0 ? (
          <div className="text-xs text-gray-400 italic">No header fields.</div>
        ) : (
          <div className="space-y-2">
            {tpl.header_fields.map((f, idx) => (
              <div key={idx} className="grid grid-cols-12 gap-2 items-center bg-gray-50 rounded p-2" data-testid={`header-field-${idx}`}>
                <Input className="col-span-3" value={f.key || ""} disabled={isLocked}
                       onChange={(e) => patchHeader(idx, { key: slug(e.target.value) })} placeholder="key"/>
                <Input className="col-span-4" value={f.label || ""} disabled={isLocked}
                       onChange={(e) => patchHeader(idx, { label: e.target.value })} placeholder="Label"/>
                <Select value={f.input_type || "text"} disabled={isLocked}
                        onValueChange={(v) => patchHeader(idx, { input_type: v })}>
                  <SelectTrigger className="col-span-2"><SelectValue/></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="text">Text</SelectItem>
                    <SelectItem value="date">Date</SelectItem>
                    <SelectItem value="number">Number</SelectItem>
                  </SelectContent>
                </Select>
                <label className="col-span-1 flex items-center gap-1 text-xs">
                  <input type="checkbox" checked={!!f.required} disabled={isLocked}
                         onChange={(e) => patchHeader(idx, { required: e.target.checked })}/> Req
                </label>
                <div className="col-span-2 flex justify-end gap-1">
                  {!isLocked && <>
                    <Button size="sm" variant="outline" onClick={() => moveHeader(idx, -1)}><ChevronUp className="w-3 h-3"/></Button>
                    <Button size="sm" variant="outline" onClick={() => moveHeader(idx, 1)}><ChevronDown className="w-3 h-3"/></Button>
                    <Button size="sm" variant="outline" onClick={() => removeHeader(idx)} className="text-red-700 border-red-200 hover:bg-red-50">×</Button>
                  </>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Sections + criteria */}
      <div className="space-y-3" data-testid="sections-stack">
        {tpl.sections.map((s, sIdx) => (
          <div key={sIdx} className="bg-white border border-gray-200 rounded p-5 space-y-3" data-testid={`section-${sIdx}`}>
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <div className="flex-1 min-w-0 grid grid-cols-12 gap-2 items-center">
                <Input className="col-span-3" value={s.key} disabled={isLocked}
                       onChange={(e) => patchSection(sIdx, { key: slug(e.target.value) })} placeholder="section_key"/>
                <Input className="col-span-7" value={s.title} disabled={isLocked}
                       onChange={(e) => patchSection(sIdx, { title: e.target.value })} placeholder="Section title"/>
                <label className="col-span-2 flex items-center gap-1 text-xs">
                  <input type="checkbox" checked={!!s.defects_list} disabled={isLocked}
                         onChange={(e) => patchSection(sIdx, { defects_list: e.target.checked })}/> Defects list
                </label>
              </div>
              {!isLocked && (
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" onClick={() => moveSection(sIdx, -1)} data-testid={`section-up-${sIdx}`}><ChevronUp className="w-4 h-4"/></Button>
                  <Button size="sm" variant="outline" onClick={() => moveSection(sIdx, 1)} data-testid={`section-down-${sIdx}`}><ChevronDown className="w-4 h-4"/></Button>
                  <Button size="sm" variant="outline" onClick={() => removeSection(sIdx)}
                          className="text-red-700 border-red-200 hover:bg-red-50" data-testid={`section-delete-${sIdx}`}>
                    <AppIcon name="delete" size={14} decorative/>
                  </Button>
                </div>
              )}
            </div>

            <div className="ml-2 border-l-2 border-amber-200 pl-3 space-y-1.5">
              {(s.criteria || []).map((c, cIdx) => (
                <div key={cIdx} className="grid grid-cols-12 gap-2 items-center bg-gray-50 rounded p-2" data-testid={`criterion-${sIdx}-${cIdx}`}>
                  <Input className="col-span-3 font-mono text-xs" value={c.key} disabled={isLocked}
                         onChange={(e) => patchCriterion(sIdx, cIdx, { key: slug(e.target.value) })} placeholder="criterion_key"/>
                  <Input className="col-span-4 text-sm" value={c.label} disabled={isLocked}
                         onChange={(e) => patchCriterion(sIdx, cIdx, { label: e.target.value })} placeholder="Label"/>
                  <Select value={c.input_type} disabled={isLocked}
                          onValueChange={(v) => patchCriterion(sIdx, cIdx, { input_type: v })}>
                    <SelectTrigger className="col-span-2 text-xs"><SelectValue/></SelectTrigger>
                    <SelectContent>
                      {INPUT_TYPES.map(it => <SelectItem key={it.value} value={it.value}>{it.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <div className="col-span-2 flex items-center gap-2 text-[11px]">
                    <label className="flex items-center gap-1">
                      <input type="checkbox" checked={!!c.required} disabled={isLocked}
                             onChange={(e) => patchCriterion(sIdx, cIdx, { required: e.target.checked })}/>Req
                    </label>
                    <label className="flex items-center gap-1">
                      <input type="checkbox" checked={!!c.allow_photo} disabled={isLocked}
                             onChange={(e) => patchCriterion(sIdx, cIdx, { allow_photo: e.target.checked })}/>Photo
                    </label>
                  </div>
                  <div className="col-span-1 flex justify-end gap-1">
                    {!isLocked && <>
                      <Button size="sm" variant="outline" onClick={() => moveCriterion(sIdx, cIdx, -1)}><ChevronUp className="w-3 h-3"/></Button>
                      <Button size="sm" variant="outline" onClick={() => moveCriterion(sIdx, cIdx, 1)}><ChevronDown className="w-3 h-3"/></Button>
                      <Button size="sm" variant="outline" onClick={() => removeCriterion(sIdx, cIdx)} className="text-red-700 border-red-200 hover:bg-red-50">×</Button>
                    </>}
                  </div>
                </div>
              ))}
              {!isLocked && (
                <Button size="sm" variant="outline" onClick={() => addCriterion(sIdx)} data-testid={`add-criterion-${sIdx}`}>
                  <AppIcon name="add" size={14} decorative className="mr-1"/> Add criterion
                </Button>
              )}
              {(s.criteria || []).length === 0 && <div className="text-xs text-gray-400 italic">No criteria yet.</div>}
            </div>
          </div>
        ))}

        {!isLocked && (
          <Button variant="outline" onClick={addSection} className="w-full border-dashed" data-testid="add-section-btn">
            <AppIcon name="add" size={16} decorative className="mr-1"/> Add section
          </Button>
        )}
        {tpl.sections.length === 0 && (
          <div className="bg-white border border-dashed border-gray-300 rounded p-8 text-center text-sm text-gray-400">
            No sections. {!isLocked && "Click Add section above to start."}
          </div>
        )}
      </div>

      {dirty && !isLocked && (
        <div className="sticky bottom-3 bg-[#1F2A33] text-white rounded p-3 flex items-center justify-between shadow-lg" data-testid="dirty-banner">
          <span className="text-sm">Unsaved changes — saving will publish v{tpl.version + 1}</span>
          <Button onClick={save} disabled={busy} className="bg-[#F5C518] text-[#1F2A33] font-bold hover:bg-[#E0B416]">
            {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin"/> : null} Save now
          </Button>
        </div>
      )}
    </div>
  );
}
