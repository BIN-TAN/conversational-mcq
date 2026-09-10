import Link from "next/link";
import { FileJson, Library, Plus } from "lucide-react";

export default function TeacherContentHomePage() {
  return (
    <section className="grid gap-4 md:grid-cols-3">
      <Link
        className="rounded-lg border border-line bg-white p-5 shadow-soft transition hover:border-accent"
        href="/teacher/content/assessments/new"
      >
        <Plus className="h-5 w-5 text-accent" aria-hidden="true" />
        <h2 className="mt-4 text-lg font-semibold text-ink">New mini test</h2>
      </Link>
      <Link
        className="rounded-lg border border-line bg-white p-5 shadow-soft transition hover:border-accent"
        href="/teacher/content/assessments"
      >
        <Library className="h-5 w-5 text-accent" aria-hidden="true" />
        <h2 className="mt-4 text-lg font-semibold text-ink">Assessment library</h2>
      </Link>
      <Link
        className="rounded-lg border border-line bg-white p-5 shadow-soft transition hover:border-accent"
        href="/teacher/content/import-json"
      >
        <FileJson className="h-5 w-5 text-accent" aria-hidden="true" />
        <h2 className="mt-4 text-lg font-semibold text-ink">JSON import</h2>
      </Link>
    </section>
  );
}
