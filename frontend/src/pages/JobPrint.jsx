import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Loader2, Printer } from "lucide-react";
import { api } from "../lib/api";
import { formatAUD, formatDateTime } from "../lib/format";

export default function JobPrint() {
  const { id } = useParams();
  const [data, setData] = useState(null);

  useEffect(() => {
    (async () => {
      const [{ data: job }, { data: company }, { data: vehResp }, { data: empResp }] = await Promise.all([
        api.get(`/jobs/${id}`),
        api.get(`/settings/company`),
        api.get(`/vehicles`),
        api.get(`/employees`),
      ]);
      const { data: c } = await api.get(`/customers/${job.customer_id}`);
      let project = null;
      if (job.project_id) {
        try { const { data: p } = await api.get(`/projects/${job.project_id}`); project = p; } catch {}
      }
      const vehicle = vehResp.items.find(v => v.id === job.assigned_vehicle_id);
      const crew = empResp.items.filter(e => (job.assigned_employee_ids || []).includes(e.id));
      setData({ job, company, c, project, vehicle, crew });
      setTimeout(() => window.print(), 400);
    })();
  }, [id]);

  if (!data) return <div className="p-8 flex items-center gap-2 text-gray-500"><Loader2 className="w-4 h-4 animate-spin"/> Preparing print…</div>;
  const { job, company, c, project, vehicle, crew } = data;
  const totalPanels = job.line_items.reduce((s, l) => s + l.quantity, 0);
  const totalTonnes = (job.line_items.reduce((s, l) => s + l.total_weight_kg, 0) / 1000).toFixed(3);
  const totalVol = job.line_items.reduce((s, l) => s + l.total_volume_m3, 0).toFixed(3);

  return (
    <div className="min-h-screen bg-white text-black" data-testid="job-print-page">
      <button onClick={() => window.print()} className="no-print fixed top-4 right-4 bg-black text-white text-xs font-bold uppercase tracking-wider px-3 py-2 rounded">
        <Printer className="w-3.5 h-3.5 inline mr-1"/> Print
      </button>
      <div className="max-w-3xl mx-auto p-8 print-container">
        <header className="border-b-4 border-black pb-3 mb-4">
          <div className="flex items-start justify-between">
            <div className="brand-wordmark text-2xl text-black leading-none">PANELTEC GROUP</div>
            <div className="text-right text-xs">
              <div>Job: <span className="font-bold tabular-nums">{job.job_number}</span></div>
              <div>Status: <span className="font-bold uppercase">{job.status.replace(/_/g," ")}</span></div>
              <div>Printed: {formatDateTime(new Date().toISOString())}</div>
            </div>
          </div>
          <h1 className="text-4xl font-black tracking-tighter mt-3 text-center border-y-2 border-black py-2">PRODUCTION SHEET</h1>
        </header>

        <section className="grid grid-cols-2 gap-4 mb-4 text-sm">
          <div>
            <div className="text-[10px] uppercase tracking-wider font-bold">Customer</div>
            <div className="font-bold">{c.company_name}</div>
            <div className="text-xs">{c.contact_name} · {c.contact_phone}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider font-bold">Project</div>
            <div className="font-bold">{project?.project_name || "—"}</div>
            <div className="text-xs">Quote: <span className="tabular-nums">{job.quote_number}</span></div>
          </div>
        </section>

        <section className="border-2 border-black p-3 mb-4">
          <div className="text-[10px] uppercase tracking-wider font-bold">Site / Delivery Address</div>
          <div className="text-xl font-black mt-1">
            {c.site_address?.street}<br/>
            {c.site_address?.suburb} {c.site_address?.state} {c.site_address?.postcode}
          </div>
        </section>

        <section className="grid grid-cols-2 gap-4 mb-4 text-sm">
          <div className="border border-black p-2">
            <div className="text-[10px] uppercase tracking-wider font-bold">Scheduled production</div>
            <div className="text-lg font-bold tabular-nums">{job.scheduled_production_date || "—"}</div>
          </div>
          <div className="border border-black p-2">
            <div className="text-[10px] uppercase tracking-wider font-bold">Scheduled delivery</div>
            <div className="text-lg font-bold tabular-nums">{job.scheduled_delivery_date || "—"}</div>
          </div>
        </section>

        <section className="mb-4">
          <div className="text-[10px] uppercase tracking-wider font-bold mb-1">Panels to produce</div>
          <table className="w-full text-[11px] border-2 border-black">
            <thead className="bg-black text-white uppercase text-[9px] tracking-wider">
              <tr>
                <th className="px-1.5 py-1 text-left">Description</th>
                <th className="px-1.5 py-1 text-left">Type</th>
                <th className="px-1.5 py-1 text-right">L×H×T (m,mm)</th>
                <th className="px-1.5 py-1 text-right">Qty</th>
                <th className="px-1.5 py-1 text-left">Grade</th>
                <th className="px-1.5 py-1 text-left">Finish</th>
                <th className="px-1.5 py-1 text-left">Reinf.</th>
                <th className="px-1.5 py-1 text-right">Vol m³/pnl</th>
                <th className="px-1.5 py-1 text-right">Wt t/pnl</th>
                <th className="px-1.5 py-1 text-right">Total wt t</th>
              </tr>
            </thead>
            <tbody>
              {job.line_items.map(l => (
                <tr key={l.id} className="border-b border-black">
                  <td className="px-1.5 py-1">{l.description || "—"}</td>
                  <td className="px-1.5 py-1">{l.panel_type_label}</td>
                  <td className="px-1.5 py-1 text-right tabular-nums">{l.length_m}×{l.height_m}×{l.thickness_mm}</td>
                  <td className="px-1.5 py-1 text-right font-bold tabular-nums">{l.quantity}</td>
                  <td className="px-1.5 py-1">{l.concrete_grade}</td>
                  <td className="px-1.5 py-1">{l.finish_label}</td>
                  <td className="px-1.5 py-1">{l.reinforcement_label}</td>
                  <td className="px-1.5 py-1 text-right tabular-nums">{l.volume_per_panel_m3.toFixed(3)}</td>
                  <td className="px-1.5 py-1 text-right tabular-nums">{(l.total_weight_per_panel_kg/1000).toFixed(3)}</td>
                  <td className="px-1.5 py-1 text-right tabular-nums font-bold">{(l.total_weight_kg/1000).toFixed(3)}</td>
                </tr>
              ))}
              <tr className="bg-gray-200 font-bold">
                <td className="px-1.5 py-1.5" colSpan={3}>TOTALS</td>
                <td className="px-1.5 py-1.5 text-right tabular-nums">{totalPanels}</td>
                <td className="px-1.5 py-1.5" colSpan={4}></td>
                <td className="px-1.5 py-1.5 text-right tabular-nums">{totalVol} m³</td>
                <td className="px-1.5 py-1.5 text-right tabular-nums">{totalTonnes} t</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section className="grid grid-cols-2 gap-4 mb-4 text-sm">
          <div className="border border-black p-3">
            <div className="text-[10px] uppercase tracking-wider font-bold mb-1">Assigned crew</div>
            {crew.length === 0 ? <div className="text-xs text-gray-700">— None assigned —</div> :
              crew.map(e => (
                <div key={e.id} className="text-xs border-b border-gray-300 py-1 last:border-b-0">
                  <span className="font-bold">{e.name}</span> · {e.role} · <span className="tabular-nums">{e.phone}</span>
                </div>
              ))}
          </div>
          <div className="border border-black p-3">
            <div className="text-[10px] uppercase tracking-wider font-bold mb-1">Assigned vehicle</div>
            {!vehicle ? <div className="text-xs text-gray-700">— None assigned —</div> : (
              <div className="text-xs">
                <div className="font-bold text-base">{vehicle.id} · {vehicle.name}</div>
                <div>Rego: <span className="font-bold tabular-nums">{vehicle.rego}</span></div>
                <div>Capacity: <span className="tabular-nums">{vehicle.capacity_tonnes} t</span></div>
              </div>
            )}
          </div>
        </section>

        {job.production_notes && (
          <section className="mb-3 border border-black p-3 text-sm">
            <div className="text-[10px] uppercase tracking-wider font-bold mb-1">Production notes</div>
            <p className="whitespace-pre-wrap">{job.production_notes}</p>
          </section>
        )}
        {job.delivery_notes && (
          <section className="mb-3 border border-black p-3 text-sm">
            <div className="text-[10px] uppercase tracking-wider font-bold mb-1">Delivery notes</div>
            <p className="whitespace-pre-wrap">{job.delivery_notes}</p>
          </section>
        )}

        <section className="mt-6 border-t-2 border-black pt-3">
          <div className="text-[10px] uppercase tracking-wider font-bold mb-3">Sign-off</div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-4 text-xs">
            {["Produced by","QC Inspected by","Loaded by","Delivered by","Received by (customer signature)","Date"].map(label => (
              <div key={label}>
                <div className="border-b border-black h-6"></div>
                <div className="text-[10px] uppercase tracking-wider mt-1">{label}</div>
              </div>
            ))}
          </div>
        </section>

        <footer className="mt-6 text-[10px] uppercase tracking-wider text-gray-600 border-t pt-2 text-center">
          {company.business_name} · ABN {company.abn || "—"} · {company.phone}
        </footer>
      </div>
    </div>
  );
}
