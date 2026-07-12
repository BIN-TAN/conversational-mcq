import Link from "next/link";
import { FileJson, ListChecks, Plus } from "lucide-react";
import { PageHeader, PrimaryLink, SecondaryLink } from "@/components/teacher-content/ui";

export default function TeacherContentHomePage() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="teacher_researcher content"
        title="Mini test builder"
        description="Create classroom mini tests, add MCQ items, and publish when validation passes."
        actions={
          <>
            <PrimaryLink href="/teacher/content/assessments/new">
              <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
              New mini test
            </PrimaryLink>
            <SecondaryLink href="/teacher/content/import-json">
              <FileJson className="mr-2 h-4 w-4" aria-hidden="true" />
              Import JSON
            </SecondaryLink>
          </>
        }
      />

      <section className="grid gap-4 md:grid-cols-2">
        <Link
          className="rounded-lg border border-line bg-white p-5 shadow-soft transition hover:border-accent"
          href="/teacher/content/assessments"
        >
          <ListChecks className="h-5 w-5 text-accent" aria-hidden="true" />
          <h2 className="mt-4 text-lg font-semibold text-ink">Mini tests</h2>
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
