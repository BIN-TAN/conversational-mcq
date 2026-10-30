"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, RefreshCcw } from "lucide-react";
import { requestErrorMessage, SERVER_UNAVAILABLE_MESSAGE } from "@/components/server-unavailable-message";

// One-time reinterpretation of earlier attempts under the updated interpretation rules
// (release 27, src/lib/services/interpretation-relabel/service.ts).

type Preview = { session_public_id: string; student: string; mini_test: string; attempt_number: number; label_now: string; label_after: string };
type Status = {
  prompt_version: string;
  rules_approved: boolean;
  submitted_attempts: number;
  not_ready: number;
  up_to_date: number;
  to_do: number;
  previews_ready: number;
  applied: number;
  previews: Preview[];
};
type Step =
  | { status: "done" }
  | { status: "blocked"; reason: string }
  | { status: "kept_original"; session_public_id: string; reason: string }
  | { status: "previewed"; session_public_id: string; label_now: string; label_after: string };

const API = "/api/teacher/interpretation-relabel";

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, { cache: "no-store", ...init });
  const body = await response.json().catch(() => null);
  if (!body) throw new Error(SERVER_UNAVAILABLE_MESSAGE);
  if (!response.ok) throw new Error(body.error?.message ?? "The request could not be completed.");
  return body as T;
}

const plural = (count: number, word: string) => `${count} ${count === 1 ? word : `${word}s`}`;

export function InterpretationRelabelClient() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; kept: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmUndo, setConfirmUndo] = useState(false);
  const [message, setMessage] = useState("");
  const stopRequested = useRef(false);

  const load = useCallback(async () => {
    try {
      setStatus(await call<Status>(""));
    } catch (caught) {
      setError(requestErrorMessage(caught, "The page could not be loaded."));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function run() {
    if (!status) return;
    setRunning(true);
    setError("");
    setMessage("");
    stopRequested.current = false;
    const skip: string[] = [];
    let done = 0;
    let kept = 0;
    const total = status.to_do;
    setProgress({ done, total, kept });
    try {
      while (!stopRequested.current) {
        const step = await call<Step>("/next", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ skip })
        });
        if (step.status === "done") break;
        if (step.status === "blocked") {
          setError("The updated interpretation rules have not been approved for use yet, so no attempt can be interpreted again. Set the approval in the site settings, then try again.");
          break;
        }
        if (step.status === "kept_original") {
          skip.push(step.session_public_id);
          kept += 1;
        }
        done += 1;
        setProgress({ done, total, kept });
      }
    } catch (caught) {
      setError(requestErrorMessage(caught, "The update stopped. Start it again to continue where it stopped."));
    } finally {
      setRunning(false);
      await load();
    }
  }

  async function action(path: "/apply" | "/discard" | "/undo", done: (body: Record<string, number>) => string) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      setMessage(done(await call<Record<string, number>>(path, { method: "POST" })));
      setConfirmUndo(false);
    } catch (caught) {
      setError(requestErrorMessage(caught, "The request could not be completed."));
    } finally {
      setBusy(false);
      await load();
    }
  }

  const changed = status?.previews.filter((entry) => entry.label_now !== entry.label_after) ?? [];

  return (
    <section className="space-y-5" data-testid="interpretation-relabel">
      <div className="max-w-3xl space-y-2 text-sm leading-6 text-muted">
        <p>
          The interpretation rules were updated: an explanation now counts as adequate when it gives the key reason for the
          answer, even if it leaves out supporting points. This reads the answers students already submitted again under the
          updated rules, so earlier attempts get labels by the same rules as new ones.
        </p>
        <p>
          Students&apos; answers, conversations and feedback do not change, and the earlier interpretations are kept. You see the
          new labels first and decide whether to use them; you can return to the earlier labels at any time.
        </p>
      </div>

      {error ? <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">{error}</p> : null}
      {message ? <p className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{message}</p> : null}
      {!status && !error ? (
        <p className="flex items-center gap-2 text-sm text-muted"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Loading</p>
      ) : null}

      {status ? (
        <>
          {!status.rules_approved ? (
            <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
              The updated interpretation rules have not been approved for use yet. Attempts can be interpreted again once they are.
            </p>
          ) : null}
          <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            <div className="flex justify-between border-b border-line py-1"><dt className="text-muted">Submitted attempts</dt><dd className="font-medium">{status.submitted_attempts}</dd></div>
            <div className="flex justify-between border-b border-line py-1"><dt className="text-muted">Already under the updated rules</dt><dd className="font-medium">{status.up_to_date}</dd></div>
            <div className="flex justify-between border-b border-line py-1"><dt className="text-muted">Still to interpret again</dt><dd className="font-medium">{status.to_do}</dd></div>
            <div className="flex justify-between border-b border-line py-1"><dt className="text-muted">New labels ready to review</dt><dd className="font-medium">{status.previews_ready}</dd></div>
            {status.not_ready ? (
              <div className="flex justify-between border-b border-line py-1"><dt className="text-muted">Just submitted, still being interpreted</dt><dd className="font-medium">{status.not_ready}</dd></div>
            ) : null}
          </dl>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="inline-flex h-10 items-center gap-2 rounded-md bg-accent px-4 text-sm font-semibold text-white hover:bg-[#176350] disabled:opacity-50"
              disabled={running || busy || status.to_do === 0 || !status.rules_approved}
              onClick={() => void run()}
            >
              {running ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCcw className="h-4 w-4" aria-hidden="true" />}
              {running ? "Interpreting again" : `Interpret ${plural(status.to_do, "attempt")} again`}
            </button>
            {running ? (
              <button type="button" className="inline-flex h-10 items-center rounded-md border border-line bg-white px-4 text-sm font-semibold text-ink hover:border-accent"
                onClick={() => { stopRequested.current = true; }}>
                Stop after this attempt
              </button>
            ) : null}
          </div>
          {progress ? (
            <p className="text-sm text-muted" aria-live="polite">
              {progress.done} of {progress.total} done{progress.kept ? `; ${plural(progress.kept, "attempt")} could not be interpreted again and keep${progress.kept === 1 ? "s" : ""} the earlier label` : ""}.
              {running ? " Each attempt takes up to a minute; keep this page open." : ""}
            </p>
          ) : null}

          {status.previews.length ? (
            <div className="space-y-3">
              <h2 className="text-lg font-semibold text-ualberta-green-dark">New labels to review</h2>
              <p className="text-sm text-muted">
                {plural(changed.length, "attempt")} of {status.previews.length} would get a different label. Nothing changes for
                instructors or in exports until you apply them.
              </p>
              <div className="overflow-x-auto border-y border-line" tabIndex={0} role="region" aria-label="New labels to review">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead className="bg-gray-50">
                    <tr><th className="p-2">Student</th><th className="p-2">Mini test</th><th className="p-2">Attempt</th><th className="p-2">Label now</th><th className="p-2">New label</th></tr>
                  </thead>
                  <tbody>
                    {status.previews.map((entry) => (
                      <tr key={entry.session_public_id} className="border-t border-line">
                        <td className="p-2">{entry.student}</td>
                        <td className="p-2">{entry.mini_test}</td>
                        <td className="p-2">{entry.attempt_number}</td>
                        <td className="p-2">{entry.label_now}</td>
                        <td className={`p-2 ${entry.label_now !== entry.label_after ? "font-semibold text-ink" : ""}`}>{entry.label_after}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap gap-3">
                <button type="button" disabled={busy || running}
                  className="inline-flex h-10 items-center gap-2 rounded-md bg-accent px-4 text-sm font-semibold text-white hover:bg-[#176350] disabled:opacity-50"
                  onClick={() => void action("/apply", (body) => `New labels applied to ${plural(body.applied ?? 0, "attempt")}.`)}>
                  Apply the new labels
                </button>
                <button type="button" disabled={busy || running}
                  className="inline-flex h-10 items-center rounded-md border border-line bg-white px-4 text-sm font-semibold text-ink hover:border-accent disabled:opacity-50"
                  onClick={() => void action("/discard", () => "The new labels were set aside; the current labels stay.")}>
                  Keep the current labels
                </button>
              </div>
            </div>
          ) : null}

          {status.applied ? (
            <div className="space-y-2 border-t border-line pt-4">
              <p className="text-sm text-muted">{plural(status.applied, "attempt")} use the updated labels.</p>
              {confirmUndo ? (
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-sm text-ink">Return every attempt to the labels it had before?</span>
                  <button type="button" disabled={busy}
                    className="inline-flex h-10 items-center rounded-md border border-red-200 bg-white px-4 text-sm font-semibold text-red-900 hover:border-red-400 disabled:opacity-50"
                    onClick={() => void action("/undo", (body) => `${plural(body.returned ?? 0, "attempt")} returned to the earlier labels.`)}>
                    Yes, return to the earlier labels
                  </button>
                  <button type="button" className="text-sm font-semibold text-muted underline" onClick={() => setConfirmUndo(false)}>Cancel</button>
                </div>
              ) : (
                <button type="button" disabled={busy || running}
                  className="inline-flex h-10 items-center rounded-md border border-line bg-white px-4 text-sm font-semibold text-ink hover:border-accent disabled:opacity-50"
                  onClick={() => setConfirmUndo(true)}>
                  Return to the earlier labels
                </button>
              )}
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
