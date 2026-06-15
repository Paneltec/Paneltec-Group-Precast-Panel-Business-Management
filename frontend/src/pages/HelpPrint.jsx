import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import manualMd from "../content/user-manual.md";
import { ICON_MAP, IconGradientDefs, iconKeyFor, slugify } from "./Help";

const stripHtmlComments = (md) => md.replace(/<!--[\s\S]*?-->/g, "");

const stringify = (children) => {
  if (typeof children === "string") return children;
  if (Array.isArray(children)) return children.map(stringify).join("");
  if (children && typeof children === "object" && children.props) return stringify(children.props.children);
  return "";
};

export default function HelpPrint() {
  const [md, setMd] = useState("");
  useEffect(() => {
    fetch(manualMd).then((r) => r.text()).then((t) => { setMd(stripHtmlComments(t)); setTimeout(() => window.print(), 800); });
  }, []);

  let h2Idx = 0;

  return (
    <div className="max-w-3xl mx-auto p-8 bg-white text-[#1F2A33]" data-testid="help-print-page">
      <IconGradientDefs/>
      <style>{`
        .manual-cover-wrap {
          width: 100%; margin-bottom: 24px;
          background: #1F2A33; border-radius: 8px;
          overflow: hidden; aspect-ratio: 3 / 2; max-height: 260px;
        }
        .manual-cover-wrap img { width: 100%; height: 100%; object-fit: contain; display: block; }
        .manual-section-banner-print {
          width: 100%; aspect-ratio: 3 / 2; max-height: 140px;
          border-radius: 8px; overflow: hidden; margin: 24px 0 12px 0;
          background: #1F2A33;
        }
        .manual-section-banner-print img { width: 100%; height: 100%; object-fit: cover; display: block; }
        @supports not (aspect-ratio: 3 / 2) {
          .manual-cover-wrap { padding-top: 66.6%; position: relative; height: 0; }
          .manual-cover-wrap img { position: absolute; inset: 0; }
          .manual-section-banner-print { padding-top: 66.6%; position: relative; height: 0; }
          .manual-section-banner-print img { position: absolute; inset: 0; }
        }
        @media print {
          .manual-cover-wrap { max-height: 220px !important; }
          .manual-section-banner-print { max-height: 120px !important; }
          h2 { page-break-before: always; }
          h2:first-of-type { page-break-before: auto; }
        }
      `}</style>

      <div className="manual-cover-wrap">
        <img src="/manual/cover.png" alt="Paneltec Group — User Manual"/>
      </div>
      <h1 className="text-3xl font-black mb-2">Paneltec Group — User Manual</h1>
      <p className="text-xs text-gray-500 mb-6">Printed from the in-app manual.</p>

      <article className="prose">
        <ReactMarkdown components={{
          h2: ({ children }) => {
            const text = stringify(children);
            const id = slugify(text);
            const key = iconKeyFor(text);
            const entry = ICON_MAP[key];
            const Icon = entry?.icon;
            const color = entry?.color || "#3A6B8C";
            const banner = entry?.banner;
            const gradId = key ? `grad-${key}` : null;
            const idx = h2Idx++;
            return (
              <>
                {banner && (
                  <div className="manual-section-banner-print">
                    <img src={banner} alt="" aria-hidden="true"/>
                  </div>
                )}
                <div id={id} className="flex items-start gap-2 mt-3 mb-2 pl-3 border-l-4 border-[#F5C518]"
                     style={{ pageBreakBefore: idx > 0 ? "always" : "auto" }}>
                  {Icon && <Icon className="w-6 h-6 shrink-0 mt-0.5" style={{ color, stroke: gradId ? `url(#${gradId})` : color }}/>}
                  <h2 className="text-xl font-black text-[#1F2A33] tracking-tight m-0">{text}</h2>
                </div>
              </>
            );
          },
        }}>{md}</ReactMarkdown>
      </article>
    </div>
  );
}
