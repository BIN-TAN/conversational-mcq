"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
import { apiRequest, errorFromUnknown } from "./api";
import { parseJsonObject } from "./form-utils";
import type { ConceptUnitSummary, StructuredApiError } from "./types";
import { Button, ErrorPanel, Field, PageHeader } from "./ui";
import { mergeTopicDiagnosticNoteIntoRules } from "@/lib/services/content/teacher-diagnostic-context";

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
  const [teacherDiagnosticNote, setTeacherDiagnosticNote] = useState("");
  const [administrationRules, setAdministrationRules] = useState("{}");
  const [orderIndex, setOrderIndex] = useState("");
  const [error, setError] = useState<StructuredApiError | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const rules = mergeTopicDiagnosticNoteIntoRules({
        administration_rules: parseJsonObject(administrationRules, "Advanced settings"),
        topic_diagnostic_note: teacherDiagnosticNote
      });
      const data = await apiRequest<ConceptUnitResponse>(
        `/api/teacher/assessments/${assessmentPublicId}/concept-units`,
        {
          method: "POST",
          body: JSON.stringify({
            title,
            learning_objective: learningObjective,
            related_concept_description: relatedDescription,
            administration_rules: rules,
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
      <PageHeader title="Add topic" />

      <ErrorPanel error={error} />

      <form className="max-w-3xl space-y-4 rounded-lg border border-line bg-white p-5 shadow-soft" onSubmit={onSubmit}>
        <Field label="Topic title">
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
        <Field label="Concept description">
          <textarea
            className="min-h-24 rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
            onChange={(event) => setRelatedDescription(event.target.value)}
            required
            value={relatedDescription}
          />
        </Field>
        <Field
          label="Optional teacher diagnostic note for topic"
          hint="Teacher-only guidance for later interpretation. Students do not see this note."
        >
          <textarea
            className="min-h-24 rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
            onChange={(event) => setTeacherDiagnosticNote(event.target.value)}
            value={teacherDiagnosticNote}
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
        <details className="rounded-md border border-line bg-slate-50 p-3">
          <summary className="cursor-pointer text-sm font-semibold text-ink">
            Advanced settings
          </summary>
          <div className="mt-3">
            <Field label="Administration rules JSON" hint="Optional advanced JSON object. Standard topic fields above are preferred.">
              <textarea
                className="min-h-28 rounded-md border border-line px-3 py-2 font-mono text-sm outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
                onChange={(event) => setAdministrationRules(event.target.value)}
                value={administrationRules}
              />
            </Field>
          </div>
        </details>
        <Button disabled={isSubmitting} type="submit">
          <Save className="h-4 w-4" aria-hidden="true" />
          {isSubmitting ? "Creating" : "Add topic"}
        </Button>
      </form>
    </div>
  );
}
