import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import { api } from "../lib/api";

const TYPE_TITLE = {
  pre_pour: "Form 9.1.2 — Precast Pre-Pour Checklist",
  post_pour: "Form 9.1.3 — Precast Post-Pour Checklist",
  compliance_cert: "Form 9.1.4 — Manufacturer's Certificate of Compliance",
};

const RECORD_LABEL = { ok: "✓ Acceptable", rectify: "✗ To be rectified", na: "N/A" };

export default function FormPrint() {
  const { id } = useParams();
  const [form, setForm] = useState(null);
  const [schema, setSchema] = useState(null);

  useEffect(() => {
    (async () => {
      const f = await api.get(`/compliance-forms/${id}`);
      const s = await api.get(`/compliance-forms/schemas`);
      setForm(f.data); setSchema(s.data[f.data.form_type]);
      setTimeout(() => window.print(), 600);
    })();
  }, [id]);

  if (!form || !schema) return <div className="p-8">Loading…</div>;

  const sectionsState = form.sections || {};
  const title = TYPE_TITLE[form.form_type];

  return (
    <div className="max-w-3xl mx-auto p-8 bg-white text-[#1F2A33] font-serif" data-testid="form-print-page">
      <style>{`
        @media print {
          .page-break { page-break-before: always; }
          @page { margin: 12mm; size: A4; }
        }
        body { font-family: Inter, system-ui, sans-serif; }
        .print-table { width: 100%; border-collapse: collapse; }
        .print-table th, .print-table td { border: 1px solid #c8d0d6; padding: 6px 8px; font-size: 11px; vertical-align: top; }
        .print-table th { background: #1F2A33; color: white; text-align: left; font-weight: 700; }
      `}</style>

      {/* Header */}
      <div className="flex items-end justify-between border-b-2 border-[#F5C518] pb-2 mb-4">
        <div>
          <div className="text-2xl font-black tracking-tighter">PANELTEC GROUP</div>
          <div className="text-[10px] text-gray-500 uppercase tracking-wider">Precast Panel Business Management</div>
        </div>
        <div className="text-right text-[10px] text-gray-600">
          <div>ABN: 12 345 678 901</div>
          <div>{form.form_number}</div>
        </div>
      </div>

      <h1 className="text-xl font-black mb-3">{title}</h1>

      {/* Header info */}
      <table className="print-table mb-4">
        <tbody>
          <tr><th style={{width:"30%"}}>Client</th><td>{form.client_name || "—"}</td><th style={{width:"30%"}}>Date of Inspection</th><td>{form.date_of_inspection || "—"}</td></tr>
          <tr><th>Project</th><td>{form.project_name || "—"}</td><th>Date of Casting</th><td>{form.date_of_casting || "—"}</td></tr>
          <tr><th>Panel ID</th><td>{form.panel_id}</td><th>Grade of Concrete</th><td>{form.grade_of_concrete || "—"}</td></tr>
        </tbody>
      </table>

      {/* Sections */}
      {form.form_type !== "compliance_cert" && (schema.sections || []).map(section => {
        const sState = sectionsState[section.key] || {};
        return (
          <div key={section.key} className="mb-4">
            <h2 className="text-sm font-bold uppercase tracking-wider bg-[#F5C518] text-[#1F2A33] px-2 py-1 mb-1">{section.label}</h2>
            {section.criteria && section.criteria.length > 0 && (
              <table className="print-table">
                <thead><tr><th>Criterion</th><th style={{width:"15%"}}>Value</th><th style={{width:"15%"}}>Record</th><th>Notes</th></tr></thead>
                <tbody>
                  {section.criteria.map(c => {
                    const v = sState[c.key] || {};
                    return (
                      <tr key={c.key}>
                        <td>{c.label}</td>
                        <td>{v.value || (c.value_unit ? `__ ${c.value_unit}` : "")}</td>
                        <td>{v.record ? RECORD_LABEL[v.record] : "—"}</td>
                        <td>{v.notes || ""}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            {section.defects_list && (
              <table className="print-table">
                <thead><tr><th style={{width:"20%"}}>Location</th><th style={{width:"50%"}}>Description</th><th>Remedy</th></tr></thead>
                <tbody>
                  {(sState._defects || []).map((d, i) => (
                    <tr key={i}><td>{d.location}</td><td>{d.description}</td><td>{d.remedy}</td></tr>
                  ))}
                  {(sState._defects || []).length === 0 && (
                    <tr><td colSpan={3} className="text-center italic text-gray-500">No defects recorded.</td></tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        );
      })}

      {form.form_type === "compliance_cert" && (
        <>
          <h2 className="text-sm font-bold uppercase tracking-wider bg-[#F5C518] text-[#1F2A33] px-2 py-1 mb-1">Project Details</h2>
          <table className="print-table mb-4">
            <tbody>
              {schema.header_fields.map(f => (
                <tr key={f.key}><th style={{width:"30%"}}>{f.label}</th><td>{(sectionsState.header || {})[f.key] || "—"}</td></tr>
              ))}
            </tbody>
          </table>
          <h2 className="text-sm font-bold uppercase tracking-wider bg-[#F5C518] text-[#1F2A33] px-2 py-1 mb-1">{schema.schedule_of_elements_label}</h2>
          <table className="print-table mb-4">
            <thead><tr>{schema.schedule_columns.map(c => <th key={c}>{c}</th>)}</tr></thead>
            <tbody>
              {(sectionsState.schedule_of_elements || []).map((row, i) => (
                <tr key={i}><td>{row.identification_number}</td><td>{row.casting_date}</td></tr>
              ))}
              {(sectionsState.schedule_of_elements || []).length === 0 && (
                <tr><td colSpan={2} className="text-center italic text-gray-500">No elements listed.</td></tr>
              )}
            </tbody>
          </table>
          <div className="border-l-4 border-[#F5C518] pl-3 py-2 bg-amber-50 italic text-xs my-4">
            {schema.declaration_text}
          </div>
          <div className="text-[10px] text-gray-600 mb-4">Standards referenced: {schema.standards_referenced.join(" · ")}</div>
        </>
      )}

      {/* NCR */}
      {form.ncr_flag && (
        <div className="border border-red-400 bg-red-50 p-2 mb-4 text-xs">
          <strong>NCR raised:</strong> {form.ncr_reference || "No reference provided"}
        </div>
      )}

      {/* Signatures */}
      <div className="mt-6 grid grid-cols-2 gap-4 text-xs">
        <div className="border-t-2 border-[#1F2A33] pt-2">
          <div className="text-[10px] uppercase tracking-wider font-bold text-gray-600">Checked By</div>
          <div className="mt-2 min-h-[40px]">{form.checked_by_user_id || "____________________"}</div>
        </div>
        <div className="border-t-2 border-[#1F2A33] pt-2">
          <div className="text-[10px] uppercase tracking-wider font-bold text-gray-600">Checked By QA</div>
          <div className="mt-2 min-h-[40px]">{form.checked_by_qa_user_id || "____________________"}</div>
        </div>
      </div>

      {form.status === "signed" && (
        <div className="mt-4 p-3 bg-green-50 border border-green-300 rounded text-xs">
          <strong>✓ Signed</strong> by user <code>{form.signed_by_user_id}</code> on{" "}
          <strong>{form.signed_at ? new Date(form.signed_at).toLocaleString("en-AU", {timeZone:"Australia/Sydney"}) : "—"}</strong> AEST
        </div>
      )}

      {/* Footer */}
      <div className="mt-8 pt-3 border-t border-gray-300 flex justify-between text-[9px] text-gray-500">
        <span>{title}</span>
        <span>Generated {new Date().toLocaleDateString("en-AU")} · Paneltec Group</span>
      </div>
    </div>
  );
}
