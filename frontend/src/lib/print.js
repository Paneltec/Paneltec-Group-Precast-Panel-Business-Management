// Opens an entity print route in a small docked popup window.
// Reuses the same window name ("PaneltecPrint") so subsequent clicks
// replace the previous popup instead of stacking new ones.
// Falls back to a new tab if the popup is blocked (window.open returns null).
function _openDockedPopup(url, windowName) {
  try {
    const screen = window.screen || {};
    const availW = screen.availWidth || window.innerWidth || 1280;
    const availH = screen.availHeight || window.innerHeight || 900;
    const w = Math.max(700, Math.floor(availW / 3));
    const h = Math.floor(availH * 0.9);
    const left = Math.max(0, availW - w - 20);
    const top = 20;
    const features = [
      `width=${w}`, `height=${h}`, `left=${left}`, `top=${top}`,
      "menubar=no", "toolbar=no", "location=no", "status=no",
      "scrollbars=yes", "resizable=yes",
    ].join(",");
    const popup = window.open(url, windowName, features);
    if (popup) {
      try { popup.focus(); } catch (_) {}
      return popup;
    }
  } catch (_) {}
  return window.open(url, "_blank");
}

export function openPrintPopup(url) {
  return _openDockedPopup(url, "PaneltecPrint");
}

export function openCustomerPreviewPopup(url) {
  return _openDockedPopup(url, "PaneltecCustomerPreview");
}


// Downloads a PDF from an authenticated backend endpoint.
// Uses the shared axios instance so the JWT bearer token is attached
// via the request interceptor. Falls back to opening in a new tab if
// the browser blocks the download click.
import { api } from "./api";

export async function downloadPdf(path, fallbackFilename = "paneltec.pdf") {
  const res = await api.get(path, { responseType: "blob" });
  const blob = res.data;
  // Extract filename from Content-Disposition if present
  const cd = res.headers?.["content-disposition"] || "";
  const m = /filename="?([^"]+)"?/i.exec(cd);
  const filename = m ? m[1] : fallbackFilename;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser a tick to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return filename;
}
