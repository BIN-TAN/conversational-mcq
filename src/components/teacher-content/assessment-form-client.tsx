"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, MessageSquareText, X } from "lucide-react";
import { apiRequest, errorFromUnknown } from "./api";
import type { AssessmentSummary, StructuredApiError } from "./types";
import { Breadcrumbs, Button, ErrorPanel, Field, PageHeader } from "./ui";

type CreateAssessmentResponse = {
  assessment: AssessmentSummary;
};

export function AssessmentCreateClient({ courseTimezone }: { courseTimezone: string }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [folderLabel, setFolderLabel] = useState("");
  const [releaseAt, setReleaseAt] = useState("");
  const [closeAt, setCloseAt] = useState("");
  const [error, setError] = useState<StructuredApiError | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  function markDirty() {
    setHasUnsavedChanges(true);
  }

  function cancel() {
    if (hasUnsavedChanges) {
      const confirmed = window.confirm("Discard unsaved changes and return to the mini-test list?");

      if (!confirmed) {
        return;
      }
    }

    router.push("/teacher/content/assessments");
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const data = await apiRequest<CreateAssessmentResponse>("/api/teacher/assessments", {
        method: "POST",
        body: JSON.stringify({
          title,
          diagnostic_focus: null,
          folder_label: folderLabel.trim() ? folderLabel : null,
          workflow_mode: "automatic",
          response_collection_mode: "llm_assisted",
          auto_create_primary_topic: true,
          release_at_course_time: releaseAt || null,
          close_at_course_time: closeAt || null
        })
      });
      router.push(
        `/teacher/content/assessments/${data.assessment.assessment_public_id}/item-design`
      );
    } catch (caught) {
      setError(errorFromUnknown(caught));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: "Assessment library", href: "/teacher/content/assessments" },
          { label: "New mini test" }
        ]}
      />
      <PageHeader title="New mini test" />

      <ErrorPanel error={error} />

      <section className="max-w-3xl border-y border-line bg-accent-soft px-5 py-4 text-sm leading-6 text-ink">
        <div className="flex gap-3">
          <MessageSquareText className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden="true" />
          <p>
            Create the mini-test shell first. Next, work with the item-design assistant using course
            material, learning objectives, evidence requirements, misconception examples, and
            exemplar items.
          </p>
        </div>
      </section>

      <form className="max-w-3xl space-y-4 rounded-md border border-line bg-white p-5 shadow-soft" onSubmit={onSubmit}>
        <Field label="Assessment name">
          <input
            className="rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
            onChange={(event) => {
              markDirty();
              setTitle(event.target.value);
            }}
            required
            value={title}
          />
        </Field>
        <Field label="Folder / week / module">
          <input
            className="rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
            onChange={(event) => {
              markDirty();
              setFolderLabel(event.target.value);
            }}
            placeholder="e.g. Week 3"
            value={folderLabel}
          />
        </Field>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Release date/time">
            <input
              className="rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
              onChange={(event) => {
                markDirty();
                setReleaseAt(event.target.value);
              }}
              type="datetime-local"
              value={releaseAt}
            />
          </Field>
          <Field label="Closing date/time">
            <input
              className="rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
              onChange={(event) => {
                markDirty();
                setCloseAt(event.target.value);
              }}
              type="datetime-local"
              value={closeAt}
            />
          </Field>
        </div>
        <p className="text-sm leading-6 text-muted">
          Release and closing dates use {courseTimezone} course time and control when new students
          may start. Students who already started may continue after the closing date.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button disabled={isSubmitting} type="submit">
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
            {isSubmitting ? "Creating" : "Create and open assistant"}
          </Button>
          <Button disabled={isSubmitting} onClick={cancel} type="button" variant="secondary">
            <X className="h-4 w-4" aria-hidden="true" />
            Cancel and return to mini-test list
          </Button>
        </div>
      </form>
    </div>
  );
}
