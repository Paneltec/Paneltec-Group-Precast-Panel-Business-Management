import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Plus, X, ChevronDown, FolderPlus } from "lucide-react";
import { api, formatApiErrorDetail } from "../lib/api";
import { useAuth } from "../contexts/AuthContext";
import { Input } from "./ui/input";
import { toast } from "sonner";

/**
 * ProjectCombobox — typable combobox with "Create new" affordance for the Quote form.
 *
 * Props:
 *   projects       : current list of projects for the customer (array of { id, project_name, code? })
 *   selectedId     : currently-selected project id (or "" for none)
 *   onSelect(id, project?)  : called with new project id (or "" to clear)
 *   customerId     : the customer this project belongs to; when falsy, Create is disabled
 *   onCreated(project)      : called after a fresh project is POSTed so the parent list can grow
 *   disabled       : outer disabled flag (e.g. when no customer chosen yet)
 */
export default function ProjectCombobox({ projects, selectedId, onSelect, customerId, onCreated, disabled }) {
  const { hasPerm } = useAuth();
  const canCreate = hasPerm("projects.create");
  const wrapperRef = useRef(null);
  const inputRef = useRef(null);
  const [open, setOpen]     = useState(false);
  const [query, setQuery]   = useState("");
  const [creating, setCreating] = useState(false);
  // "dirty" = user has edited the field since the selected project's name last matched
  const [dirty, setDirty] = useState(false);

  const selected = useMemo(() => projects.find(p => p.id === selectedId) || null, [projects, selectedId]);
  // Sync the display value with the selected project unless the user is actively editing
  useEffect(() => { if (!dirty) setQuery(selected?.project_name || ""); }, [selected, dirty]);

  // Fuzzy match on project_name or code (case-insensitive)
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter(p =>
      (p.project_name || "").toLowerCase().includes(q) ||
      (p.code || "").toLowerCase().includes(q)
    );
  }, [projects, query]);

  const trimmed = query.trim();
  const showCreateOption = trimmed &&
    !matches.some(p => (p.project_name || "").toLowerCase() === trimmed.toLowerCase());

  // Close on outside click
  useEffect(() => {
    const handler = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false);
        // If the user typed something but didn't confirm, snap back to the selection
        setDirty(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const pick = (project) => {
    onSelect(project.id, project);
    setQuery(project.project_name);
    setDirty(false);
    setOpen(false);
  };

  const clear = () => {
    onSelect("");
    setQuery("");
    setDirty(false);
    inputRef.current?.focus();
  };

  const createNow = async () => {
    if (!canCreate) { toast.error("Ask an admin to create the project first."); return; }
    if (!customerId) { toast.error("Select a customer first."); return; }
    if (!trimmed) return;
    setCreating(true);
    try {
      const { data } = await api.post("/projects", { customer_id: customerId, project_name: trimmed });
      toast.success(`Project "${data.project_name}" created.`);
      onCreated && onCreated(data);
      pick(data);
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message);
    } finally { setCreating(false); }
  };

  const onKeyDown = (e) => {
    if (e.key === "Escape") { setOpen(false); setDirty(false); return; }
    if (e.key === "Enter") {
      e.preventDefault();
      // If there's an exact match highlight it; else if create is offered, create
      const exact = matches.find(p => (p.project_name || "").toLowerCase() === trimmed.toLowerCase());
      if (exact) pick(exact);
      else if (showCreateOption) createNow();
    }
  };

  return (
    <div ref={wrapperRef} className="relative" data-testid="project-combobox">
      <div className="relative">
        <Input
          ref={inputRef}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setDirty(true); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          disabled={disabled}
          placeholder={disabled ? "Select a customer first" : "Type a project name…"}
          className="h-11 pr-16"
          data-testid="project-combobox-input"
          aria-expanded={open}
          aria-autocomplete="list"
        />
        <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
          {selectedId && (
            <button type="button" onClick={clear} aria-label="Clear project"
                    className="p-1 hover:bg-gray-100 rounded text-gray-500"
                    data-testid="project-combobox-clear">
              <X className="w-4 h-4"/>
            </button>
          )}
          <button type="button" onClick={() => setOpen(o => !o)} aria-label="Toggle project menu"
                  disabled={disabled}
                  className="p-1 hover:bg-gray-100 rounded text-gray-500 disabled:opacity-40">
            <ChevronDown className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`}/>
          </button>
        </div>
      </div>

      {open && !disabled && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded shadow-lg max-h-72 overflow-y-auto"
             data-testid="project-combobox-menu">
          {matches.length === 0 && !showCreateOption && (
            <div className="px-3 py-2 text-sm text-gray-500 italic">No matching projects.</div>
          )}
          {matches.map(p => (
            <button key={p.id} type="button" onClick={() => pick(p)}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-yellow-50 border-l-2 ${p.id === selectedId ? "border-l-[#F5C518] bg-yellow-50/40" : "border-l-transparent"}`}
                    data-testid={`project-combobox-item-${p.id}`}>
              <div className="font-medium text-[#1F2A33]">{p.project_name}</div>
              {(p.code || p.status) && (
                <div className="text-[11px] text-gray-500 flex items-center gap-2 mt-0.5">
                  {p.code && <span className="font-mono">{p.code}</span>}
                  {p.status && <span className="uppercase tracking-wider">{p.status}</span>}
                </div>
              )}
            </button>
          ))}
          {showCreateOption && (
            <button
              type="button" onClick={createNow}
              disabled={creating || !customerId || !canCreate}
              className="w-full text-left px-3 py-2 text-sm border-t border-gray-200 hover:bg-emerald-50 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              title={!customerId ? "Select a customer first" : (!canCreate ? "Ask an admin to create the project first" : `Create project "${trimmed}"`)}
              data-testid="project-combobox-create">
              {creating
                ? <Loader2 className="w-4 h-4 animate-spin text-emerald-600"/>
                : <FolderPlus className="w-4 h-4 text-emerald-600"/>}
              <span>
                Create <span className="font-semibold text-[#1F2A33]">&ldquo;{trimmed}&rdquo;</span>
              </span>
              {!canCreate && <span className="ml-auto text-[10px] uppercase tracking-wider text-red-500">no perm</span>}
              {!customerId && canCreate && <span className="ml-auto text-[10px] uppercase tracking-wider text-amber-600">pick customer</span>}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
