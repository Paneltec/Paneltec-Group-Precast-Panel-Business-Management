import { useState, useEffect } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "../components/ui/dialog";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import { Copy, Send } from "lucide-react";
import { api, formatApiErrorDetail } from "../lib/api";
import { toast } from "sonner";

/**
 * Reusable email modal — MOCKED in Phase 4 Part 1.
 *
 * props:
 *  - open, onOpenChange
 *  - defaultRecipient, defaultSubject, defaultBody
 *  - attachmentNotice (optional informational string)
 *  - endpoint (e.g. `/customers/123/email-sent`) — POSTed with {subject, recipient}
 *  - onSent (cb after successful Mark-as-Sent)
 */
export default function EmailModal({
  open, onOpenChange,
  defaultRecipient = "", defaultSubject = "", defaultBody = "",
  attachmentNotice = null,
  endpoint, onSent,
  testid = "email-modal",
}) {
  const [recipient, setRecipient] = useState(defaultRecipient);
  const [subject, setSubject] = useState(defaultSubject);
  const [body, setBody] = useState(defaultBody);
  const [busy, setBusy] = useState(false);

  useEffect(() => { setRecipient(defaultRecipient); }, [defaultRecipient]);
  useEffect(() => { setSubject(defaultSubject); }, [defaultSubject]);
  useEffect(() => { setBody(defaultBody); }, [defaultBody]);

  const markSent = async () => {
    if (!endpoint) return;
    setBusy(true);
    try {
      await api.post(endpoint, { subject, recipient });
      toast.success("Marked as sent");
      onSent?.();
      onOpenChange?.(false);
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail) || e.message);
    } finally { setBusy(false); }
  };

  const copyContent = async () => {
    await navigator.clipboard.writeText(`To: ${recipient}\nSubject: ${subject}\n\n${body}`);
    toast.success("Email content copied");
  };
  const copyRecipient = async () => {
    await navigator.clipboard.writeText(recipient);
    toast.success("Recipient copied");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid={testid} className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Compose email</DialogTitle>
          <DialogDescription>
            <span className="block mt-2 mb-1 bg-[#F5C518]/30 border border-[#F5C518] text-[#1F2A33] text-xs font-bold uppercase tracking-wider px-2 py-1.5 rounded">
              📧 MOCKED — Email will send via Microsoft 365 in Phase 4 Part 2. For now, copy the content below and send from your own inbox.
            </span>
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div>
            <Label className="text-xs uppercase tracking-wider text-[#3A6B8C] font-bold">Recipient</Label>
            <Input value={recipient} onChange={(e) => setRecipient(e.target.value)} data-testid="email-recipient" className="mt-1 h-10"/>
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-[#3A6B8C] font-bold">Subject</Label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} data-testid="email-subject" className="mt-1 h-10"/>
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-[#3A6B8C] font-bold">Body</Label>
            <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={12} data-testid="email-body" className="mt-1 font-mono text-xs whitespace-pre-wrap"/>
          </div>
          {attachmentNotice && (
            <div className="text-xs bg-blue-50 border border-blue-200 rounded px-3 py-2 text-blue-800">
              📎 {attachmentNotice}
            </div>
          )}
        </div>
        <DialogFooter className="flex-wrap gap-2">
          <Button variant="outline" onClick={copyRecipient} data-testid="email-copy-recipient"><Copy className="w-4 h-4 mr-2"/> Copy recipient</Button>
          <Button variant="outline" onClick={copyContent} data-testid="email-copy-content"><Copy className="w-4 h-4 mr-2"/> Copy email content</Button>
          <Button onClick={markSent} disabled={busy} className="bg-[#F5C518] text-[#1F2A33] font-bold hover:bg-[#E0B416]" data-testid="email-mark-sent">
            <Send className="w-4 h-4 mr-2"/>{busy ? "Saving…" : "Mark as Sent"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** "Last emailed: <relative>" small inline label. */
export function LastEmailedLabel({ at, subject }) {
  if (!at) return null;
  let rel = "";
  try {
    const diffMs = Date.now() - new Date(at).getTime();
    const mins = Math.round(diffMs / 60000);
    if (mins < 1) rel = "just now";
    else if (mins < 60) rel = `${mins}m ago`;
    else if (mins < 1440) rel = `${Math.round(mins/60)}h ago`;
    else rel = `${Math.round(mins/1440)}d ago`;
  } catch {}
  return (
    <div className="text-[10px] uppercase tracking-wider text-gray-500 mt-1" data-testid="last-emailed-label">
      📧 Last emailed: {rel}{subject ? ` · "${subject}"` : ""}
    </div>
  );
}
