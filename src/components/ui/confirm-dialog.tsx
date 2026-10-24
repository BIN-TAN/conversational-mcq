"use client";

import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { ModalDialog } from "./modal-dialog";

/**
 * A yes/no question before an action that changes what students see, built on the shared
 * native ModalDialog (focus containment, Escape to cancel, focus returns to the trigger).
 */
export function ConfirmDialog({
  id,
  question,
  children,
  confirmLabel,
  cancelLabel = "Cancel",
  tone = "primary",
  busy = false,
  onConfirm,
  onCancel
}: {
  id: string;
  /** A real question, e.g. "Archive this mini test?" */
  question: string;
  /** Plain sentences stating the effect. */
  children: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "primary" | "danger";
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const titleId = `${id}-title`;
  const confirmClass =
    tone === "danger"
      ? "border-red-700 bg-red-700 text-white hover:bg-red-800"
      : "border-accent bg-accent text-white hover:bg-[#176350]";

  return (
    <ModalDialog busy={busy} labelledBy={titleId} onClose={onCancel} testId={id}>
      <div className="w-full max-w-lg rounded-lg border border-line bg-white p-5 shadow-xl">
        <h2 className="text-lg font-semibold text-ink" id={titleId}>
          {question}
        </h2>
        <div className="mt-3 space-y-2 text-sm leading-6 text-muted">{children}</div>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            className="inline-flex h-10 items-center rounded-md border border-line bg-white px-4 text-sm font-semibold text-ink hover:border-accent disabled:opacity-60"
            disabled={busy}
            onClick={onCancel}
            type="button"
          >
            {cancelLabel}
          </button>
          <button
            className={`inline-flex h-10 items-center gap-2 rounded-md border px-4 text-sm font-semibold transition disabled:opacity-60 ${confirmClass}`}
            disabled={busy}
            onClick={onConfirm}
            type="button"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            {confirmLabel}
          </button>
        </div>
      </div>
    </ModalDialog>
  );
}
