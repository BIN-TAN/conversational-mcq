"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, BookOpenCheck, Plus, Save, Sparkles, Trash2 } from "lucide-react";
import { apiRequest, errorFromUnknown } from "./api";
import type { StructuredApiError } from "./types";
import { Button, ErrorPanel, Field, LoadingRow, PageHeader, SuccessPanel } from "./ui";

type Objective = {
  objective_id: string;
  statement: string;
  evidence_requirements: string[];
};

type Misconception = {
  misconception_id: string;
  statement: string;
  linked_objective_ids: string[];
  student_language_examples: string[];
  why_plausible: string | null;
};

type Exemplar = {
  exemplar_id: string;
  item_text: string;
  observed_difficulty_note: string | null;
};

type Blueprint = {
  schema_version: "evidence-centered-item-design-v1";
  section_topic: string;
  section_summary: string;
  objectives: Objective[];
  misconception_hypotheses: Misconception[];
  exemplar_items: Exemplar[];
  generation_settings: {
    target_item_count: number;
    option_count: number;
    difficulty_mix: Array<"foundational" | "application" | "reasoning">;
    context_notes: string | null;
  };
};

type DesignResponse = {
  assessment: { assessment_public_id: string; title: string; status: string; is_editable: boolean };
  concept_unit_public_id: string;
  concept_unit_version: number;
  blueprint: Blueprint;
  blueprint_hash: string;
};

function localId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function lines(value: string) {
  return value.split("\n").map((entry) => entry.trim()).filter(Boolean);
}

export function ItemDesignClient({ assessmentPublicId }: { assessmentPublicId: string }) {
  const router = useRouter();
  const [design, setDesign] = useState<DesignResponse | null>(null);
  const [blueprint, setBlueprint] = useState<Blueprint | null>(null);
  const [error, setError] = useState<StructuredApiError | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState<"load" | "save" | "generate" | null>("load");

  const load = useCallback(async () => {
    setBusy("load");
    setError(null);
    try {
      const response = await apiRequest<DesignResponse>(
        `/api/teacher/assessments/${assessmentPublicId}/item-design`
      );
      setDesign(response);
      setBlueprint(response.blueprint);
    } catch (caught) {
      setError(errorFromUnknown(caught));
    } finally {
      setBusy(null);
    }
  }, [assessmentPublicId]);

  useEffect(() => { void load(); }, [load]);

  function updateBlueprint(updater: (current: Blueprint) => Blueprint) {
    setBlueprint((current) => current ? updater(current) : current);
  }

  async function saveBlueprint(showMessage = true) {
    if (!blueprint || !design) return null;
    setError(null);
    setSuccess(null);
    const response = await apiRequest<DesignResponse>(
      `/api/teacher/assessments/${assessmentPublicId}/item-design`,
      {
        method: "PUT",
        body: JSON.stringify({
          expected_concept_unit_version: design.concept_unit_version,
          blueprint
        })
      }
    );
    setDesign(response);
    setBlueprint(response.blueprint);
    if (showMessage) setSuccess("Assessment design saved.");
    return response;
  }

  async function handleSave() {
    setBusy("save");
    try {
      await saveBlueprint();
    } catch (caught) {
      setError(errorFromUnknown(caught));
    } finally {
      setBusy(null);
    }
  }

  async function handleGenerate() {
    setBusy("generate");
    try {
      const saved = await saveBlueprint(false);
      if (!saved) return;
      const generated = await apiRequest<{ review_url: string }>(
        `/api/teacher/assessments/${assessmentPublicId}/item-design/generate`,
        {
          method: "POST",
          body: JSON.stringify({ expected_blueprint_hash: saved.blueprint_hash, mode: "live" })
        }
      );
      router.push(generated.review_url);
    } catch (caught) {
      setError(errorFromUnknown(caught));
    } finally {
      setBusy(null);
    }
  }

  const readOnly = !design?.assessment.is_editable;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Design assessment items"
        actions={
          <a
            className="inline-flex h-10 items-center gap-2 rounded-md border border-line bg-white px-4 text-sm font-semibold text-ink transition hover:border-accent"
            href={`/teacher/content/assessments/${assessmentPublicId}`}
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Return to mini test
          </a>
        }
      />

      <ErrorPanel error={error} />
      <SuccessPanel message={success} />
      {busy === "load" ? <LoadingRow label="Loading assessment design" /> : null}

      {blueprint && design ? (
        <>
          <section className="border-y border-line bg-emerald-50 px-5 py-4 text-sm leading-6 text-emerald-950">
            <div className="flex gap-3">
              <BookOpenCheck className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
              <p>
                Define what students should understand and what evidence would demonstrate it. The assistant creates draft items only. You confirm every answer key, revise the wording, and choose what enters the mini test.
              </p>
            </div>
          </section>

          <section className="space-y-5 border-b border-line pb-7">
            <div>
              <h2 className="text-xl font-semibold text-ink">1. Section and learning goals</h2>
              <p className="mt-1 text-sm leading-6 text-muted">Keep one mini test focused on one related topic or section.</p>
            </div>
            <Field label="Section or topic">
              <input
                className="rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
                disabled={readOnly}
                onChange={(event) => updateBlueprint((current) => ({ ...current, section_topic: event.target.value }))}
                value={blueprint.section_topic}
              />
            </Field>
            <Field label="What this section covers">
              <textarea
                className="min-h-28 rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
                disabled={readOnly}
                onChange={(event) => updateBlueprint((current) => ({ ...current, section_summary: event.target.value }))}
                value={blueprint.section_summary}
              />
            </Field>

            <div className="space-y-4">
              {blueprint.objectives.map((objective, index) => (
                <article className="rounded-md border border-line p-4" key={objective.objective_id}>
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="font-semibold text-ink">Learning objective {index + 1}</h3>
                    <Button
                      aria-label={`Remove learning objective ${index + 1}`}
                      disabled={readOnly || blueprint.objectives.length === 1}
                      onClick={() => updateBlueprint((current) => ({
                        ...current,
                        objectives: current.objectives.filter((entry) => entry.objective_id !== objective.objective_id),
                        misconception_hypotheses: current.misconception_hypotheses.map((entry) => ({
                          ...entry,
                          linked_objective_ids: entry.linked_objective_ids.filter((id) => id !== objective.objective_id)
                        })).filter((entry) => entry.linked_objective_ids.length > 0)
                      }))}
                      type="button"
                      variant="secondary"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </div>
                  <div className="mt-4 grid gap-4">
                    <Field label="What should students know or be able to do?">
                      <textarea
                        className="min-h-20 rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
                        disabled={readOnly}
                        onChange={(event) => updateBlueprint((current) => ({
                          ...current,
                          objectives: current.objectives.map((entry) => entry.objective_id === objective.objective_id ? { ...entry, statement: event.target.value } : entry)
                        }))}
                        value={objective.statement}
                      />
                    </Field>
                    <Field label="What observable evidence would demonstrate this?" hint="Enter one evidence requirement per line.">
                      <textarea
                        className="min-h-24 rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
                        disabled={readOnly}
                        onChange={(event) => updateBlueprint((current) => ({
                          ...current,
                          objectives: current.objectives.map((entry) => entry.objective_id === objective.objective_id ? { ...entry, evidence_requirements: lines(event.target.value) } : entry)
                        }))}
                        value={objective.evidence_requirements.join("\n")}
                      />
                    </Field>
                  </div>
                </article>
              ))}
              <Button
                disabled={readOnly || blueprint.objectives.length >= 12}
                onClick={() => updateBlueprint((current) => ({
                  ...current,
                  objectives: [...current.objectives, {
                    objective_id: localId("objective"),
                    statement: "",
                    evidence_requirements: [""]
                  }]
                }))}
                type="button"
                variant="secondary"
              >
                <Plus className="h-4 w-4" aria-hidden="true" /> Add learning objective
              </Button>
            </div>
          </section>

          <section className="space-y-5 border-b border-line pb-7">
            <div>
              <h2 className="text-xl font-semibold text-ink">2. Misconception examples</h2>
              <p className="mt-1 text-sm leading-6 text-muted">These are hypotheses the items should probe, not labels automatically assigned to students.</p>
            </div>
            {blueprint.misconception_hypotheses.map((misconception, index) => (
              <article className="rounded-md border border-line p-4" key={misconception.misconception_id}>
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-semibold text-ink">Misconception example {index + 1}</h3>
                  <Button
                    aria-label={`Remove misconception example ${index + 1}`}
                    disabled={readOnly}
                    onClick={() => updateBlueprint((current) => ({
                      ...current,
                      misconception_hypotheses: current.misconception_hypotheses.filter((entry) => entry.misconception_id !== misconception.misconception_id)
                    }))}
                    type="button"
                    variant="secondary"
                  ><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>
                </div>
                <div className="mt-4 grid gap-4">
                  <Field label="Misconception statement">
                    <textarea
                      className="min-h-20 rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
                      disabled={readOnly}
                      onChange={(event) => updateBlueprint((current) => ({
                        ...current,
                        misconception_hypotheses: current.misconception_hypotheses.map((entry) => entry.misconception_id === misconception.misconception_id ? { ...entry, statement: event.target.value } : entry)
                      }))}
                      value={misconception.statement}
                    />
                  </Field>
                  <Field label="Related learning objectives">
                    <div className="flex flex-wrap gap-3">
                      {blueprint.objectives.map((objective, objectiveIndex) => (
                        <label className="flex items-center gap-2 text-sm text-ink" key={objective.objective_id}>
                          <input
                            checked={misconception.linked_objective_ids.includes(objective.objective_id)}
                            disabled={readOnly}
                            onChange={(event) => updateBlueprint((current) => ({
                              ...current,
                              misconception_hypotheses: current.misconception_hypotheses.map((entry) => entry.misconception_id === misconception.misconception_id ? {
                                ...entry,
                                linked_objective_ids: event.target.checked
                                  ? [...entry.linked_objective_ids, objective.objective_id]
                                  : entry.linked_objective_ids.filter((id) => id !== objective.objective_id)
                              } : entry)
                            }))}
                            type="checkbox"
                          /> Objective {objectiveIndex + 1}
                        </label>
                      ))}
                    </div>
                  </Field>
                  <Field label="How students may express this idea" hint="Enter one example per line.">
                    <textarea
                      className="min-h-20 rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
                      disabled={readOnly}
                      onChange={(event) => updateBlueprint((current) => ({
                        ...current,
                        misconception_hypotheses: current.misconception_hypotheses.map((entry) => entry.misconception_id === misconception.misconception_id ? { ...entry, student_language_examples: lines(event.target.value) } : entry)
                      }))}
                      value={misconception.student_language_examples.join("\n")}
                    />
                  </Field>
                  <Field label="Why might this seem plausible?" hint="Optional teacher context.">
                    <textarea
                      className="min-h-20 rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
                      disabled={readOnly}
                      onChange={(event) => updateBlueprint((current) => ({
                        ...current,
                        misconception_hypotheses: current.misconception_hypotheses.map((entry) => entry.misconception_id === misconception.misconception_id ? { ...entry, why_plausible: event.target.value || null } : entry)
                      }))}
                      value={misconception.why_plausible ?? ""}
                    />
                  </Field>
                </div>
              </article>
            ))}
            <Button
              disabled={readOnly || blueprint.misconception_hypotheses.length >= 20}
              onClick={() => updateBlueprint((current) => ({
                ...current,
                misconception_hypotheses: [...current.misconception_hypotheses, {
                  misconception_id: localId("misconception"),
                  statement: "",
                  linked_objective_ids: [current.objectives[0]!.objective_id],
                  student_language_examples: [],
                  why_plausible: null
                }]
              }))}
              type="button"
              variant="secondary"
            ><Plus className="h-4 w-4" aria-hidden="true" /> Add misconception example</Button>
          </section>

          <section className="space-y-5 border-b border-line pb-7">
            <div>
              <h2 className="text-xl font-semibold text-ink">3. Exemplar items and draft settings</h2>
              <p className="mt-1 text-sm leading-6 text-muted">Paste difficult prior items as design evidence. The assistant must not copy them verbatim.</p>
            </div>
            {blueprint.exemplar_items.map((exemplar, index) => (
              <article className="rounded-md border border-line p-4" key={exemplar.exemplar_id}>
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-semibold text-ink">Exemplar {index + 1}</h3>
                  <Button
                    aria-label={`Remove exemplar ${index + 1}`}
                    disabled={readOnly}
                    onClick={() => updateBlueprint((current) => ({ ...current, exemplar_items: current.exemplar_items.filter((entry) => entry.exemplar_id !== exemplar.exemplar_id) }))}
                    type="button"
                    variant="secondary"
                  ><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>
                </div>
                <div className="mt-4 grid gap-4">
                  <Field label="Exemplar item">
                    <textarea
                      className="min-h-28 rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
                      disabled={readOnly}
                      onChange={(event) => updateBlueprint((current) => ({ ...current, exemplar_items: current.exemplar_items.map((entry) => entry.exemplar_id === exemplar.exemplar_id ? { ...entry, item_text: event.target.value } : entry) }))}
                      value={exemplar.item_text}
                    />
                  </Field>
                  <Field label="What made this item difficult or useful?" hint="Optional. A high wrong-answer rate alone does not establish a misconception.">
                    <textarea
                      className="min-h-20 rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
                      disabled={readOnly}
                      onChange={(event) => updateBlueprint((current) => ({ ...current, exemplar_items: current.exemplar_items.map((entry) => entry.exemplar_id === exemplar.exemplar_id ? { ...entry, observed_difficulty_note: event.target.value || null } : entry) }))}
                      value={exemplar.observed_difficulty_note ?? ""}
                    />
                  </Field>
                </div>
              </article>
            ))}
            <Button
              disabled={readOnly || blueprint.exemplar_items.length >= 12}
              onClick={() => updateBlueprint((current) => ({ ...current, exemplar_items: [...current.exemplar_items, { exemplar_id: localId("exemplar"), item_text: "", observed_difficulty_note: null }] }))}
              type="button"
              variant="secondary"
            ><Plus className="h-4 w-4" aria-hidden="true" /> Add exemplar item</Button>

            <div className="grid gap-4 border-t border-line pt-5 md:grid-cols-2">
              <Field label="Number of draft items" hint="6-9 is a useful starting point. The current validated range is 3-12.">
                <input
                  className="rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
                  disabled={readOnly}
                  max={12}
                  min={3}
                  onChange={(event) => updateBlueprint((current) => ({ ...current, generation_settings: { ...current.generation_settings, target_item_count: Number(event.target.value) } }))}
                  type="number"
                  value={blueprint.generation_settings.target_item_count}
                />
              </Field>
              <Field label="Options per item">
                <select
                  className="rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
                  disabled={readOnly}
                  onChange={(event) => updateBlueprint((current) => ({ ...current, generation_settings: { ...current.generation_settings, option_count: Number(event.target.value) } }))}
                  value={blueprint.generation_settings.option_count}
                >
                  <option value={3}>3</option><option value={4}>4</option><option value={5}>5</option>
                </select>
              </Field>
              <Field label="Difficulty and reasoning mix">
                <div className="flex flex-wrap gap-3">
                  {(["foundational", "application", "reasoning"] as const).map((level) => (
                    <label className="flex items-center gap-2 text-sm capitalize text-ink" key={level}>
                      <input
                        checked={blueprint.generation_settings.difficulty_mix.includes(level)}
                        disabled={readOnly}
                        onChange={(event) => updateBlueprint((current) => ({
                          ...current,
                          generation_settings: {
                            ...current.generation_settings,
                            difficulty_mix: event.target.checked
                              ? [...current.generation_settings.difficulty_mix, level]
                              : current.generation_settings.difficulty_mix.filter((entry) => entry !== level)
                          }
                        }))}
                        type="checkbox"
                      /> {level}
                    </label>
                  ))}
                </div>
              </Field>
              <Field label="Contexts or boundaries" hint="Optional examples, terminology, exclusions, or course conventions.">
                <textarea
                  className="min-h-24 rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
                  disabled={readOnly}
                  onChange={(event) => updateBlueprint((current) => ({ ...current, generation_settings: { ...current.generation_settings, context_notes: event.target.value || null } }))}
                  value={blueprint.generation_settings.context_notes ?? ""}
                />
              </Field>
            </div>
          </section>

          <section className="flex flex-col gap-3 border-t border-line pt-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="max-w-2xl text-sm leading-6 text-muted">
              Generated items remain draft candidates. Nothing is added to the mini test until you review, confirm the key, and import it.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button disabled={readOnly || busy !== null} onClick={handleSave} type="button" variant="secondary">
                <Save className="h-4 w-4" aria-hidden="true" /> {busy === "save" ? "Saving" : "Save design"}
              </Button>
              <Button disabled={readOnly || busy !== null} onClick={handleGenerate} type="button">
                <Sparkles className="h-4 w-4" aria-hidden="true" /> {busy === "generate" ? "Generating drafts" : "Save and generate drafts"}
              </Button>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
