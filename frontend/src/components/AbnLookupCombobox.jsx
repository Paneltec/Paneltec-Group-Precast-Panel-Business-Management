import { useEffect, useRef, useState } from "react";
import { Loader2, ChevronDown, Building2, CheckCircle2, X } from "lucide-react";
import { api, formatApiErrorDetail } from "../lib/api";
import { Input } from "./ui/input";

/**
 * AbnLookupCombobox — typable customer/company name field with live ABR lookup.
 *
 * Props:
 *   value            — current company_name string
 *   onChange(name)   — called on every keystroke
 *   onPick(match)    — called when the user selects an ABR result
 *                      { abn, entity_name, gst_registered, state, postcode }
 *   placeholder, disabled, className, dataTestId
 */
export default function AbnLookupCombobox({ value, onChange, onPick,
    placeholder = "Company / business name", disabled, className = "", dataTestId }) {
  const wrapperRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState([]);
  const [configured, setConfigured] = useState(true);
  const [message, setMessage] = useState("");

  // Debounced search
  useEffect(() => {
    const q = (value || "").trim();
    if (!q || q.length < 2 || disabled) { setResults([]); setMessage(""); return; }
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const { data } = await api.get("/abn-lookup", { params: { q } });
        setConfigured(!!data.configured);
        setResults(data.results || []);
        setMessage(data.message || "");
        setOpen(true);
      } catch (e) {
        setResults([]);
        setMessage(formatApiErrorDetail(e.response?.data?.detail) || e.message);
        setConfigured(true);
      } finally { setLoading(false); }
    }, 400);
    return () => clearTimeout(timer);
  }, [value, disabled]);

  // Click-outside to close
  useEffect(() => {
    const h = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const pick = (r) => {
    onPick?.(r);
    onChange?.(r.entity_name);
    setOpen(false);
  };

  return (
    <div ref={wrapperRef} className={`relative ${className}`}>
      <div className="relative">
        <Input
          value={value || ""}
          onChange={e => { onChange?.(e.target.value); setOpen(true); }}
          onFocus={() => { if (results.length > 0 || message) setOpen(true); }}
          placeholder={placeholder}
          disabled={disabled}
          className="pr-16"
          data-testid={dataTestId || "abn-lookup-input"}
        />
        <div className="absolute inset-y-0 right-2 flex items-center gap-1 pointer-events-none text-gray-400">
          {loading ? <Loader2 className="w-4 h-4 animate-spin"/> : <ChevronDown className="w-4 h-4"/>}
        </div>
      </div>
      {!configured && (
        <div className="mt-1 text-[10px] text-gray-500 italic" data-testid="abn-not-configured">
          {message || "ABN lookup not configured — set ABR_LOOKUP_GUID env var."}
        </div>
      )}
      {open && configured && results.length > 0 && (
        <div className="absolute z-30 mt-1 w-full bg-white border border-gray-200 rounded shadow-lg max-h-80 overflow-y-auto"
             data-testid="abn-lookup-results">
          {results.map((r, i) => (
            <button type="button" key={`${r.abn}-${i}`}
              onClick={() => pick(r)}
              className="w-full text-left px-3 py-2 hover:bg-[#FFFBEA] border-b border-gray-100 last:border-b-0
                         flex items-start gap-2"
              data-testid={`abn-result-${i}`}>
              <Building2 className="w-4 h-4 text-[#3A6B8C] mt-0.5 shrink-0"/>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-[#1F2A33] truncate">{r.entity_name}</div>
                <div className="text-[10px] text-gray-500 flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                  <span className="font-mono">ABN {r.abn}</span>
                  {r.gst_registered
                    ? <span className="text-[#059669] font-semibold inline-flex items-center gap-0.5"><CheckCircle2 className="w-3 h-3"/> GST</span>
                    : <span className="text-gray-400 inline-flex items-center gap-0.5"><X className="w-3 h-3"/> No GST</span>}
                  {r.state && <span>{r.state} {r.postcode}</span>}
                  {r.entity_type && <span className="text-gray-400">· {r.entity_type}</span>}
                </div>
              </div>
            </button>
          ))}
          <div className="px-3 py-2 bg-[#F5F6F7] text-[10px] italic text-gray-500">
            Or keep typing to use the entered name as a new customer.
          </div>
        </div>
      )}
    </div>
  );
}
