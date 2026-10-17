import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Loader2, ArrowLeft, MapPin, Truck, FileText, QrCode } from "lucide-react";
import { Toaster, toast } from "sonner";
import { api, formatApiErrorDetail } from "../lib/api";
import { openPdf } from "../lib/print";
import { StatusChip, UNIT_STATUS, UNIT_STATUS_ORDER, fmtT, fmtWhen, fmtDay } from "../lib/production";
import { fmtMm } from "../lib/panels";
import { useAuth } from "../contexts/AuthContext";
import UnitActions from "../components/UnitActions";
import { Button } from "../components/ui/button";

// One physical panel. Reached by scanning its QR code (/scan/:token) or from
// the app (/units/:id). Laid out for a phone first.
export default function UnitPage() {
  const { token, id } = useParams();
  const { hasPerm } = useAuth();
  const [unit, setUnit] = useState(null);
  const [err, setErr] = useState("");
  const [qr, setQr] = useState("");

  useEffect(() => {
    const path = token ? `/scan/${token}` : `/units/${id}`;
    api.get(path).then((r) => setUnit(r.data)).catch((e) => setErr(formatApiErrorDetail(e.response?.data?.detail)));
  }, [token, id]);

  useEffect(() => {
    if (!unit) return;
    api.get(`/units/${unit.id}/qr.svg`, { responseType: "text" }).then((r) => setQr(r.data)).catch(() => {});
  }, [unit?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (err) return <div className="max-w-xl mx-auto p-6 text-center"><div className="text-lg font-bold text-red-700">{err}</div><Link to="/production" className="text-[#3A6B8C] underline text-sm">Go to production</Link></div>;
  if (!unit) return <div className="flex items-center gap-2 text-gray-500 text-sm p-6"><Loader2 className="w-4 h-4 animate-spin" /> Loading panel…</div>;

  const idx = UNIT_STATUS_ORDER.indexOf(unit.status);
  const d = unit.dims || {};
  const lifting = unit.panel?.lifting_status === "recorded";

  return (
    <div className="max-w-3xl mx-auto space-y-4" data-testid="unit-page">
      <Toaster richColors position="top-center" />
      <div>
        <Link to={`/jobs/${unit.job_id}`} className="inline-flex items-center text-xs uppercase tracking-wider text-[#3A6B8C] font-bold hover:text-[#1F2A33]"><ArrowLeft className="w-3 h-3 mr-1" /> Job {unit.job?.job_number}</Link>
        <div className="flex items-start justify-between gap-3 mt-1">
          <div>
            <h1 className="text-4xl font-black tracking-tighter text-[#1F2A33]" data-testid="unit-label">{unit.label}</h1>
            <div className="text-sm text-gray-600">{unit.job?.project_name || unit.job?.customer_name}{unit.panel?.description ? ` · ${unit.panel.description}` : ""}</div>
          </div>
          <StatusChip status={unit.status} className="text-xs px-3 py-1.5" />
        </div>
      </div>

      {/* progress */}
      <div className="bg-white border border-gray-200 rounded p-4">
        <div className="flex items-center gap-1" data-testid="unit-progress">
          {UNIT_STATUS_ORDER.map((s, i) => (
            <div key={s} className="flex-1 flex flex-col items-center gap-1 min-w-0">
              <div className={`h-2 w-full rounded ${unit.status === "rejected" ? "bg-red-200" : i <= idx ? "bg-[#3A6B8C]" : "bg-gray-200"}`} />
              <div className={`text-[9px] uppercase tracking-wider truncate ${i === idx ? "font-bold text-[#1F2A33]" : "text-gray-400"}`}>{UNIT_STATUS[s].label}</div>
            </div>
          ))}
        </div>
        {unit.status === "rejected" && <div className="mt-3 text-sm text-red-700 font-semibold">Rejected: {unit.rejected_reason}</div>}
        {unit.open_defects > 0 && <div className="mt-3 text-sm text-amber-800 font-semibold">{unit.open_defects} open defect{unit.open_defects === 1 ? "" : "s"}</div>}
      </div>

      <div className="bg-white border border-gray-200 rounded p-4">
        <UnitActions unit={unit} onChange={setUnit} big />
      </div>

      {/* facts */}
      <div className="bg-white border border-gray-200 rounded p-4 grid grid-cols-2 gap-3 text-sm">
        <Fact label="Size (W × H × T)" value={`${fmtMm(d.width_mm)} × ${fmtMm(d.height_mm)} × ${fmtMm(d.thickness_mm)} mm`} />
        <Fact label="Est. mass" value={fmtT(d.weight_kg)} />
        <Fact label="Concrete" value={unit.panel?.concrete_grade || "—"} />
        <Fact label="Revision" value={unit.panel?.revision || "A"} />
        <Fact label="Lifting design" value={lifting ? "Recorded" : "NOT RECEIVED — DO NOT LIFT"} warn={!lifting} />
        <Fact label="Erection sequence" value={unit.erection_seq ?? "—"} />
        <Fact label="Planned cast" value={unit.planned_cast_date ? `${fmtDay(unit.planned_cast_date)}${unit.bed_name ? ` · ${unit.bed_name}` : ""}` : "—"} />
        <Fact label="Cast" value={unit.cast_at ? fmtDay(unit.cast_at) : "—"} />
        <Fact label="Yard location" value={unit.yard_location || "—"} icon={<MapPin className="w-3 h-3" />} />
        <Fact label="Load" value={unit.load ? `${unit.load.docket_number} · ${fmtDay(unit.load.delivery_date)}` : "—"} icon={<Truck className="w-3 h-3" />} link={unit.load ? `/loads/${unit.load.id}` : null} />
      </div>

      {unit.pour && (unit.pour.supplier || unit.pour.docket_no || unit.pour.cylinder_ids) && (
        <div className="bg-white border border-gray-200 rounded p-4 text-sm">
          <h2 className="text-xs font-bold uppercase tracking-[0.15em] text-[#3A6B8C] mb-2">Pour log</h2>
          <div className="grid grid-cols-2 gap-2">
            <Fact label="Supplier" value={unit.pour.supplier || "—"} /><Fact label="Docket" value={unit.pour.docket_no || "—"} />
            <Fact label="Batch" value={unit.pour.batch_no || "—"} /><Fact label="Grade" value={unit.pour.concrete_grade || "—"} />
            <Fact label="Slump" value={unit.pour.slump_mm != null ? `${unit.pour.slump_mm} mm` : "—"} /><Fact label="Poured" value={unit.pour.poured_m3 != null ? `${unit.pour.poured_m3} m³` : "—"} />
            <div className="col-span-2"><Fact label="Cylinders" value={unit.pour.cylinder_ids || "—"} /></div>
          </div>
        </div>
      )}

      {(unit.defects || []).length > 0 && (
        <div className="bg-white border border-gray-200 rounded p-4 text-sm">
          <h2 className="text-xs font-bold uppercase tracking-[0.15em] text-[#3A6B8C] mb-2">Defects</h2>
          <ul className="space-y-2">
            {unit.defects.map((df) => (
              <li key={df.id} className={`border rounded p-2 ${df.status === "open" ? "border-amber-300 bg-amber-50" : "border-gray-200"}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{df.description}</span>
                  <span className="text-[10px] uppercase tracking-wider font-bold">{df.severity} · {df.status}</span>
                </div>
                <div className="text-xs text-gray-500">{df.by_name} · {fmtWhen(df.created_at)}{df.repair_notes ? ` · ${df.repair_notes}` : ""}</div>
                {df.status === "open" && hasPerm("production.transition") && (
                  <div className="flex gap-2 mt-2">
                    <Button size="sm" variant="outline" className="h-8" onClick={() => patchDefect(unit, df, "repaired", setUnit)}>Mark repaired</Button>
                    <Button size="sm" variant="outline" className="h-8" onClick={() => patchDefect(unit, df, "accepted", setUnit)}>Accept as is</Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {(unit.photos || []).length > 0 && (
        <div className="bg-white border border-gray-200 rounded p-4">
          <h2 className="text-xs font-bold uppercase tracking-[0.15em] text-[#3A6B8C] mb-2">Photos</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {unit.photos.map((p) => (
              <a key={p.id} href={p.url} target="_blank" rel="noreferrer" className="block border rounded overflow-hidden">
                <img src={p.url} alt={p.caption || p.filename} className="w-full h-28 object-cover bg-gray-100" />
                <div className="text-[11px] p-1 text-gray-600 truncate">{p.caption || UNIT_STATUS[p.status_at_time]?.label} · {fmtWhen(p.at)}</div>
              </a>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded p-4 text-sm">
        <h2 className="text-xs font-bold uppercase tracking-[0.15em] text-[#3A6B8C] mb-2">History</h2>
        {(unit.status_history || []).length === 0 ? <div className="text-gray-500">No steps recorded yet.</div> : (
          <ol className="space-y-1">
            {[...unit.status_history].reverse().map((h, i) => (
              <li key={i} className="flex flex-wrap gap-x-2 text-gray-700">
                <span className="tabular-nums text-gray-500 w-32">{fmtWhen(h.at)}</span>
                <span><StatusChip status={h.to} /> {h.source === "revert" ? "(undo)" : h.source === "load" ? "(via load)" : ""}</span>
                <span className="text-gray-500">{h.by_user?.name || h.by_user?.email || ""}{h.note ? ` — ${h.note}` : ""}</span>
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" className="h-10" onClick={() => openPdf(`/panels/${unit.panel_id}/shop-drawing.pdf`, `shop_drawing_${unit.mark}.pdf`).catch((e) => toast.error(formatApiErrorDetail(e.response?.data?.detail)))}>
          <FileText className="w-4 h-4 mr-2" /> Shop drawing
        </Button>
        <Link to={`/panels/${unit.panel_id}`}><Button variant="outline" className="h-10">Panel {unit.mark} details</Button></Link>
        {qr && (
          <details className="w-full">
            <summary className="cursor-pointer text-sm text-[#3A6B8C] inline-flex items-center gap-1"><QrCode className="w-4 h-4" /> Show QR code</summary>
            <div className="w-40 mt-2 border rounded p-2 bg-white" dangerouslySetInnerHTML={{ __html: qr }} />
          </details>
        )}
      </div>
    </div>
  );
}

async function patchDefect(unit, df, status, setUnit) {
  try {
    const { data } = await api.patch(`/units/${unit.id}/defects/${df.id}`, { status });
    setUnit(data); toast.success(`Defect ${status}`);
  } catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail)); }
}

function Fact({ label, value, warn, icon, link }) {
  const inner = <span className={`font-semibold ${warn ? "text-red-700" : "text-[#1F2A33]"}`}>{value}</span>;
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-gray-500 font-bold inline-flex items-center gap-1">{icon}{label}</div>
      <div>{link ? <Link to={link} className="underline decoration-dotted">{inner}</Link> : inner}</div>
    </div>
  );
}
