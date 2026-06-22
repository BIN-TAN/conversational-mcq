import Link from "next/link";

export function TeacherEvalNav({ userId }: { userId: string }) {
  return (
    <nav className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-white px-4 py-3 shadow-soft">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-accent">
          teacher_researcher
        </p>
        <p className="text-sm text-muted">Signed in as {userId}</p>
      </div>
      <div className="flex flex-wrap gap-2 text-sm">
        <Link className="rounded-md border border-line px-3 py-2 hover:border-accent" href="/teacher/dashboard">
          Dashboard
        </Link>
        <Link className="rounded-md border border-line px-3 py-2 hover:border-accent" href="/teacher/evals">
          Model evaluation
        </Link>
        <Link className="rounded-md border border-line px-3 py-2 hover:border-accent" href="/teacher/evals/suites">
          Suites
        </Link>
        <Link className="rounded-md border border-line px-3 py-2 hover:border-accent" href="/teacher/evals/runs">
          Runs
        </Link>
      </div>
    </nav>
  );
}

export function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="max-h-96 overflow-auto rounded-md border border-line bg-slate-50 p-3 text-xs leading-5 text-ink">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

export function StatusBadge({ value }: { value: string | boolean | null | undefined }) {
  const text = value === null || value === undefined ? "missing" : String(value);
  const good = text === "true" || text === "completed" || text === "pass";

  return (
    <span
      className={`inline-flex rounded-full border px-2 py-1 text-xs font-medium ${
        good ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-line bg-white text-muted"
      }`}
    >
      {text}
    </span>
  );
}

export function formatPercent(value: number | null) {
  return value === null ? "No data" : `${(value * 100).toFixed(1)}%`;
}

export function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString() : "";
}
