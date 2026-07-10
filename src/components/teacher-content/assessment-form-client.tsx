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
  const [description, setDescription] = useState("");
  const [workflowMode, setWorkflowMode] = useState<"automatic" | "manual_review">("automatic");
  const [responseCollectionMode, setResponseCollectionMode] =
    useState<"llm_assisted" | "deterministic">("llm_assisted");
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
          description: description.trim() ? description : null,
          workflow_mode: workflowMode,
          response_collection_mode: responseCollectionMode,
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
        eyebrow="assessment"
        title="New assessment"
        description="Create a top-level assessment container before adding topics."
      />

      <ErrorPanel error={error} />

      <form className="max-w-2xl space-y-4 rounded-lg border border-line bg-white p-5 shadow-soft" onSubmit={onSubmit}>
        <Field label="Title">
          <input
            className="rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
            onChange={(event) => setTitle(event.target.value)}
            required
            value={title}
          />
        </Field>
        <Field label="Description">
          <textarea
            className="min-h-32 rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
            onChange={(event) => setDescription(event.target.value)}
            value={description}
          />
        </Field>
        <Field label="Workflow mode">
          <select
            className="rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
            onChange={(event) =>
              setWorkflowMode(event.target.value as "automatic" | "manual_review")
            }
            value={workflowMode}
          >
            <option value="automatic">Automatic</option>
            <option value="manual_review">Manual review</option>
          </select>
        </Field>
        <p className="text-sm leading-6 text-muted">
          Automatic: The system will automatically run profiling, formative planning, and
          follow-up startup after the student completes the initial item set.
        </p>
        <p className="text-sm leading-6 text-muted">
          Manual review: The system will wait for the teacher/researcher to review and
          trigger each AI-supported step.
        </p>
        <Field label="Response collection mode">
          <select
            className="rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
            onChange={(event) =>
              setResponseCollectionMode(event.target.value as "llm_assisted" | "deterministic")
            }
            value={responseCollectionMode}
          >
            <option value="llm_assisted">LLM-assisted conversation</option>
            <option value="deterministic">Deterministic collection</option>
          </select>
        </Field>
        {responseCollectionMode === "llm_assisted" ? (
          <p className="text-sm leading-6 text-muted">
            Student free-text messages are interpreted by the Response Collection Agent. Option
            and confidence selections still use structured controls, and no content help is
            provided during initial administration.
          </p>
        ) : (
          <p className="text-sm leading-6 text-muted">
            The system uses fixed initial-administration prompts. Free text is collected as
            reasoning only when the current step explicitly requests reasoning.
          </p>
        )}
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
          {isSubmitting ? "Creating" : "Create assessment"}
        </Button>
      </form>
    </div>
  );
}
