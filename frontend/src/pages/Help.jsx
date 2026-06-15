import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Search, Printer, BookOpen } from "lucide-react";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { openPrintPopup } from "../lib/print";
import manualMd from "../content/user-manual.md";

const APP_VERSION = "v1.0 · Phase 7";

const slugify = (s) =>
  String(s).toLowerCase().trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");

function buildToc(md) {
  const toc = [];
  md.split("\n").forEach((line) => {
    const h2 = /^##\s+(.+)/.exec(line);
    const h3 = /^###\s+(.+)/.exec(line);
    if (h2) toc.push({ level: 2, text: h2[1].trim(), id: slugify(h2[1]) });
    else if (h3) toc.push({ level: 3, text: h3[1].trim(), id: slugify(h3[1]) });
  });
  return toc;
}

function HighlightText({ text, q }) {
  if (!q) return text;
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-[#F5C518]/60 text-[#1F2A33] rounded px-0.5">{text.slice(idx, idx + q.length)}</mark>
      {text.slice(idx + q.length)}
    </>
  );
}

export default function Help() {
  const [md, setMd] = useState("");
  const [query, setQuery] = useState("");
  const contentRef = useRef(null);

  useEffect(() => {
    // react-markdown receives raw text, but Webpack's default md loader returns a URL; fetch it.
    fetch(manualMd).then((r) => r.text()).then(setMd).catch(() => setMd("# Could not load manual."));
  }, []);

  const toc = useMemo(() => buildToc(md), [md]);

  const scrollTo = (id) => {
    const el = contentRef.current?.querySelector(`[id="${id}"]`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const renderers = useMemo(() => {
    const stringify = (children) => {
      if (children == null) return "";
      if (typeof children === "string") return children;
      if (Array.isArray(children)) return children.map(stringify).join("");
      if (children.props?.children) return stringify(children.props.children);
      return "";
    };
    return ({
      h1: ({ children }) => <h1 className="text-3xl md:text-4xl font-black tracking-tighter text-[#1F2A33] mb-4">{children}</h1>,
      h2: ({ children }) => {
        const text = stringify(children);
        return <h2 id={slugify(text)} className="text-2xl font-black text-[#1F2A33] tracking-tight mt-10 mb-3 scroll-mt-6">{<HighlightText text={text} q={query} />}</h2>;
      },
      h3: ({ children }) => {
        const text = stringify(children);
        return <h3 id={slugify(text)} className="text-lg font-bold text-[#3A6B8C] tracking-tight mt-6 mb-2 scroll-mt-6">{<HighlightText text={text} q={query} />}</h3>;
      },
      h4: ({ children }) => <h4 className="text-base font-bold text-[#1F2A33] mt-4 mb-1.5">{children}</h4>,
      p: ({ children }) => {
        const arr = Array.isArray(children) ? children : [children];
        return <p className="text-sm text-gray-700 leading-7 mb-3">
          {arr.map((c, i) => typeof c === "string" ? <HighlightText key={i} text={c} q={query}/> : c)}
        </p>;
      },
      li: ({ children }) => {
        const arr = Array.isArray(children) ? children : [children];
        return <li className="text-sm text-gray-700 leading-6 ml-5 list-disc mb-1">
          {arr.map((c, i) => typeof c === "string" ? <HighlightText key={i} text={c} q={query}/> : c)}
        </li>;
      },
      table: ({ children }) => <div className="overflow-x-auto my-4"><table className="w-full text-sm border border-gray-200 rounded">{children}</table></div>,
      thead: ({ children }) => <thead className="bg-[#3A6B8C] text-white text-[10px] uppercase tracking-wider">{children}</thead>,
      th: ({ children }) => <th className="px-3 py-2 text-left">{children}</th>,
      td: ({ children }) => <td className="px-3 py-2 border-t border-gray-200">{children}</td>,
      code: ({ inline, children }) => inline
        ? <code className="bg-gray-100 text-[#1F2A33] px-1 rounded text-[12px] font-mono">{children}</code>
        : <code className="block bg-gray-50 border border-gray-200 rounded p-3 text-xs font-mono overflow-x-auto">{children}</code>,
      a: ({ href, children }) => <a href={href} className="text-[#3A6B8C] hover:text-[#1F2A33] underline">{children}</a>,
      hr: () => <hr className="my-8 border-gray-200"/>,
      strong: ({ children }) => <strong className="font-bold text-[#1F2A33]">{children}</strong>,
    });
  }, [query]);

  return (
    <div className="max-w-7xl" data-testid="help-page">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-6">
        <div>
          <div className="overline">Help &amp; Documentation</div>
          <h1 className="text-3xl md:text-4xl font-black tracking-tighter text-[#1F2A33] inline-flex items-center gap-2">
            <BookOpen className="w-8 h-8 text-[#3A6B8C]"/> User Manual
          </h1>
          <p className="text-sm text-gray-500 mt-1">{APP_VERSION} — your single source of truth for everything the app does.</p>
        </div>
        <div className="flex gap-2 items-center">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/>
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search manual…"
                   className="pl-9 h-10 w-56" data-testid="help-search"/>
          </div>
          <Button onClick={() => openPrintPopup("/help/print")} variant="outline" data-testid="help-print-btn">
            <Printer className="w-4 h-4 mr-2"/> Print Manual
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <nav className="lg:col-span-3" data-testid="help-toc">
          <div className="lg:sticky lg:top-6 bg-white border border-gray-200 rounded p-4 max-h-[calc(100vh-8rem)] overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider font-bold text-[#3A6B8C] mb-2">Contents</div>
            <ul className="space-y-1">
              {toc.map((t) => (
                <li key={t.id} className={t.level === 3 ? "ml-3" : ""}>
                  <button type="button" onClick={() => scrollTo(t.id)}
                          className={`text-left w-full text-xs hover:text-[#1F2A33] ${t.level === 2 ? "font-bold text-[#1F2A33]" : "text-gray-600"}`}
                          data-testid={`toc-${t.id}`}>
                    {t.text}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </nav>

        <article ref={contentRef} className="lg:col-span-9 bg-white border border-gray-200 rounded p-6 lg:p-10 prose-paneltec"
                 data-testid="help-content">
          {md ? <ReactMarkdown components={renderers}>{md}</ReactMarkdown>
              : <p className="text-sm text-gray-400">Loading manual…</p>}
        </article>
      </div>
    </div>
  );
}
