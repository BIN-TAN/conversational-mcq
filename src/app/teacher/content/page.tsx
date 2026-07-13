import Link from "next/link";
import { FileJson, Library, Plus } from "lucide-react";
import { PageHeader } from "@/components/teacher-content/ui";

export default function TeacherContentHomePage() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="teacher_researcher assessment tools"
        title="Assessment management"
        description="Create, organize, and open diagnostic MCQ mini tests from one place."
      />

      <section className="grid gap-4 md:grid-cols-3">
        <Link
          className="rounded-lg border border-line bg-white p-5 shadow-soft transition hover:border-accent"
          href="/teacher/content/assessments/new"
        >
          <Plus className="h-5 w-5 text-accent" aria-hidden="true" />
          <h2 className="mt-4 text-lg font-semibold text-ink">New mini test</h2>
          <p className="mt-2 text-sm leading-6 text-muted">
            Start a teacher-authored MCQ mini test and add diagnostic items.
          </p>
        </Link>
        <Link
          className="rounded-lg border border-line bg-white p-5 shadow-soft transition hover:border-accent"
          href="/teacher/content/assessments"
        >
          <Library className="h-5 w-5 text-accent" aria-hidden="true" />
          <h2 className="mt-4 text-lg font-semibold text-ink">Assessment library</h2>
          <p className="mt-2 text-sm leading-6 text-muted">
            View mini tests by folder/week/module and open the direct MCQ builder.
          </p>
        </Link>
        <Link
          className="rounded-lg border border-line bg-white p-5 shadow-soft transition hover:border-accent"
          href="/teacher/content/import-json"
        >
          <FileJson className="h-5 w-5 text-accent" aria-hidden="true" />
          <h2 className="mt-4 text-lg font-semibold text-ink">JSON import</h2>
          <p className="mt-2 text-sm leading-6 text-muted">
            Paste a prepared item set and create public IDs through the backend API.
          </p>
        </Link>
      </section>
    </div>
  );
}
