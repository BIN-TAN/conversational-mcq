"use client";

import type { ReactNode } from "react";
import { AlertTriangle, Clipboard, Loader2 } from "lucide-react";
import { plainLabel } from "@/lib/teacher-plain-labels";
import type { StructuredApiError } from "./types";

export { plainLabel, plainReviewReason } from "@/lib/teacher-plain-labels";

export function formatDate(value?: string | null, includeSeconds = false) {
  if (!value) {
    return "Not recorded";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: includeSeconds ? "medium" : "short"
  }).format(new Date(value));
}

export function formatDuration(value?: number | null) {
  if (value === null || value === undefined) {
    return "Not recorded";
  }

  const totalSeconds = Math.round(value / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes <= 0) {
    return `${seconds} sec`;
  }

  return `${minutes} min ${seconds} sec`;
}

/** Plain label for a stored code (see TEACHER_PLAIN_LABELS). */
export function label(value: string) {
  return plainLabel(value);
}

export function StatusPill({ value, tone = "neutral" }: { value: string; tone?: "neutral" | "good" | "warn" | "bad" }) {
  const styles =
    tone === "good"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : tone === "warn"
        ? "border-amber-200 bg-amber-50 text-amber-900"
        : tone === "bad"
          ? "border-red-200 bg-red-50 text-red-800"
          : "border-slate-200 bg-slate-50 text-slate-700";

  return (
    <span className={`inline-flex rounded-md border px-2 py-1 text-xs font-semibold ${styles}`}>
      {label(value)}
    </span>
  );
}

export function CopyButton({ value }: { value: string }) {
  return (
    <button
      className="inline-flex h-8 items-center gap-1 rounded-md border border-line bg-white px-2 text-xs font-semibold text-ink hover:border-accent"
      onClick={() => navigator.clipboard.writeText(value)}
      type="button"
    >
      <Clipboard className="h-3.5 w-3.5" aria-hidden="true" />
      Copy
    </button>
  );
}

export function ErrorState({ error }: { error: StructuredApiError }) {
  return (
    <section className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">
      <div className="flex gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <div className="min-w-0">
          <p className="font-semibold">{error.message || "Something went wrong and the request was not completed. Try again in a moment."}</p>
          {error.code || error.details ? (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs font-semibold text-red-800">Technical details</summary>
              {error.code ? <p className="mt-2 break-words text-xs text-red-800">Error code: {error.code}</p> : null}
              {error.details ? (
                <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-white p-3 text-xs">
                  {JSON.stringify(error.details, null, 2)}
                </pre>
              ) : null}
            </details>
          ) : null}
        </div>
      </div>
    </section>
  );
}

export function LoadingState({ label = "Loading session review data" }: { label?: string }) {
  return (
    <section className="rounded-lg border border-line bg-white p-4 text-sm text-muted">
      <div className="flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        {label}
      </div>
    </section>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <section className="rounded-lg border border-dashed border-line bg-white p-6 text-sm text-muted">
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      {children ? <div className="mt-2 leading-6">{children}</div> : null}
    </section>
  );
}

export function JsonDetails({ value, labelText = "Raw JSON" }: { value: unknown; labelText?: string }) {
  return (
    <details className="mt-3 rounded-md border border-line bg-slate-50 p-3">
      <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-muted">
        {labelText}
      </summary>
      <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap text-xs leading-5 text-ink">
        {JSON.stringify(value, null, 2)}
      </pre>
    </details>
  );
}
