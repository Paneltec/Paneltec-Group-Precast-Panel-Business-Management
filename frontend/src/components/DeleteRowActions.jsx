import { useEffect, useState } from "react";
import { Trash2, RotateCcw, Skull, Loader2, AlertTriangle } from "lucide-react";
import { api, formatApiErrorDetail } from "../lib/api";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "./ui/dialog";
import { toast } from "sonner";

/**
 * Unified row actions for any business entity supporting soft/hard delete + restore.
 *
 * Props:
 *   entity: "customers" | "projects" | "quotes" | "jobs" | "invoices" | "vehicles" | "employees"
 *   row: the entity object (must have id and is_deleted? deleted_at)
 *   label: function (row) => string identifier (e.g. (q) => q.quote_number)
 *   canDelete: boolean (does the current user hold *.delete permission)
 *   isSuperAdmin: boolean (controls Permanently button visibility)
 *   onChanged: () => void  (refresh parent list)
 */
export default function DeleteRowActions({ entity, row, label, canDelete, isSuperAdmin, onChanged }) {
  const [confirmSoft, setConfirmSoft] = useState(false);
  const [confirmPerm, setConfirmPerm] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const isDeleted = !!row.deleted_at;
  if (!canDelete && !isSuperAdmin) return null;

  return (
    <>
      <div className="inline-flex items-center gap-1 justify-end" onClick={(e) => e.stopPropagation()}>
        {!isDeleted && canDelete && (
          <button onClick={() => setConfirmSoft(true)} title="Delete"
            data-testid={`del-row-${row.id}`}
            className="text-red-600 hover:text-red-800 p-1 rounded hover:bg-red-50">
            <Trash2 className="w-4 h-4"/>
          </button>
        )}
        {isDeleted && canDelete && (
          <>
            <button onClick={() => setConfirmRestore(true)} title="Restore"
              data-testid={`restore-row-${row.id}`}
              className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-[#3A6B8C] hover:text-[#1F2A33]">
              <RotateCcw className="w-3 h-3"/> Restore
            </button>
            {isSuperAdmin && (
              <button onClick={() => setConfirmPerm(true)} title="Permanently delete"
                data-testid={`perm-del-row-${row.id}`}
                className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-red-900 hover:text-red-700 ml-2">
                <Skull className="w-3 h-3"/> Permanently
              </button>
            )}
          </>
        )}
      </div>

      <SoftDeleteConfirm open={confirmSoft} onClose={() => setConfirmSoft(false)}
        entity={entity} row={row} label={label} onDone={() => { setConfirmSoft(false); onChanged?.(); }}/>
      <PermDeleteConfirm open={confirmPerm} onClose={() => setConfirmPerm(false)}
        entity={entity} row={row} label={label} onDone={() => { setConfirmPerm(false); onChanged?.(); }}/>
      <RestoreConfirm open={confirmRestore} onClose={() => setConfirmRestore(false)}
        entity={entity} row={row} label={label} onDone={() => { setConfirmRestore(false); onChanged?.(); }}/>
    </>
  );
}

function SoftDeleteConfirm({ open, onClose, entity, row, label, onDone }) {
  const [busy, setBusy] = useState(false);
  if (!open) return null;
  const submit = async () => {
    setBusy(true);
    try {
      await api.delete(`/${entity}/${row.id}`);
      toast.success(`${label(row)} deleted`);
      onDone?.();
    } catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message); }
    finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose?.(); }}>
      <DialogContent data-testid="soft-delete-dialog" className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-red-700 inline-flex items-center gap-2">
            <Trash2 className="w-5 h-5"/> Delete {entity.slice(0,-1)}?
          </DialogTitle>
          <DialogDescription className="pt-2 text-sm text-gray-700">
            This will soft-delete <strong>{label(row)}</strong>. It will be hidden from default views
            but historical references remain. You can restore it later from the Deleted filter.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} data-testid="soft-delete-cancel">Cancel</Button>
          <Button onClick={submit} disabled={busy} className="bg-red-600 text-white hover:bg-red-700" data-testid="soft-delete-confirm">
            {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin"/> : <Trash2 className="w-4 h-4 mr-2"/>} Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PermDeleteConfirm({ open, onClose, entity, row, label, onDone }) {
  const [refs, setRefs] = useState(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTyped(""); setRefs(null);
    api.get(`/${entity}/${row.id}/references`)
      .then(({ data }) => setRefs(data))
      .catch((e) => toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message));
  }, [open, entity, row.id]);

  if (!open) return null;
  const total = refs ? refs.total ?? Object.values(refs.references || {}).reduce((a,b)=>a+b,0) : null;
  const blocked = total === null || total > 0;
  const identifier = label(row);
  const matches = typed.trim().toLowerCase() === String(identifier).toLowerCase();

  const submit = async () => {
    setBusy(true);
    try {
      await api.delete(`/${entity}/${row.id}?permanent=true`);
      toast.success(`${identifier} permanently deleted`);
      onDone?.();
    } catch (e) {
      const d = e.response?.data?.detail;
      if (d && typeof d === "object" && d.references) {
        setRefs({ references: d.references, total: Object.values(d.references).reduce((a,b)=>a+b,0) });
        toast.error("Cannot permanently delete — references exist");
      } else toast.error(formatApiErrorDetail(d) || e.message);
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose?.(); }}>
      <DialogContent data-testid="perm-delete-dialog" className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-red-900 inline-flex items-center gap-2">
            <AlertTriangle className="w-5 h-5"/> Permanently delete — irreversible
          </DialogTitle>
          <DialogDescription className="pt-2 text-sm text-gray-700">
            Permanently remove <strong>{identifier}</strong>. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        {refs === null ? (
          <div className="text-sm text-gray-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin"/> Counting references…</div>
        ) : total > 0 ? (
          <div className="bg-red-50 border border-red-200 rounded p-3 text-sm" data-testid="perm-delete-refs">
            <div className="font-bold text-red-800 mb-2">Cannot permanently delete — references exist:</div>
            <ul className="text-xs text-red-900 space-y-0.5">
              {Object.entries(refs.references).map(([k, v]) => v > 0 && (
                <li key={k}><code className="bg-red-100 px-1 rounded">{k}</code>: {v}</li>
              ))}
            </ul>
            <div className="mt-2 text-xs text-red-700">Soft delete instead — preserves history.</div>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="text-xs text-gray-600">Type <code className="bg-gray-100 px-1.5 py-0.5 rounded font-mono">{identifier}</code> to confirm:</div>
            <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={String(identifier)}
              data-testid="perm-delete-input" autoComplete="off"/>
          </div>
        )}
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} data-testid="perm-delete-cancel">Cancel</Button>
          <Button onClick={submit} disabled={busy || blocked || !matches}
            className="bg-red-900 text-white hover:bg-red-800 disabled:opacity-40"
            data-testid="perm-delete-confirm">
            {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin"/> : <Skull className="w-4 h-4 mr-2"/>} Permanently delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RestoreConfirm({ open, onClose, entity, row, label, onDone }) {
  const [busy, setBusy] = useState(false);
  if (!open) return null;
  const submit = async () => {
    setBusy(true);
    try {
      await api.post(`/${entity}/${row.id}/restore`);
      toast.success(`${label(row)} restored`);
      onDone?.();
    } catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message); }
    finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose?.(); }}>
      <DialogContent data-testid="restore-dialog" className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-[#3A6B8C] inline-flex items-center gap-2">
            <RotateCcw className="w-5 h-5"/> Restore?
          </DialogTitle>
          <DialogDescription className="pt-2 text-sm text-gray-700">
            Reactivate <strong>{label(row)}</strong>. It will reappear in default views immediately.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} data-testid="restore-cancel">Cancel</Button>
          <Button onClick={submit} disabled={busy} className="bg-[#3A6B8C] text-white hover:bg-[#1F2A33]" data-testid="restore-confirm">
            {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin"/> : <RotateCcw className="w-4 h-4 mr-2"/>} Restore
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
