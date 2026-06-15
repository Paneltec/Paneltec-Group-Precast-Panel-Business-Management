import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import manualMd from "../content/user-manual.md";

const stripHtmlComments = (md) => md.replace(/<!--[\s\S]*?-->/g, "");

export default function HelpPrint() {
  const [md, setMd] = useState("");
  useEffect(() => {
    fetch(manualMd).then((r) => r.text()).then((t) => { setMd(stripHtmlComments(t)); setTimeout(() => window.print(), 800); });
  }, []);
  return (
    <div className="max-w-3xl mx-auto p-8 bg-white text-[#1F2A33]" data-testid="help-print-page">
      <style>{`
        .manual-cover-wrap {
          width: 100%;
          margin-bottom: 24px;
          background: #1F2A33;
          border-radius: 8px;
          overflow: hidden;
          aspect-ratio: 3 / 2;
          max-height: 260px;
        }
        .manual-cover-wrap img {
          width: 100%; height: 100%;
          object-fit: contain; display: block;
        }
        @supports not (aspect-ratio: 3 / 2) {
          .manual-cover-wrap { padding-top: 66.6%; position: relative; height: 0; }
          .manual-cover-wrap img { position: absolute; inset: 0; }
        }
        @media print {
          .manual-cover-wrap { max-height: 220px !important; }
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
        <ReactMarkdown>{md}</ReactMarkdown>
      </article>
    </div>
  );
}
