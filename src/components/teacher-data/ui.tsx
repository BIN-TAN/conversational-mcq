"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
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

export function DataNav({ userId }: { userId: string }) {
  const links = [
    { href: "/teacher/dashboard", label: "Dashboard" },
    { href: "/teacher/content", label: "Content management" },
    { href: "/teacher/sessions", label: "Student sessions" },
    { href: "/teacher/data", label: "Data and outcomes" },
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
      <span className="ml-auto text-muted">Signed in as {userId}</span>
    </nav>
  );
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
      {value.replace(/_/g, " ")}
    </span>
  );
}

export function ErrorPanel({ error }: { error: StructuredApiError | null }) {
  if (!error) {
    return null;
  }

  return (
    <section className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">
      <div className="flex gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <div>
          <p className="font-semibold">{error.message}</p>
          <p className="mt-1 text-xs uppercase tracking-wide text-red-700">{error.code}</p>
          {error.details ? (
            <pre className="mt-3 max-h-56 overflow-auto rounded-md bg-white p-3 text-xs">
              {JSON.stringify(error.details, null, 2)}
            </pre>
          ) : null}
        </div>
      </div>
    </section>
  );
}

export function LoadingPanel({ label = "Loading" }: { label?: string }) {
  return (
    <section className="rounded-lg border border-line bg-white p-4 text-sm text-muted">
      <div className="flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        {label}
      </div>
    </section>
  );
}

export function EmptyPanel({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <section className="rounded-lg border border-dashed border-line bg-white p-5 text-sm text-muted">
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      {children ? <div className="mt-2 leading-6">{children}</div> : null}
    </section>
  );
}
