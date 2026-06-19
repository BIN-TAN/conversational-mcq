"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { AlertTriangle, Clipboard, Loader2 } from "lucide-react";
import type { StructuredApiError } from "./types";

export function formatDate(value?: string | null) {
  if (!value) {
    return "Not recorded";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
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

export function label(value: string) {
  return value.replace(/_/g, " ");
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
        <div>
          <p className="font-semibold">{error.message}</p>
          <p className="mt-1 text-xs uppercase tracking-wide text-red-700">{error.code}</p>
          {error.details ? (
            <pre className="mt-3 max-h-64 overflow-auto rounded-md bg-white p-3 text-xs">
              {JSON.stringify(error.details, null, 2)}
            </pre>
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

export function TeacherReviewNav({ userId }: { userId: string }) {
  const links = [
    { href: "/teacher/dashboard", label: "Dashboard" },
    { href: "/teacher/content", label: "Content management" },
    { href: "/teacher/sessions", label: "Student sessions" },
    { href: "/teacher/content/import-json", label: "JSON import" }
  ];

  return (
    <nav className="mb-6 flex flex-wrap items-center gap-2 text-sm">
      {links.map((link) => (
        <Link
          className="rounded-md border border-line bg-white px-3 py-2 font-medium text-ink transition hover:border-accent"
          href={link.href}
          key={link.href}
        >
          {link.label}
        </Link>
      ))}
      <span className="rounded-md border border-dashed border-line px-3 py-2 text-muted">
        CSV export planned
      </span>
      <span className="ml-auto text-muted">Signed in as {userId}</span>
    </nav>
  );
}
