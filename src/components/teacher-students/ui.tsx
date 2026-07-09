"use client";

import Link from "next/link";
import { AlertTriangle, Download, Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import type { OneTimeCredential, StructuredApiError } from "./types";

export function formatDate(value?: string | null) {
  if (!value) {
    return "Not recorded";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

export function StudentAccountNav({ userId }: { userId: string }) {
  const links = [
    { href: "/teacher/dashboard", label: "Dashboard" },
    { href: "/teacher/students", label: "Student accounts" },
    { href: "/teacher/students/import", label: "Roster import" },
    { href: "/teacher/students/new", label: "Create student" },
    { href: "/teacher/sessions", label: "Student sessions" },
    { href: "/teacher/content", label: "Content management" },
    { href: "/teacher/data", label: "Data and outcomes" }
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

export function StatusPill({ value }: { value: string }) {
  const good = value === "active" || value === "committed";
  const styles = good
    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
    : "border-amber-200 bg-amber-50 text-amber-900";

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

export function downloadTextFile(fileName: string, text: string, mimeType = "text/csv;charset=utf-8") {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function CredentialResult({
  credentials,
  credentialCsv,
  warning
}: {
  credentials: OneTimeCredential[];
  credentialCsv: string;
  warning: string;
}) {
  if (credentials.length === 0) {
    return null;
  }

  return (
    <section className="rounded-lg border border-amber-200 bg-amber-50 p-5 text-sm text-amber-950">
      <h2 className="text-lg font-semibold">One-time credentials</h2>
      <p className="mt-2 max-w-3xl leading-6">{warning}</p>
      <div className="mt-4 overflow-x-auto rounded-md border border-amber-200 bg-white">
        <table className="min-w-full text-left">
          <thead className="border-b border-line bg-slate-50 text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-3 py-2">user_id</th>
              <th className="px-3 py-2">Display name</th>
              <th className="px-3 py-2">Email</th>
              <th className="px-3 py-2">Temporary password/access code</th>
            </tr>
          </thead>
          <tbody>
            {credentials.map((credential) => (
              <tr className="border-b border-line last:border-b-0" key={credential.user_id}>
                <td className="px-3 py-2 font-medium text-ink">{credential.user_id}</td>
                <td className="px-3 py-2 text-muted">{credential.display_name ?? ""}</td>
                <td className="px-3 py-2 text-muted">{credential.email ?? ""}</td>
                <td className="px-3 py-2 font-mono text-ink">
                  {credential.temporary_password ?? credential.temporary_access_code}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        className="mt-4 inline-flex h-10 items-center gap-2 rounded-md border border-amber-300 bg-white px-4 text-sm font-semibold text-ink hover:border-accent"
        onClick={() => downloadTextFile("student-credentials.csv", credentialCsv)}
        type="button"
      >
        <Download className="h-4 w-4" aria-hidden="true" />
        Download credential CSV
      </button>
    </section>
  );
}
