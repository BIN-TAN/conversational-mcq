"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
import { apiRequest, errorFromUnknown } from "./api";
import { parseJsonObject } from "./form-utils";
import type { ConceptUnitSummary, StructuredApiError } from "./types";
import { Button, ErrorPanel, Field, PageHeader } from "./ui";

type ConceptUnitResponse = {
  concept_unit: ConceptUnitSummary;
};

export function ConceptUnitCreateClient({
  assessmentPublicId
}: {
  assessmentPublicId: string;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [learningObjective, setLearningObjective] = useState("");
  const [relatedDescription, setRelatedDescription] = useState("");
  const [administrationRules, setAdministrationRules] = useState("{}");
  const [orderIndex, setOrderIndex] = useState("");
  const [error, setError] = useState<StructuredApiError | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const data = await apiRequest<ConceptUnitResponse>(
        `/api/teacher/assessments/${assessmentPublicId}/concept-units`,
        {
          method: "POST",
          body: JSON.stringify({
            title,
            learning_objective: learningObjective,
            related_concept_description: relatedDescription,
            administration_rules: parseJsonObject(administrationRules, "Administration rules"),
            order_index: orderIndex ? Number(orderIndex) : undefined
          })
        }
      );
      router.push(`/teacher/content/concept-units/${data.concept_unit.concept_unit_public_id}`);
    } catch (caught) {
      setError(errorFromUnknown(caught));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="concept unit"
        title="New concept unit"
        description="Create one concept-based item set under the selected assessment."
      />

      <ErrorPanel error={error} />

      <form className="max-w-3xl space-y-4 rounded-lg border border-line bg-white p-5 shadow-soft" onSubmit={onSubmit}>
        <Field label="Title">
          <input
            className="rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
            onChange={(event) => setTitle(event.target.value)}
            required
            value={title}
          />
        </Field>
        <Field label="Learning objective">
          <textarea
            className="min-h-24 rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
            onChange={(event) => setLearningObjective(event.target.value)}
            required
            value={learningObjective}
          />
        </Field>
        <Field label="Related concept description">
          <textarea
            className="min-h-24 rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
            onChange={(event) => setRelatedDescription(event.target.value)}
            required
            value={relatedDescription}
          />
        </Field>
        <Field label="Administration rules" hint="JSON object. Example: {&quot;initial_administration&quot;:&quot;no_feedback&quot;}">
          <textarea
            className="min-h-28 rounded-md border border-line px-3 py-2 font-mono text-sm outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
            onChange={(event) => setAdministrationRules(event.target.value)}
            value={administrationRules}
          />
        </Field>
        <Field label="Order index">
          <input
            className="rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
            min={1}
            onChange={(event) => setOrderIndex(event.target.value)}
            type="number"
            value={orderIndex}
          />
        </Field>
        <Button disabled={isSubmitting} type="submit">
          <Save className="h-4 w-4" aria-hidden="true" />
          {isSubmitting ? "Creating" : "Create concept unit"}
        </Button>
      </form>
    </div>
  );
}
