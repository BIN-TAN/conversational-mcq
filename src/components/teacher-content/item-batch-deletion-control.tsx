"use client";

import { useRef, useState } from "react";
import { AlertTriangle, Loader2, Trash2, X } from "lucide-react";
import { ModalDialog } from "@/components/ui/modal-dialog";
import { MAX_ITEM_BATCH_DELETION, type ItemDeletionPreview, type ItemDeletionResult } from "@/lib/services/content/item-deletion-contract";
import { apiRequest, errorFromUnknown } from "./api";
import type { StructuredApiError } from "./types";
import { Button, ErrorPanel } from "./ui";

export function ItemBatchDeletionControl({ assessmentPublicId, itemPublicIds, disabled, onDeleted }: {
  assessmentPublicId: string;
  itemPublicIds: string[];
  disabled?: boolean;
  onDeleted: (result: ItemDeletionResult) => void;
}) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<ItemDeletionPreview | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<StructuredApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const endpoint = `/api/teacher/assessments/${assessmentPublicId}/items/batch-deletion`;

  async function openPreview() {
    if (inFlight.current || itemPublicIds.length === 0) return;
    inFlight.current = true;
    setOpen(true);
    setBusy(true);
    setPreview(null);
    setError(null);
    setConfirmation("");
    try {
      const result = await apiRequest<{ preview: ItemDeletionPreview }>(`${endpoint}/preview`, {
        method: "POST", body: JSON.stringify({ item_public_ids: itemPublicIds })
      });
      setPreview(result.preview);
    } catch (caught) { setError(errorFromUnknown(caught)); }
    finally { inFlight.current = false; setBusy(false); }
  }

  async function confirmDeletion() {
    if (inFlight.current || !preview || confirmation !== preview.required_delete_confirmation) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await apiRequest<{ deletion: ItemDeletionResult }>(endpoint, {
        method: "POST",
        body: JSON.stringify({
          item_public_ids: preview.items.map((item) => item.item_public_id),
          selection_fingerprint: preview.selection_fingerprint,
          delete_confirmation: confirmation
        })
      });
      setOpen(false);
      onDeleted(result.deletion);
    } catch (caught) {
      setError(errorFromUnknown(caught));
      setPreview(null);
    } finally { inFlight.current = false; setBusy(false); }
  }

  return <>
    <Button variant="danger" type="button" onClick={() => void openPreview()}
      disabled={disabled || busy || itemPublicIds.length === 0 || itemPublicIds.length > MAX_ITEM_BATCH_DELETION}>
      <Trash2 className="h-4 w-4 shrink-0" aria-hidden="true" />Delete selected items
    </Button>
    {open ? <ModalDialog labelledBy="item-deletion-title" busy={busy} onClose={() => setOpen(false)}>
      <div className="my-auto max-h-full w-full max-w-2xl overflow-y-auto rounded-lg bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <h2 id="item-deletion-title" className="flex items-start gap-2 text-xl font-semibold text-red-900">
            <AlertTriangle className="mt-1 h-5 w-5 shrink-0" aria-hidden="true" />Delete selected items?
          </h2>
          <button aria-label="Close deletion preview" type="button" disabled={busy} onClick={() => setOpen(false)}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-line disabled:opacity-50">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        {busy ? <p role="status" className="mt-4 flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />{preview ? "Deleting items..." : "Checking selected items..."}</p> : null}
        {error ? <div className="mt-4"><ErrorPanel error={error} /></div> : null}
        {preview ? <>
          <p className="mt-4 text-sm text-red-900">Permanently remove these {preview.items.length} items from this mini test? This cannot be undone.</p>
          <ul className="mt-4 max-h-64 divide-y divide-line overflow-y-auto rounded-md border border-line">
            {preview.items.map((item) => <li key={item.item_public_id} className="p-3">
              <p className="text-sm font-semibold">Item {item.item_order}</p>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm text-muted">{item.item_stem}</p>
            </li>)}
          </ul>
          <p className="mt-3 text-sm">After deletion: {preview.remaining_item_count} items, {preview.remaining_included_item_count} included.</p>
          {preview.remaining_included_item_count < 3 ? <p className="mt-2 text-sm text-amber-900">At least 3 included items are needed before publishing.</p> : null}
          <label className="mt-5 block text-sm font-medium" htmlFor="item-deletion-confirmation">Type <strong>{preview.required_delete_confirmation}</strong> to confirm</label>
          <input id="item-deletion-confirmation" className="mt-2 w-full rounded-md border border-line p-3 text-sm"
            value={confirmation} onChange={(event) => setConfirmation(event.target.value)} disabled={busy} autoComplete="off" spellCheck={false} />
        </> : null}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button variant="secondary" type="button" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button>
          {preview ? <Button variant="danger" type="button" disabled={busy || confirmation !== preview.required_delete_confirmation}
            onClick={() => void confirmDeletion()}><Trash2 className="h-4 w-4" aria-hidden="true" />Delete items permanently</Button> : null}
        </div>
      </div>
    </ModalDialog> : null}
  </>;
}
