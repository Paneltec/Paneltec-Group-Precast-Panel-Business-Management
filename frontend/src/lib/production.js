// Shared bits for production tracking (panel units, schedule, yard, loads).

export const UNIT_STATUS_ORDER = ["planned", "cast", "stripped", "in_yard", "loaded", "delivered", "installed"];

export const UNIT_STATUS = {
  planned:   { label: "Planned",   cls: "bg-gray-100 text-gray-700",     dot: "#9AA5AE" },
  cast:      { label: "Cast",      cls: "bg-blue-100 text-blue-800",     dot: "#3A6B8C" },
  stripped:  { label: "Stripped",  cls: "bg-sky-100 text-sky-800",       dot: "#0EA5E9" },
  in_yard:   { label: "In yard",   cls: "bg-amber-100 text-amber-800",   dot: "#F5C518" },
  loaded:    { label: "Loaded",    cls: "bg-orange-100 text-orange-800", dot: "#F97316" },
  delivered: { label: "Delivered", cls: "bg-cyan-100 text-cyan-800",     dot: "#06B6D4" },
  installed: { label: "Installed", cls: "bg-green-100 text-green-800",   dot: "#16A34A" },
  rejected:  { label: "Rejected",  cls: "bg-red-100 text-red-700",       dot: "#C0392B" },
};

export const ACTION_VERB = {
  cast: "Mark as cast", stripped: "Mark as stripped", in_yard: "Move to yard",
  loaded: "Mark as loaded", delivered: "Mark as delivered", installed: "Mark as installed",
};

export const LOAD_STATUS = {
  planned:   { label: "Planned",   cls: "bg-gray-100 text-gray-700" },
  loaded:    { label: "Loaded",    cls: "bg-orange-100 text-orange-800" },
  delivered: { label: "Delivered", cls: "bg-green-100 text-green-800" },
};

export const fmtT = (kg) => `${(Number(kg || 0) / 1000).toFixed(2)} t`;
export const fmtDay = (iso) => {
  if (!iso) return "—";
  try {
    return new Date(iso.length === 10 ? iso + "T12:00:00" : iso).toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric" });
  } catch (_e) { return iso; }
};
export const fmtWhen = (iso) => {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-AU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch (_e) { return iso; }
};
export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
export const addDays = (iso, n) => {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
export const mondayOf = (iso) => {
  const d = new Date(iso + "T12:00:00");
  const day = (d.getDay() + 6) % 7;   // Monday = 0
  return addDays(iso, -day);
};

export function StatusChip({ status, className = "" }) {
  const s = UNIT_STATUS[status] || UNIT_STATUS.planned;
  return <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded whitespace-nowrap ${s.cls} ${className}`}>{s.label}</span>;
}

// Compact "2 cast · 1 in yard" summary for a panel mark.
export function unitSummary(counts) {
  if (!counts) return "";
  return UNIT_STATUS_ORDER.concat(["rejected"]).filter((k) => counts[k]).map((k) => `${counts[k]} ${UNIT_STATUS[k].label.toLowerCase()}`).join(" · ");
}
