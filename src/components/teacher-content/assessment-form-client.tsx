"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
import { apiRequest, errorFromUnknown } from "./api";
import type { AssessmentSummary, StructuredApiError } from "./types";
import { Button, ErrorPanel, Field, PageHeader } from "./ui";

type CreateAssessmentResponse = {
  assessment: AssessmentSummary;
};

export function AssessmentCreateClient({ courseTimezone }: { courseTimezone: string }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [diagnosticFocus, setDiagnosticFocus] = useState("");
  const [folderLabel, setFolderLabel] = useState("");
  const [releaseAt, setReleaseAt] = useState("");
  const [closeAt, setCloseAt] = useState("");
  const [error, setError] = useState<StructuredApiError | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const data = await apiRequest<CreateAssessmentResponse>("/api/teacher/assessments", {
        method: "POST",
        body: JSON.stringify({
          title,
          diagnostic_focus: diagnosticFocus.trim() ? diagnosticFocus : null,
          folder_label: folderLabel.trim() ? folderLabel : null,
          workflow_mode: "automatic",
          response_collection_mode: "llm_assisted",
          auto_create_primary_topic: true,
          release_at_course_time: releaseAt || null,
          close_at_course_time: closeAt || null
        })
      });
      router.push(`/teacher/content/assessments/${data.assessment.assessment_public_id}`);
    } catch (caught) {
      setError(errorFromUnknown(caught));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="mini test"
        title="New mini test"
        description="Create a classroom mini test, then add MCQ items directly."
      />

      <ErrorPanel error={error} />

      <form className="max-w-2xl space-y-4 rounded-lg border border-line bg-white p-5 shadow-soft" onSubmit={onSubmit}>
        <Field label="Assessment name">
          <input
            className="rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
            onChange={(event) => setTitle(event.target.value)}
            required
            value={title}
          />
        </Field>
        <Field
          label="Diagnostic focus"
          hint="What misconception, cognitive process, or diagnostic framework does this assessment target? Write in plain English. The system uses this as teacher guidance when interpreting student reasoning. Students do not see this note."
        >
          <textarea
            className="min-h-32 rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
            onChange={(event) => setDiagnosticFocus(event.target.value)}
            value={diagnosticFocus}
          />
        </Field>
        <Field label="Folder / week / module">
          <input
            className="rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
            onChange={(event) => setFolderLabel(event.target.value)}
            placeholder="e.g. Week 3"
            value={folderLabel}
          />
        </Field>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Release date/time">
            <input
              className="rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
              onChange={(event) => setReleaseAt(event.target.value)}
              type="datetime-local"
              value={releaseAt}
            />
          </Field>
          <Field label="Closing date/time">
            <input
              className="rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
              onChange={(event) => setCloseAt(event.target.value)}
              type="datetime-local"
              value={closeAt}
            />
          </Field>
        </div>
        <p className="text-sm leading-6 text-muted">
          Release and closing dates use {courseTimezone} course time and control when new students
          may start. Students who already started may continue after the closing date.
        </p>
        <Button disabled={isSubmitting} type="submit">
          <Save className="h-4 w-4" aria-hidden="true" />
          {isSubmitting ? "Creating" : "Create mini test"}
        </Button>
      </form>
    </div>
  );
}
