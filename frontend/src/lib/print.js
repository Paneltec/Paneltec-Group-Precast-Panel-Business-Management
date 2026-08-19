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

// Opens a PDF inline in a new browser tab. Fetches the PDF via authenticated
// axios (so the JWT is attached by the interceptor), wraps as a blob, then
// window.open()s a blob: URL. Browsers with a built-in PDF viewer will render
// it inline; users can print / save from that viewer.
//
// Returns `{ url, blocked }`. If `blocked` is true, the caller receives a
// downloaded copy of the PDF instead (fallback), and should surface a toast
// telling the user to allow popups.
export async function openPdf(path, fallbackFilename = "paneltec.pdf") {
  const res = await api.get(path, { responseType: "blob" });
  const blob = new Blob([res.data], { type: "application/pdf" });
  const cd = res.headers?.["content-disposition"] || "";
  const m = /filename="?([^"]+)"?/i.exec(cd);
  const filename = m ? m[1] : fallbackFilename;
  const url = URL.createObjectURL(blob);
  const w = window.open(url, "_blank");
  if (!w) {
    // Popup blocked — download instead so the user still gets the PDF.
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return { url, filename, blocked: true };
  }
  // Some browsers preserve document.title as the suggested filename hint when
  // the user hits Save from the viewer. Best-effort; ignore cross-origin errors.
  try {
    w.addEventListener?.("load", () => { try { w.document.title = filename; } catch (_e2) { /* cross-origin */ } });
  } catch (_e) { /* addEventListener unavailable */ }
  // Delay revocation so the new tab has time to load the blob URL.
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return { url, filename, blocked: false };
}

