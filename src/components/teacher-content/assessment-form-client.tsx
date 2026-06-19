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

export function AssessmentCreateClient() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
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
          description: description.trim() ? description : null
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
        description="Create a top-level assessment container before adding concept units."
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
        <Button disabled={isSubmitting} type="submit">
          <Save className="h-4 w-4" aria-hidden="true" />
          {isSubmitting ? "Creating" : "Create assessment"}
        </Button>
      </form>
    </div>
  );
}
