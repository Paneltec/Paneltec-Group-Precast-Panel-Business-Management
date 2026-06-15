import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import manualMd from "../content/user-manual.md";

export default function HelpPrint() {
  const [md, setMd] = useState("");
  useEffect(() => {
    fetch(manualMd).then((r) => r.text()).then((t) => { setMd(t); setTimeout(() => window.print(), 600); });
  }, []);
  return (
    <div className="max-w-3xl mx-auto p-8 bg-white text-[#1F2A33]" data-testid="help-print-page">
      <h1 className="text-3xl font-black mb-2">Paneltec Group — User Manual</h1>
      <p className="text-xs text-gray-500 mb-6">Printed from the in-app manual.</p>
      <article className="prose">
        <ReactMarkdown>{md}</ReactMarkdown>
      </article>
    </div>
  );
}
