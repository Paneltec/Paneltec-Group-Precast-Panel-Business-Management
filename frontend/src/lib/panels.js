// Shared helpers for the Panels register (shapes are in millimetres, origin bottom-left).
import { api } from "./api";

export const REINFORCEMENT_OPTIONS = [
  { key: "none", label: "None (plain concrete)" },
  { key: "light", label: "Light" },
  { key: "standard", label: "Standard" },
  { key: "heavy", label: "Heavy" },
  { key: "prestressed", label: "Prestressed" },
];

export const LIFTING_STATUS = {
  recorded: { label: "Lifting recorded", cls: "bg-green-100 text-green-800" },
  incomplete: { label: "Engineer details missing", cls: "bg-amber-100 text-amber-800" },
  missing: { label: "No lifting design", cls: "bg-red-100 text-red-700" },
};

const num = (v) => Number.parseFloat(v);

// Is this polygon an axis-aligned rectangle? Returns {x, y, w, h} or null.
export function asRect(poly) {
  if (!Array.isArray(poly) || poly.length !== 4) return null;
  const xs = [...new Set(poly.map((p) => num(p[0])))];
  const ys = [...new Set(poly.map((p) => num(p[1])))];
  if (xs.length !== 2 || ys.length !== 2) return null;
  // every point must be a corner of the bounding box, and edges must alternate x/y
  for (let i = 0; i < 4; i++) {
    const a = poly[i], b = poly[(i + 1) % 4];
    if (num(a[0]) !== num(b[0]) && num(a[1]) !== num(b[1])) return null;
  }
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

export function rectToPoly({ x, y, w, h }) {
  const X = num(x) || 0, Y = num(y) || 0, W = num(w) || 0, H = num(h) || 0;
  return [[X, Y], [X + W, Y], [X + W, Y + H], [X, Y + H]];
}

export const fmtMm = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return Math.abs(v - Math.round(v)) < 0.05 ? String(Math.round(v)) : v.toFixed(1);
};

export const fmtT = (kg) => `${(Number(kg || 0) / 1000).toFixed(2)} t`;

// Fetch a PDF with a POST body and open it in a new tab (falls back to download).
export async function openPostedPdf(path, body, filename = "preview.pdf") {
  const res = await api.post(path, body, { responseType: "blob" });
  const url = URL.createObjectURL(new Blob([res.data], { type: "application/pdf" }));
  const w = window.open(url, "_blank");
  if (!w) {
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
  }
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// Download any file (e.g. DXF) from an authenticated GET endpoint.
export async function downloadFile(path, fallbackName) {
  const res = await api.get(path, { responseType: "blob" });
  const cd = res.headers?.["content-disposition"] || "";
  const m = /filename="?([^"]+)"?/i.exec(cd);
  const url = URL.createObjectURL(res.data);
  const a = document.createElement("a");
  a.href = url; a.download = m ? m[1] : fallbackName;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
