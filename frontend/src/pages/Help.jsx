/*
 * Help.jsx — In-app User Manual viewer.
 *
 * DEV REMINDER ▸ Every new phase MUST update src/content/user-manual.md
 *   1. Add/edit content for the new feature
 *   2. Append a change-log entry in §16
 *   3. Bump the "App version" / "Manual last updated" line in §16
 *   4. Bump APP_VERSION below
 * The markdown file is end-user facing — DO NOT add HTML comments or internal notes there.
 * (HTML comments are also defensively stripped before render — see stripHtmlComments.)
 */
import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Search, Printer, BookOpen,
  Home, Rocket, ShieldCheck, Calculator, Users, FolderKanban, FileText, Hammer,
  Receipt, Truck, Settings, History, MousePointerClick, FlaskConical, LifeBuoy,
  GitBranch, BarChart3 } from "lucide-react";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { openPrintPopup } from "../lib/print";
import manualMd from "../content/user-manual.md";

const APP_VERSION = "v1.0 · Phase 8";

// Strip any HTML comments before rendering — the markdown file is end-user facing
// but a stray `<!-- ... -->` here would render as literal text via react-markdown.
const stripHtmlComments = (md) => md.replace(/<!--[\s\S]*?-->/g, "");

const ICON_MAP = {
  welcome:             { icon: Home,               color: "#F5C518" },
  "getting-started":   { icon: Rocket,             color: "#2E7D5B" },
  "roles-permissions": { icon: ShieldCheck,        color: "#3A6B8C" },
  calculator:          { icon: Calculator,         color: "#1F2A33" },
  customers:           { icon: Users,              color: "#7B3F9E" },
  projects:            { icon: FolderKanban,       color: "#C2613A" },
  quotes:              { icon: FileText,           color: "#2C7BB6" },
  jobs:                { icon: Hammer,             color: "#C95F2A" },
  invoices:            { icon: Receipt,            color: "#2E7D5B" },
  "vehicles-employees":{ icon: Truck,              color: "#4A6741" },
  settings:            { icon: Settings,           color: "#566573" },
  "audit-trail":       { icon: History,            color: "#B22F2F" },
  "universal-actions": { icon: MousePointerClick,  color: "#D4318A" },
  mocked:              { icon: FlaskConical,       color: "#B8860B" },
  troubleshooting:     { icon: LifeBuoy,           color: "#B22F2F" },
  "version-changelog": { icon: GitBranch,          color: "#4B4F8C" },
  reports:             { icon: BarChart3,          color: "#2E7D5B" },
};
function iconKeyFor(text) {
  const t = String(text).toLowerCase();
  if (t.includes("welcome")) return "welcome";
  if (t.includes("getting")) return "getting-started";
  if (t.includes("roles") || t.includes("permission")) return "roles-permissions";
  if (t.includes("calculator")) return "calculator";
  if (t.includes("customers") && !t.includes("vehicles")) return "customers";
  if (t.includes("projects")) return "projects";
  if (t.includes("quotes")) return "quotes";
  if (t.includes("jobs")) return "jobs";
  if (t.includes("invoices")) return "invoices";
  if (t.includes("vehicles") || t.includes("employees")) return "vehicles-employees";
  if (t.includes("settings")) return "settings";
  if (t.includes("audit")) return "audit-trail";
  if (t.includes("universal")) return "universal-actions";
  if (t.includes("mocked") || t.includes("what's")) return "mocked";
  if (t.includes("trouble")) return "troubleshooting";
  if (t.includes("version") || t.includes("change log") || t.includes("changelog")) return "version-changelog";
  if (t.includes("reports") || t.includes("data export")) return "reports";
  return null;
}

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
    if (h2) toc.push({ level: 2, text: h2[1].trim(), id: slugify(h2[1]), iconKey: iconKeyFor(h2[1]) });
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
    fetch(manualMd).then((r) => r.text()).then((t) => setMd(stripHtmlComments(t))).catch(() => setMd("# Could not load manual."));
  }, []);

  const toc = useMemo(() => buildToc(md), [md]);

  const scrollTo = (id) => {
    const el = contentRef.current?.querySelector(`[id="${id}"]`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const [activeId, setActiveId] = useState("");

  // Scroll-spy: track which H2 is currently in view
  useEffect(() => {
    if (!md) return;
    const t = setTimeout(() => {
      const els = contentRef.current?.querySelectorAll("h2[id]") || [];
      const obs = new IntersectionObserver((entries) => {
        entries.forEach((e) => { if (e.isIntersecting) setActiveId(e.target.id); });
      }, { rootMargin: "-10% 0px -70% 0px", threshold: 0 });
      els.forEach((el) => obs.observe(el));
      return () => obs.disconnect();
    }, 400);
    return () => clearTimeout(t);
  }, [md]);

  const renderers = useMemo(() => {
    let h2Count = 0;
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
        const id = slugify(text);
        const entry = ICON_MAP[iconKeyFor(text)];
        const Icon = entry?.icon;
        const color = entry?.color || "#3A6B8C";
        const idx = h2Count++;
        return (
          <>
            {idx > 0 && (
              <img src="/manual/divider.png" alt="" aria-hidden="true"
                   className="manual-divider w-full no-print" style={{height:"32px", objectFit:"cover", opacity:0.9, margin:"32px 0"}}/>
            )}
            <div id={id} className="manual-h2 scroll-mt-6 flex items-start gap-3 mt-4 mb-3 pl-3 border-l-4 border-[#F5C518] section-break"
                 style={{ pageBreakBefore: idx > 0 ? "always" : "auto" }}>
              {Icon && <Icon className="w-7 h-7 shrink-0 mt-0.5" style={{ color }}/>}
              <h2 className="text-2xl font-black text-[#1F2A33] tracking-tight">{<HighlightText text={text} q={query} />}</h2>
            </div>
          </>
        );
      },
      h3: ({ children }) => {
        const text = stringify(children);
        return <h3 id={slugify(text)} className="text-lg font-bold text-[#3A6B8C] tracking-tight mt-6 mb-2 pb-2 scroll-mt-6 border-b-2 border-[#3A6B8C]/30">
          {<HighlightText text={text} q={query} />}
        </h3>;
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
      <style>{`
        .manual-cover-wrap {
          width: 100%;
          margin-bottom: 24px;
          background: #1F2A33;
          border-radius: 8px;
          overflow: hidden;
          aspect-ratio: 3 / 2;
          max-height: 360px;
        }
        .manual-cover-wrap img {
          width: 100%;
          height: 100%;
          object-fit: contain;
          display: block;
        }
        @supports not (aspect-ratio: 3 / 2) {
          .manual-cover-wrap { padding-top: 66.6%; position: relative; height: 0; }
          .manual-cover-wrap img { position: absolute; inset: 0; }
        }
      `}</style>
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
              {toc.map((t) => {
                const entry = t.level === 2 ? ICON_MAP[t.iconKey] : null;
                const Icon = entry?.icon;
                const iconColor = entry?.color || "#3A6B8C";
                const isActive = activeId === t.id;
                return (
                  <li key={t.id} className={t.level === 3 ? "ml-5" : ""}>
                    <button type="button" onClick={() => scrollTo(t.id)}
                            className={`text-left w-full text-xs hover:text-[#1F2A33] flex items-center gap-1.5 py-0.5 pl-1.5 ${
                              t.level === 2 ? "font-bold" : ""
                            } ${isActive ? "text-[#3A6B8C] border-l-[3px] border-[#F5C518]" : (t.level === 2 ? "text-[#1F2A33]" : "text-gray-600")}`}
                            data-testid={`toc-${t.id}`}>
                      {Icon && <Icon className="w-4 h-4 shrink-0" style={{ color: iconColor }}/>}
                      <span>{t.text}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </nav>

        <article ref={contentRef} className="lg:col-span-9 bg-white border border-gray-200 rounded p-6 lg:p-10 prose-paneltec"
                 data-testid="help-content">
          <div className="manual-cover-wrap" data-testid="help-cover-wrap">
            <img src="/manual/cover.png" alt="Paneltec Group — User Manual" data-testid="help-cover"/>
          </div>
          {md ? <ReactMarkdown components={renderers}>{md}</ReactMarkdown>
              : <p className="text-sm text-gray-400">Loading manual…</p>}
        </article>
      </div>
    </div>
  );
}
