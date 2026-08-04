import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import AppIcon from "./AppIcon";
import { api, formatApiErrorDetail } from "../lib/api";
import { Button } from "./ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "./ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip";
import { toast } from "sonner";

/**
 * Report row action cluster — Edit + Soft-delete + Lock icon+tooltip
 *
 * Props:
 *   row: object (must include `_id` and `_entity`; may include `_status`, `_xero_push_status`)
 *   canEdit / canDelete: booleans (permission-gated by parent)
 *   onDeleted: () => void   (parent reloads the report)
 *
 * If both canEdit AND canDelete are false the cluster renders nothing.
 * If the row is finalised (see LOCK_RULES) the Edit + Delete buttons collapse
 * to a single lock icon with the entity-specific tooltip.
 */
const ENTITY_LABEL = {
  customers: "customer",
  projects: "project",
  quotes: "quote",
  jobs: "job",
  invoices: "invoice",
  vehicles: "vehicle",
  employees: "employee",
  "compliance-forms": "compliance form",
};

// Return { locked: bool, message: string } for a row.
export function evaluateLock(row) {
  const s = row._status;
  switch (row._entity) {
    case "invoices":
      if (s === "sent" || row._xero_push_status === "pushed" || row._xero_push_status === "MOCKED_PUSHED")
        return { locked: true, message: "Locked — already sent to customer or pushed to Xero. Void and reissue instead." };
      return { locked: false };
    case "quotes":
      if (s === "accepted" || s === "approved")
        return { locked: true, message: "Locked — customer-approved. Create a revision instead." };
      return { locked: false };
    case "jobs":
      if (s === "delivered" || s === "installed" || s === "completed" || s === "closed")
        return { locked: true, message: "Locked — job completed." };
      return { locked: false };
    case "compliance-forms":
      if (s === "signed" || s === "signed_off")
        return { locked: true, message: "Locked — signed off. Raise an NCR instead." };
      return { locked: false };
    default:
      return { locked: false };
  }
}

function detailPath(entity, id) {
  // Every entity has its own /:id detail route which doubles as its editor.
  if (entity === "compliance-forms") return `/forms/${id}`;
  return `/${entity}/${id}`;
}

export default function ReportRowActions({ row, canEdit, canDelete, onDeleted }) {
  const navigate = useNavigate();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!row?._id || !row?._entity) return null;
  if (!canEdit && !canDelete) return null;

  const { locked, message } = evaluateLock(row);
  const label = ENTITY_LABEL[row._entity] || row._entity;

  if (locked) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex" data-testid={`row-lock-${row._id}`}>
              <AppIcon name="lock" size={18} decorative/>
            </span>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs text-xs">{message}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  const del = async () => {
    setBusy(true);
    try {
      await api.delete(`/${row._entity}/${row._id}`);
      toast.success(`${label} deleted`);
      setConfirm(false);
      onDeleted?.();
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message);
    } finally { setBusy(false); }
  };

  return (
    <>
      <div className="inline-flex items-center gap-1 justify-end" onClick={(e) => e.stopPropagation()}>
        {canEdit && (
          <button
            onClick={() => navigate(detailPath(row._entity, row._id))}
            title="Edit"
            data-testid={`row-edit-${row._id}`}
            className="text-[#3A6B8C] hover:text-[#1F2A33] p-1 rounded hover:bg-blue-50">
            <AppIcon name="edit" size={18} decorative/>
          </button>
        )}
        {canDelete && (
          <button
            onClick={() => setConfirm(true)}
            title="Delete"
            data-testid={`row-delete-${row._id}`}
            className="text-red-600 hover:text-red-800 p-1 rounded hover:bg-red-50">
            <AppIcon name="delete" size={18} decorative/>
          </button>
        )}
      </div>

      <Dialog open={confirm} onOpenChange={(v) => { if (!v) setConfirm(false); }}>
        <DialogContent data-testid={`row-delete-dialog-${row._id}`} className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-red-700 inline-flex items-center gap-2">
              <AppIcon name="delete" size={22} decorative/> Delete this {label}?
            </DialogTitle>
            <DialogDescription className="pt-2 text-sm text-gray-700">
              It will be hidden from all reports but retained in the audit trail. This can be restored by a Super Admin.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirm(false)} disabled={busy}
                    data-testid={`row-delete-cancel-${row._id}`}>Cancel</Button>
            <Button onClick={del} disabled={busy} className="bg-red-600 text-white hover:bg-red-700"
                    data-testid={`row-delete-confirm-${row._id}`}>
              {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin"/> : <AppIcon name="delete" size={16} className="mr-2" decorative/>}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
