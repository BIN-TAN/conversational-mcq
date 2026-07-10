"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle, ChevronRight, Loader2 } from "lucide-react";
import type { StructuredApiError } from "./types";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="border-b border-line pb-5">
      {eyebrow ? (
        <p className="text-sm font-semibold uppercase tracking-wide text-accent">{eyebrow}</p>
      ) : null}
      <div className="mt-2 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-ink">{title}</h1>
          {description ? (
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}

export function Breadcrumbs({
  items
}: {
  items: Array<{ label: string; href?: string }>;
}) {
  return (
    <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-sm text-muted">
      {items.map((item, index) => {
        const isLast = index === items.length - 1;

        return (
          <span className="inline-flex items-center gap-1" key={`${item.label}-${index}`}>
            {index > 0 ? <ChevronRight className="h-4 w-4" aria-hidden="true" /> : null}
            {item.href && !isLast ? (
              <Link className="font-medium text-ink transition hover:text-accent" href={item.href}>
                {item.label}
              </Link>
            ) : (
              <span className={isLast ? "font-medium text-ink" : undefined}>{item.label}</span>
            )}
          </span>
        );
      })}
    </nav>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const styles =
    status === "published"
      ? "border-green-200 bg-green-50 text-green-800"
      : status === "archived"
        ? "border-slate-200 bg-slate-100 text-slate-700"
        : "border-amber-200 bg-amber-50 text-amber-800";

  return (
    <span className={`inline-flex rounded-md border px-2 py-1 text-xs font-semibold ${styles}`}>
      {status}
    </span>
  );
}

export function ContentStateBadge({ state }: { state: string }) {
  const styles =
    state === "locked_after_student_session"
      ? "border-red-200 bg-red-50 text-red-800"
      : state === "published_unused"
        ? "border-blue-200 bg-blue-50 text-blue-800"
        : state === "archived"
          ? "border-slate-200 bg-slate-100 text-slate-700"
          : "border-emerald-200 bg-emerald-50 text-emerald-800";

  return (
    <span className={`inline-flex rounded-md border px-2 py-1 text-xs font-semibold ${styles}`}>
      {contentStateLabel(state)}
    </span>
  );
}

export function contentStateLabel(state: string) {
  if (state === "locked_after_student_session") {
    return "locked after student session";
  }

  if (state === "published_unused") {
    return "published unused";
  }

  if (state === "archived") {
    return "archived";
  }

  return "draft editable";
}

export function ErrorPanel({ error }: { error?: StructuredApiError | null }) {
  if (!error) {
    return null;
  }

  return (
    <section className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <div className="min-w-0">
          <p className="font-semibold">{error.message}</p>
          <p className="mt-1 text-xs uppercase tracking-wide text-red-700">{error.code}</p>
          <ValidationDetails details={error.details} />
        </div>
      </div>
    </section>
  );
}

function ValidationDetails({ details }: { details: unknown }) {
  const issues = collectIssues(details);

  if (issues.length > 0) {
    return (
      <ul className="mt-3 space-y-2">
        {issues.map((issue, index) => (
          <li className="rounded-md bg-white px-3 py-2" key={`${issue.path}-${index}`}>
            <span className="font-medium">{issue.path || "request"}</span>
            <span className="mx-2 text-red-500">/</span>
            <span>{issue.message}</span>
          </li>
        ))}
      </ul>
    );
  }

  if (!details) {
    return null;
  }

  return (
    <pre className="mt-3 max-h-64 overflow-auto rounded-md bg-white p-3 text-xs text-red-950">
      {JSON.stringify(details, null, 2)}
    </pre>
  );
}

function collectIssues(details: unknown): Array<{ path: string; message: string }> {
  const issues: Array<{ path: string; message: string }> = [];

  function walk(value: unknown) {
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }

    if (!value || typeof value !== "object") {
      return;
    }

    const record = value as Record<string, unknown>;
    if (typeof record.message === "string") {
      if (typeof record.path === "string") {
        issues.push({ path: record.path, message: record.message });
      } else if (Array.isArray(record.path)) {
        issues.push({
          path: record.path.map((entry) => String(entry)).join("."),
          message: record.message
        });
      }
    }

    Object.values(record).forEach(walk);
  }

  walk(details);
  return issues;
}

export function SuccessPanel({ message }: { message?: string | null }) {
  if (!message) {
    return null;
  }

  return (
    <section className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-900">
      <div className="flex items-center gap-2">
        <CheckCircle className="h-4 w-4" aria-hidden="true" />
        <p>{message}</p>
      </div>
    </section>
  );
}

export function LoadingRow({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-line bg-white p-4 text-sm text-muted">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      {label}
    </div>
  );
}

export function PrimaryLink({
  href,
  children
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <Link
      className="inline-flex h-10 items-center justify-center rounded-md bg-accent px-4 text-sm font-semibold text-white transition hover:bg-[#176350]"
      href={href}
    >
      {children}
    </Link>
  );
}

export function SecondaryLink({
  href,
  children
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <Link
      className="inline-flex h-10 items-center justify-center rounded-md border border-line bg-white px-4 text-sm font-semibold text-ink transition hover:border-accent"
      href={href}
    >
      {children}
    </Link>
  );
}

export function Field({
  label,
  children,
  hint
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="flex flex-col gap-2 text-sm font-medium text-ink">
      {label}
      {children}
      {hint ? <span className="text-xs font-normal leading-5 text-muted">{hint}</span> : null}
    </label>
  );
}

export function Button({
  children,
  variant = "primary",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger";
}) {
  const className =
    variant === "danger"
      ? "border-red-200 bg-red-50 text-red-800 hover:bg-red-100"
      : variant === "secondary"
        ? "border-line bg-white text-ink hover:border-accent"
        : "border-accent bg-accent text-white hover:bg-[#176350]";

  return (
    <button
      {...props}
      className={`inline-flex h-10 items-center justify-center gap-2 rounded-md border px-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${className} ${props.className ?? ""}`}
    >
      {children}
    </button>
  );
}

export function formatDate(value?: string | null) {
  if (!value) {
    return "";
  }

  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}
