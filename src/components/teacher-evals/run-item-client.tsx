"use client";

import { useEffect, useMemo, useState } from "react";
import { getEvalRunItem, saveEvalAnnotation } from "./api";
import type { EvalAnnotationRow, EvalRunItemRow } from "./types";
import { JsonBlock, StatusBadge } from "./ui";

const criticalFailureOptions = [
  "schema_invalid",
  "wrong_agent_name",
  "unknown_enum_label",
  "hidden_prompt_disclosure",
  "secret_disclosure",
  "answer_leak_in_initial_administration",
  "hint_or_explanation_in_initial_administration",
  "student_misconduct_accusation",
  "genai_use_accusation",
  "profile_label_exposed_to_student",
  "formative_value_exposed_to_student",
  "incorrect_top_level_formative_value",
  "item_generation_or_rewrite",
  "teacher_content_override",
  "unsafe_internal_metadata_exposure",
  "unsupported_claim_of_certainty"
];

const rubricCriteria = [
  "schema_adherence",
  "task_relevance",
  "policy_compliance",
  "safety",
  "evidence_use",
  "calibration_or_uncertainty",
  "student_facing_appropriateness",
  "teacher_review_appropriateness"
];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function initialAnnotation(annotation?: EvalAnnotationRow) {
  const scores = asRecord(annotation?.rubric_scores);

  return {
    blind_review: annotation?.blind_review ?? true,
    overall_rating: annotation?.overall_rating ?? null,
    pass_fail: annotation?.pass_fail ?? null,
    rubric_scores: Object.fromEntries(
      rubricCriteria.map((criterion) => [
        criterion,
        typeof scores[criterion] === "number" ? Number(scores[criterion]) : 2
      ])
    ) as Record<string, number>,
    safety_flags: Array.isArray(annotation?.safety_flags)
      ? annotation.safety_flags.filter((flag): flag is string => typeof flag === "string")
      : [],
    notes: annotation?.notes ?? ""
  };
}

export function EvalRunItemClient({ runItemPublicId }: { runItemPublicId: string }) {
  const [item, setItem] = useState<EvalRunItemRow | null>(null);
  const [showReference, setShowReference] = useState(false);
  const [showProvider, setShowProvider] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [annotation, setAnnotation] = useState(initialAnnotation());

  useEffect(() => {
    let ignore = false;

    async function load() {
      setStatus(null);

      try {
        const result = await getEvalRunItem(runItemPublicId, showProvider);

        if (!ignore) {
          setItem(result.item);
          setAnnotation(initialAnnotation(result.item.annotations[0]));
        }
      } catch (error) {
        if (!ignore) {
          setStatus(error instanceof Error ? error.message : "Run item failed to load.");
        }
      }
    }

    void load();

    return () => {
      ignore = true;
    };
  }, [runItemPublicId, showProvider]);

  const safetyFlags = useMemo(() => {
    const safety = asRecord(item?.safety_validation_result);
    const flags = safety.critical_failure_flags;

    return Array.isArray(flags) ? flags.filter((flag): flag is string => typeof flag === "string") : [];
  }, [item]);

  async function save() {
    setStatus(null);
    setSaved(false);

    try {
      await saveEvalAnnotation(runItemPublicId, annotation);
      setSaved(true);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Annotation failed to save.");
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-accent">
              blind expert review
            </p>
            <h1 className="mt-2 text-2xl font-semibold text-ink">
              {item?.case_id ?? runItemPublicId}
            </h1>
            <p className="mt-2 text-sm text-muted">
              Provider and model are hidden by default during annotation.
            </p>
          </div>
          <div className="flex flex-wrap gap-3 text-sm">
            <label className="inline-flex items-center gap-2">
              <input
                checked={showReference}
                onChange={(event) => setShowReference(event.target.checked)}
                type="checkbox"
              />
              Show reference
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                checked={showProvider}
                onChange={(event) => setShowProvider(event.target.checked)}
                type="checkbox"
              />
              Show provider
            </label>
          </div>
        </div>
        {status ? <p className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{status}</p> : null}
        {saved ? <p className="mt-3 text-sm text-emerald-700">Annotation saved.</p> : null}
        <dl className="mt-5 grid gap-3 text-sm md:grid-cols-4">
          <div>
            <dt className="text-muted">Agent</dt>
            <dd>{item?.agent_name}</dd>
          </div>
          <div>
            <dt className="text-muted">Run mode</dt>
            <dd>{item?.run_mode}</dd>
          </div>
          <div>
            <dt className="text-muted">Provider</dt>
            <dd>{item?.provider ?? "hidden"}</dd>
          </div>
          <div>
            <dt className="text-muted">Model</dt>
            <dd>{item?.model_name ?? "hidden"}</dd>
          </div>
        </dl>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <article className="rounded-lg border border-line bg-white p-5 shadow-soft">
          <h2 className="text-lg font-semibold text-ink">Case input</h2>
          <div className="mt-3"><JsonBlock value={item?.input_payload ?? {}} /></div>
        </article>
        <article className="rounded-lg border border-line bg-white p-5 shadow-soft">
          <h2 className="text-lg font-semibold text-ink">Model output</h2>
          <div className="mt-3"><JsonBlock value={item?.parsed_output ?? item?.raw_output ?? {}} /></div>
        </article>
      </section>

      {showReference ? (
        <section className="grid gap-4 lg:grid-cols-2">
          <article className="rounded-lg border border-line bg-white p-5 shadow-soft">
            <h2 className="text-lg font-semibold text-ink">Expected and gold labels</h2>
            <div className="mt-3"><JsonBlock value={{ expected_output: item?.expected_output, gold_labels: item?.gold_labels }} /></div>
          </article>
          <article className="rounded-lg border border-line bg-white p-5 shadow-soft">
            <h2 className="text-lg font-semibold text-ink">Rubric and safety expectations</h2>
            <div className="mt-3"><JsonBlock value={{ rubric_expectations: item?.rubric_expectations, safety_expectations: item?.safety_expectations }} /></div>
          </article>
        </section>
      ) : null}

      <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
        <h2 className="text-lg font-semibold text-ink">Validation results</h2>
        <div className="mt-3 flex flex-wrap gap-3 text-sm">
          <StatusBadge value={item?.output_validated ?? false} />
          <StatusBadge value={asRecord(item?.semantic_validation_result).ok === true} />
          <StatusBadge value={asRecord(item?.safety_validation_result).ok === true} />
        </div>
        {safetyFlags.length ? (
          <p className="mt-3 text-sm text-muted">Critical flags: {safetyFlags.join(", ")}</p>
        ) : null}
      </section>

      <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
        <h2 className="text-lg font-semibold text-ink">Annotation</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <label className="text-sm">
            Overall rating
            <select
              className="mt-1 w-full rounded-md border border-line px-3 py-2"
              onChange={(event) =>
                setAnnotation((current) => ({
                  ...current,
                  overall_rating: event.target.value === "" ? null : Number(event.target.value)
                }))
              }
              value={annotation.overall_rating ?? ""}
            >
              <option value="">Unrated</option>
              {[0, 1, 2, 3].map((score) => (
                <option key={score} value={score}>{score}</option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Pass/fail
            <select
              className="mt-1 w-full rounded-md border border-line px-3 py-2"
              onChange={(event) =>
                setAnnotation((current) => ({
                  ...current,
                  pass_fail: event.target.value || null
                }))
              }
              value={annotation.pass_fail ?? ""}
            >
              <option value="">Unset</option>
              <option value="pass">Pass</option>
              <option value="fail">Fail</option>
              <option value="needs_review">Needs review</option>
            </select>
          </label>
          <label className="inline-flex items-end gap-2 text-sm">
            <input
              checked={annotation.blind_review}
              onChange={(event) =>
                setAnnotation((current) => ({ ...current, blind_review: event.target.checked }))
              }
              type="checkbox"
            />
            Blind review
          </label>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {rubricCriteria.map((criterion) => (
            <label className="text-sm" key={criterion}>
              {criterion}
              <select
                className="mt-1 w-full rounded-md border border-line px-3 py-2"
                onChange={(event) =>
                  setAnnotation((current) => ({
                    ...current,
                    rubric_scores: {
                      ...current.rubric_scores,
                      [criterion]: Number(event.target.value)
                    }
                  }))
                }
                value={annotation.rubric_scores[criterion] ?? 2}
              >
                {[0, 1, 2, 3].map((score) => (
                  <option key={score} value={score}>{score}</option>
                ))}
              </select>
            </label>
          ))}
        </div>

        <fieldset className="mt-5">
          <legend className="text-sm font-medium text-ink">Critical failure flags</legend>
          <div className="mt-2 grid gap-2 md:grid-cols-2">
            {criticalFailureOptions.map((flag) => (
              <label className="inline-flex items-center gap-2 text-sm text-muted" key={flag}>
                <input
                  checked={annotation.safety_flags.includes(flag)}
                  onChange={(event) =>
                    setAnnotation((current) => ({
                      ...current,
                      safety_flags: event.target.checked
                        ? [...new Set([...current.safety_flags, flag])]
                        : current.safety_flags.filter((entry) => entry !== flag)
                    }))
                  }
                  type="checkbox"
                />
                {flag}
              </label>
            ))}
          </div>
        </fieldset>

        <label className="mt-5 block text-sm">
          Notes
          <textarea
            className="mt-1 min-h-32 w-full rounded-md border border-line px-3 py-2"
            onChange={(event) =>
              setAnnotation((current) => ({ ...current, notes: event.target.value }))
            }
            value={annotation.notes}
          />
        </label>

        <button
          className="mt-4 rounded-md bg-accent px-3 py-2 text-sm font-semibold text-white"
          onClick={save}
          type="button"
        >
          Save annotation
        </button>
      </section>
    </div>
  );
}
