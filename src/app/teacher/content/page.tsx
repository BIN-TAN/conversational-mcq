import Link from "next/link";
import { Archive, FileJson, ListChecks, Plus } from "lucide-react";
import { PageHeader, PrimaryLink, SecondaryLink } from "@/components/teacher-content/ui";

const notes = [
  "Create assessments, concept units, and MCQ items manually.",
  "Publish validation is handled by the backend and cannot be bypassed here.",
  "Archive content instead of deleting research-relevant records.",
  "Item Verification highlights advisory warnings only; it does not generate or rewrite content."
];

export default function TeacherContentHomePage() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="teacher_researcher content"
        title="Content management"
        description="Manual assessment, concept-unit, item, and JSON import workflows."
        actions={
          <>
            <PrimaryLink href="/teacher/content/assessments/new">
              <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
              New assessment
            </PrimaryLink>
            <SecondaryLink href="/teacher/content/import-json">
              <FileJson className="mr-2 h-4 w-4" aria-hidden="true" />
              Import JSON
            </SecondaryLink>
          </>
        }
      />

      <section className="grid gap-4 md:grid-cols-3">
        <Link
          className="rounded-lg border border-line bg-white p-5 shadow-soft transition hover:border-accent"
          href="/teacher/content/assessments"
        >
          <ListChecks className="h-5 w-5 text-accent" aria-hidden="true" />
          <h2 className="mt-4 text-lg font-semibold text-ink">Assessment list</h2>
          <p className="mt-2 text-sm leading-6 text-muted">
            View assessment status, concept-unit counts, and content actions.
          </p>
        </Link>
        <Link
          className="rounded-lg border border-line bg-white p-5 shadow-soft transition hover:border-accent"
          href="/teacher/content/import-json"
        >
          <FileJson className="h-5 w-5 text-accent" aria-hidden="true" />
          <h2 className="mt-4 text-lg font-semibold text-ink">JSON import</h2>
          <p className="mt-2 text-sm leading-6 text-muted">
            Paste a concept-based item set and create public IDs through the backend API.
          </p>
        </Link>
        <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
          <Archive className="h-5 w-5 text-accent" aria-hidden="true" />
          <h2 className="mt-4 text-lg font-semibold text-ink">Research integrity</h2>
          <ul className="mt-2 space-y-2 text-sm leading-6 text-muted">
            {notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </section>
      </section>
    </div>
  );
}
