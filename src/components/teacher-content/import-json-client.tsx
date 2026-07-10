"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { Upload } from "lucide-react";
import { apiRequest, errorFromUnknown } from "./api";
import type { ImportResult, StructuredApiError } from "./types";
import { Button, ErrorPanel, PageHeader, SuccessPanel } from "./ui";

const sampleImport = {
  assessment: {
    title: "Demo assessment",
    description: "Optional description",
    diagnostic_focus: "Plain-English diagnostic focus for teacher/research interpretation.",
    folder_label: "Week 1"
  },
  concept_units: [
    {
      title: "Topic title",
      learning_objective: "Learning objective",
      related_concept_description: "Related concept description",
      administration_rules: {
        initial_administration: "no_feedback"
      },
      items: [
        {
          item_stem: "Question text",
          options: [
            { label: "A", text: "Option A" },
            { label: "B", text: "Option B" },
            { label: "C", text: "Option C" }
          ],
          correct_option: "A",
          distractor_rationales: {
            B: "Why B may indicate partial understanding",
            C: "Why C may indicate a misconception"
          },
          expected_reasoning_patterns: ["Expected correct reasoning pattern"],
          possible_misconception_indicators: ["Possible misconception indicator"],
          administration_rules: {}
        }
      ]
    }
  ]
};

export function ImportJsonClient() {
  const [jsonText, setJsonText] = useState(JSON.stringify(sampleImport, null, 2));
  const [error, setError] = useState<StructuredApiError | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    setResult(null);

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText);
    } catch (caught) {
      setError({
        code: "validation_failed",
        message: caught instanceof Error ? caught.message : "JSON could not be parsed."
      });
      return;
    }

    setIsSubmitting(true);

    try {
      const data = await apiRequest<ImportResult>("/api/teacher/content/import-json", {
        method: "POST",
        body: JSON.stringify(parsed)
      });
      setResult(data);
      setSuccess("Import completed.");
    } catch (caught) {
      setError(errorFromUnknown(caught));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="content import"
        title="JSON import"
        description="Manual prepared item-set import. This does not call Item Verification and does not generate or rewrite content."
      />

      <ErrorPanel error={error} />
      <SuccessPanel message={success} />

      <form className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]" onSubmit={onSubmit}>
        <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
          <label className="flex flex-col gap-2 text-sm font-medium text-ink">
            Import JSON
            <textarea
              className="min-h-[560px] rounded-md border border-line px-3 py-2 font-mono text-sm outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
              onChange={(event) => setJsonText(event.target.value)}
              value={jsonText}
            />
          </label>
          <div className="mt-4">
            <Button disabled={isSubmitting} type="submit">
              <Upload className="h-4 w-4" aria-hidden="true" />
              {isSubmitting ? "Importing" : "Import JSON"}
            </Button>
          </div>
        </section>

        <aside className="space-y-4">
          <section className="rounded-lg border border-line bg-white p-5 text-sm leading-6 text-muted shadow-soft">
            Provide either `assessment` for a new assessment or `assessment_public_id` to add
            topics under an existing assessment. Writes run through the content backend API.
          </section>
          <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
            <h2 className="font-semibold text-ink">Sample file</h2>
            <p className="mt-2 text-sm leading-6 text-muted">
              A copy of this template is also documented in `docs/sample-concept-unit-import.json`.
            </p>
          </section>
        </aside>
      </form>

      {result ? (
        <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
          <h2 className="text-xl font-semibold text-ink">Created public IDs</h2>
          <div className="mt-4 space-y-4 text-sm">
            <div>
              <p className="text-muted">Assessment</p>
              <Link
                className="font-mono text-accent underline underline-offset-4"
                href={`/teacher/content/assessments/${result.assessment.assessment_public_id}`}
              >
                {result.assessment.assessment_public_id}
              </Link>
            </div>
            {result.concept_units.map((conceptUnit) => (
              <div className="rounded-lg border border-line p-4" key={conceptUnit.concept_unit_public_id}>
                <p className="font-semibold text-ink">{conceptUnit.title}</p>
                <Link
                  className="mt-2 inline-block font-mono text-accent underline underline-offset-4"
                  href={`/teacher/content/concept-units/${conceptUnit.concept_unit_public_id}`}
                >
                  {conceptUnit.concept_unit_public_id}
                </Link>
                <ul className="mt-3 grid gap-2 md:grid-cols-2">
                  {conceptUnit.items.map((item) => (
                    <li className="font-mono text-xs text-muted" key={item.item_public_id}>
                      {item.item_public_id}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
