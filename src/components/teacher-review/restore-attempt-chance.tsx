"use client";

import { useState } from "react";
import { RotateCcw } from "lucide-react";

export function RestoreAttemptChance({ sessionPublicId }: { sessionPublicId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [restored, setRestored] = useState(false);
  async function restore() {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/teacher/sessions/${sessionPublicId}/attempt/restore-chance`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "The chance could not be restored.");
      setRestored(true); setOpen(false); setReason("");
      const remaining = body.result.remaining_attempts;
      setMessage(`${body.result.status === "chance_already_restored" ? "This chance was already restored." : "One chance restored."} ${remaining} ${remaining === 1 ? "chance" : "chances"} remaining. The original attempt is preserved.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Please retry."); }
    finally { setBusy(false); }
  }
  return <div className="mt-4 border-t border-line pt-4">
    <button type="button" disabled={busy || restored} onClick={() => setOpen(!open)} aria-expanded={open}
      className="inline-flex items-center gap-2 rounded-md border border-line bg-white px-3 py-2 text-sm font-semibold disabled:opacity-60">
      <RotateCcw className="h-4 w-4" aria-hidden="true" />Restore a chance
    </button>
    {open && <div className="mt-3 max-w-xl space-y-3">
      <label className="block text-sm font-semibold">Technical problem
        <textarea value={reason} onChange={event => setReason(event.target.value)} minLength={10} maxLength={1000}
          className="mt-1 block w-full rounded-md border border-line p-2 font-normal" rows={3} disabled={busy} />
      </label>
      <button type="button" onClick={() => void restore()} disabled={busy || reason.trim().length < 10}
        className="rounded-md bg-accent px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">
        {busy ? "Restoring..." : "Confirm restoration"}
      </button>
    </div>}
    {message && <p role="status" className="mt-2 text-sm">{message}</p>}
  </div>;
}
