"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, Plus, Save, Trash2 } from "lucide-react";
import { apiRequest, errorFromUnknown } from "./api";
import {
  arrayToLines,
  linesToArray,
  normalizeOptions,
  normalizeRationales,
  parseJsonObject,
  stringifyJson
} from "./form-utils";
import {
  buildDistractorRationalesFromTeacherNotes,
  buildItemAdministrationRulesFromTeacherMetadata,
  ITEM_PURPOSE_OPTIONS,
  readTeacherItemMetadata,
  type TeacherDiagnosticOptionNote
} from "@/lib/services/content/teacher-diagnostic-context";
import type { ItemDetail, ItemOption, StructuredApiError } from "./types";
import {
  Button,
  ContentStateBadge,
  ErrorPanel,
  Field,
  LoadingRow,
  PageHeader,
  StatusBadge,
  SuccessPanel
} from "./ui";

type ItemResponse = {
  item: ItemDetail;
};

type OptionNoteDraft = Omit<TeacherDiagnosticOptionNote, "label">;

type ItemEditorProps =
  | {
      mode: "create";
      conceptUnitPublicId: string;
    }
  | {
      mode: "edit";
      itemPublicId: string;
    };

export function ItemEditorClient(props: ItemEditorProps) {
  const router = useRouter();
  const itemPublicId = props.mode === "edit" ? props.itemPublicId : null;
  const conceptUnitPublicId = props.mode === "create" ? props.conceptUnitPublicId : null;
  const [item, setItem] = useState<ItemDetail | null>(null);
  const [itemLabel, setItemLabel] = useState("");
  const [itemPurpose, setItemPurpose] = useState("initial_item");
  const [itemStem, setItemStem] = useState("");
  const [options, setOptions] = useState<ItemOption[]>([
    { label: "A", text: "" },
    { label: "B", text: "" },
    { label: "C", text: "" },
    { label: "D", text: "" }
  ]);
  const [correctOption, setCorrectOption] = useState("A");
  const [distractorRationales, setDistractorRationales] = useState<Record<string, string>>({});
  const [expectedReasoningNote, setExpectedReasoningNote] = useState("");
  const [itemDiagnosticValueNote, setItemDiagnosticValueNote] = useState("");
  const [targetReasoningNote, setTargetReasoningNote] = useState("");
  const [strongReasoningNote, setStrongReasoningNote] = useState("");
  const [weakCorrectnessNote, setWeakCorrectnessNote] = useState("");
  const [optionNotes, setOptionNotes] = useState<Record<string, OptionNoteDraft>>({});
  const [expectedReasoning, setExpectedReasoning] = useState("");
  const [misconceptionIndicators, setMisconceptionIndicators] = useState("");
  const [administrationRules, setAdministrationRules] = useState("{}");
  const [itemOrder, setItemOrder] = useState("");
  const [includedInPublishedSet, setIncludedInPublishedSet] = useState(true);
  const [error, setError] = useState<StructuredApiError | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(props.mode === "edit");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);

  const optionLabels = useMemo(
    () => options.map((option) => option.label.trim()).filter(Boolean),
    [options]
  );

  const loadItem = useCallback(async () => {
    if (!itemPublicId) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const data = await apiRequest<ItemResponse>(`/api/teacher/items/${itemPublicId}`);
      const loaded = data.item;
      setItem(loaded);
      setItemStem(loaded.item_stem);
      setOptions(normalizeOptions(loaded.options));
      setCorrectOption(loaded.correct_option);
      setDistractorRationales(normalizeRationales(loaded.distractor_rationales));
      setExpectedReasoning(arrayToLines(loaded.expected_reasoning_patterns));
      setMisconceptionIndicators(arrayToLines(loaded.possible_misconception_indicators));
      setAdministrationRules(stringifyJson(loaded.administration_rules));
      setItemOrder(String(loaded.item_order));
      setIncludedInPublishedSet(loaded.included_in_published_set);
      const metadata = readTeacherItemMetadata(loaded.administration_rules);
      setItemLabel(metadata.item_label);
      setItemPurpose(metadata.item_purpose);
      setExpectedReasoningNote(metadata.expected_reasoning_note);
      setItemDiagnosticValueNote(metadata.item_diagnostic_value_note);
      setTargetReasoningNote(metadata.correct_option_notes.target_reasoning_note ?? "");
      setStrongReasoningNote(metadata.correct_option_notes.strong_reasoning_should_mention ?? "");
      setWeakCorrectnessNote(
        metadata.correct_option_notes.weak_unsupported_correctness_looks_like ?? ""
      );
      setOptionNotes(
        Object.fromEntries(
          metadata.option_notes.map((note) => {
            const { label, ...rest } = note;
            return [label, rest];
          })
        )
      );
    } catch (caught) {
      setError(errorFromUnknown(caught));
    } finally {
      setIsLoading(false);
    }
  }, [itemPublicId]);

  useEffect(() => {
    void loadItem();
  }, [loadItem]);

  function updateOption(index: number, patch: Partial<ItemOption>) {
    setOptions((current) =>
      current.map((option, optionIndex) =>
        optionIndex === index ? { ...option, ...patch } : option
      )
    );
  }

  function addOption() {
    const nextLabel = String.fromCharCode(65 + options.length);
    setOptions((current) => [...current, { label: nextLabel, text: "" }]);
  }

  function removeOption(index: number) {
    const label = options[index]?.label;
    setOptions((current) => current.filter((_, optionIndex) => optionIndex !== index));
    if (label === correctOption) {
      setCorrectOption("");
    }
    setDistractorRationales((current) => {
      const next = { ...current };
      delete next[label];
      return next;
    });
    setOptionNotes((current) => {
      const next = { ...current };
      delete next[label];
      return next;
    });
  }

  function updateOptionNote(label: string, patch: Partial<OptionNoteDraft>) {
    setOptionNotes((current) => ({
      ...current,
      [label]: {
        ...(current[label] ?? {}),
        ...patch
      }
    }));
  }

  function validateClientInput(): StructuredApiError | null {
    const labels = options.map((option) => option.label.trim()).filter(Boolean);

    if (options.length < 2 || options.length > 6) {
      return {
        code: "validation_failed",
        message: "Items must have 2 to 6 options."
      };
    }

    if (new Set(labels).size !== labels.length) {
      return {
        code: "validation_failed",
        message: "Option labels must be unique.",
        details: { issues: [{ path: "options", message: "Duplicate option label." }] }
      };
    }

    if (!labels.includes(correctOption)) {
      return {
        code: "validation_failed",
        message: "Correct option must match one option label.",
        details: { issues: [{ path: "correct_option", message: "Choose an existing option label." }] }
      };
    }

    return null;
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (!isEditable) {
      setError({
        code: "published_content_must_return_to_draft_before_editing",
        message: "Return the topic to draft before editing this item."
      });
      return;
    }

    const clientError = validateClientInput();
    if (clientError) {
      setError(clientError);
      return;
    }

    setIsSubmitting(true);

    try {
      const teacherOptionNotes: TeacherDiagnosticOptionNote[] = optionLabels.map((label) => ({
        label,
        ...(optionNotes[label] ?? {})
      }));
      const advancedRules = parseJsonObject(administrationRules, "Advanced settings");
      const administration_rules = buildItemAdministrationRulesFromTeacherMetadata({
        administration_rules: advancedRules,
        metadata: {
          item_label: itemLabel,
          item_purpose: itemPurpose,
          expected_reasoning_note: expectedReasoningNote,
          item_diagnostic_value_note: itemDiagnosticValueNote,
          correct_option_notes: {
            target_reasoning_note: targetReasoningNote,
            strong_reasoning_should_mention: strongReasoningNote,
            weak_unsupported_correctness_looks_like: weakCorrectnessNote
          },
          option_notes: teacherOptionNotes
        }
      });
      const expectedReasoningPatterns = linesToArray(expectedReasoning);
      const misconceptionIndicatorLines = linesToArray(misconceptionIndicators);
      const derivedExpectedReasoning = [
        expectedReasoningNote,
        targetReasoningNote,
        strongReasoningNote
      ]
        .map((entry) => entry.trim())
        .filter(Boolean);
      const derivedMisconceptions = teacherOptionNotes
        .flatMap((note) => [
          note.misconception_reasoning_pattern,
          note.strengthens_hypothesis,
          note.weakens_hypothesis
        ])
        .map((entry) => entry?.trim() ?? "")
        .filter(Boolean);
      const payload = {
        item_stem: itemStem,
        options: options.map((option) => ({
          label: option.label.trim(),
          text: option.text
        })),
        correct_option: correctOption,
        distractor_rationales: buildDistractorRationalesFromTeacherNotes({
          option_labels: optionLabels,
          correct_option: correctOption,
          existing_rationales: distractorRationales,
          option_notes: teacherOptionNotes
        }),
        expected_reasoning_patterns:
          expectedReasoningPatterns.length > 0
            ? expectedReasoningPatterns
            : derivedExpectedReasoning,
        possible_misconception_indicators:
          misconceptionIndicatorLines.length > 0
            ? misconceptionIndicatorLines
            : derivedMisconceptions,
        administration_rules,
        included_in_published_set: includedInPublishedSet
      };

      if (conceptUnitPublicId) {
        const data = await apiRequest<ItemResponse>(
          `/api/teacher/concept-units/${conceptUnitPublicId}/items`,
          {
            method: "POST",
            body: JSON.stringify({
              ...payload,
              item_order: itemOrder ? Number(itemOrder) : undefined
            })
          }
        );
        router.push(`/teacher/content/items/${data.item.item_public_id}`);
        return;
      }

      if (!itemPublicId) {
        throw new Error("Item public ID is required for updates.");
      }

      const data = await apiRequest<ItemResponse>(`/api/teacher/items/${itemPublicId}`, {
        method: "PUT",
        body: JSON.stringify(payload)
      });
      setItem(data.item);
      setSuccess("Item saved. Version increments when content changes.");
      await loadItem();
    } catch (caught) {
      setError(errorFromUnknown(caught));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function archiveItem() {
    if (!itemPublicId) {
      return;
    }

    setIsArchiving(true);
    setError(null);
    setSuccess(null);

    try {
      await apiRequest(`/api/teacher/items/${itemPublicId}/archive`, { method: "POST" });
      setSuccess("Item archived.");
      await loadItem();
    } catch (caught) {
      setError(errorFromUnknown(caught));
    } finally {
      setIsArchiving(false);
    }
  }

  const title = props.mode === "create" ? "Add MCQ item" : "MCQ item editor";
  const isEditable =
    props.mode === "create" ||
    Boolean(
      item &&
        item.content_state === "draft_editable" &&
        item.concept_unit_status === "draft" &&
        item.status !== "archived"
    );
  const readOnlyReason = item?.is_content_locked
    ? "Student data collection has started. The administered content is now read-only to preserve research consistency."
    : item?.concept_unit_status === "published"
      ? "Return the topic to draft before editing published items."
      : item?.status === "archived"
        ? "Archived items are preserved for records and are not editable."
        : "Return the parent assessment to draft before editing this item.";

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="MCQ item"
        title={title}
        description="Build one MCQ item with teacher-only diagnostic notes for interpretation."
      />

      <ErrorPanel error={error} />
      <SuccessPanel message={success} />

      {isLoading ? <LoadingRow label="Loading item" /> : null}

      {!isLoading ? (
        <form className="space-y-6" onSubmit={onSubmit}>
          <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
            {item ? (
              <div className="mb-5 flex flex-wrap items-center gap-3">
                <StatusBadge status={item.status} />
                {item.content_state ? <ContentStateBadge state={item.content_state} /> : null}
                <span className={`inline-flex rounded-md border px-2 py-1 text-xs font-semibold ${item.included_in_published_set ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-slate-50 text-slate-700"}`}>
                  {item.included_in_published_set ? "included" : "candidate"}
                </span>
                <span className="font-mono text-xs text-muted">{item.item_public_id}</span>
                <span className="text-xs text-muted">Version {item.version}</span>
                <span className="text-xs text-muted">Order {item.item_order}</span>
              </div>
            ) : null}
            {!isEditable && item ? (
              <p className="mb-5 rounded-md border border-line bg-slate-50 p-3 text-sm leading-6 text-muted">
                {readOnlyReason}
              </p>
            ) : null}

            <div className="grid gap-4">
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Item title / short label">
                  <input
                    className="rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
                    disabled={!isEditable}
                    onChange={(event) => setItemLabel(event.target.value)}
                    placeholder="e.g. Theta scale boundary"
                    value={itemLabel}
                  />
                </Field>
                <Field label="Item purpose / use">
                  <select
                    className="rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
                    disabled={!isEditable}
                    onChange={(event) => setItemPurpose(event.target.value)}
                    value={itemPurpose}
                  >
                    {ITEM_PURPOSE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              <Field label="Stem">
                <textarea
                  className="min-h-28 rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
                  disabled={!isEditable}
                  onChange={(event) => setItemStem(event.target.value)}
                  required
                  value={itemStem}
                />
              </Field>

              <label className="flex items-start gap-3 rounded-md border border-line bg-slate-50 p-3 text-sm text-ink">
                <input
                  checked={includedInPublishedSet}
                  className="mt-1 h-4 w-4"
                  disabled={!isEditable}
                  onChange={(event) => setIncludedInPublishedSet(event.target.checked)}
                  type="checkbox"
                />
                <span>
                  <span className="block font-semibold">Include in published set</span>
                  <span className="block text-muted">
                    Candidate items may stay in the topic. Publishing counts only included active items.
                  </span>
                </span>
              </label>

              {props.mode === "create" ? (
                <Field label="Item order">
                  <input
                    className="rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
                    disabled={!isEditable}
                    min={1}
                    onChange={(event) => setItemOrder(event.target.value)}
                    type="number"
                    value={itemOrder}
                  />
                </Field>
              ) : null}
            </div>
          </section>

          <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
            <div className="flex flex-col gap-3 border-b border-line pb-4 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-xl font-semibold text-ink">Options</h2>
                <p className="mt-1 text-sm text-muted">Use A-D by default. Add E only when the item needs it.</p>
              </div>
              <Button disabled={!isEditable || options.length >= 5} onClick={addOption} type="button" variant="secondary">
                <Plus className="h-4 w-4" aria-hidden="true" />
                Add option
              </Button>
            </div>

            <div className="mt-5 space-y-3">
              {options.map((option, index) => (
                <div className="grid gap-3 rounded-lg border border-line p-3 md:grid-cols-[100px_minmax(0,1fr)_auto]" key={index}>
                  <Field label="Label">
                    <input
                      className="rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
                      disabled={!isEditable}
                      onChange={(event) => updateOption(index, { label: event.target.value })}
                      required
                      value={option.label}
                    />
                  </Field>
                  <Field label="Text">
                    <input
                      className="rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
                      disabled={!isEditable}
                      onChange={(event) => updateOption(index, { text: event.target.value })}
                      required
                      value={option.text}
                    />
                  </Field>
                  <div className="flex items-end">
                    <Button
                      aria-label="Remove option"
                      disabled={!isEditable || options.length <= 2}
                      onClick={() => removeOption(index)}
                      type="button"
                      variant="danger"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-5 max-w-sm">
              <Field label="Correct option (teacher-only)">
                <select
                  className="rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
                  disabled={!isEditable}
                  onChange={(event) => setCorrectOption(event.target.value)}
                  required
                  value={correctOption}
                >
                  <option value="">Select option</option>
                  {optionLabels.map((label) => (
                    <option key={label} value={label}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </section>

          <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
            <h2 className="text-xl font-semibold text-ink">Correct-option reasoning notes</h2>
            <p className="mt-1 text-sm text-muted">
              Teacher-only guidance. Students never see the answer key or these notes.
            </p>
            <div className="mt-5 grid gap-4">
              <Field label="Target reasoning note">
                <textarea
                  className="min-h-20 rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
                  disabled={!isEditable}
                  onChange={(event) => setTargetReasoningNote(event.target.value)}
                  value={targetReasoningNote}
                />
              </Field>
              <Field label="Strong reasoning should mention">
                <textarea
                  className="min-h-20 rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
                  disabled={!isEditable}
                  onChange={(event) => setStrongReasoningNote(event.target.value)}
                  value={strongReasoningNote}
                />
              </Field>
              <Field label="Weak or unsupported correctness looks like">
                <textarea
                  className="min-h-20 rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
                  disabled={!isEditable}
                  onChange={(event) => setWeakCorrectnessNote(event.target.value)}
                  value={weakCorrectnessNote}
                />
              </Field>
            </div>
          </section>

          <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
            <h2 className="text-xl font-semibold text-ink">Item diagnostic notes</h2>
            <p className="mt-1 text-sm text-muted">
              Teacher-only interpretation notes for later LLM-supported review. They are guidance, not ground truth.
            </p>
            <div className="mt-5 grid gap-4">
              <Field label="Expected reasoning note">
                <textarea
                  className="min-h-24 rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
                  disabled={!isEditable}
                  onChange={(event) => setExpectedReasoningNote(event.target.value)}
                  value={expectedReasoningNote}
                />
              </Field>
              <Field label="Item diagnostic value note">
                <textarea
                  className="min-h-24 rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
                  disabled={!isEditable}
                  onChange={(event) => setItemDiagnosticValueNote(event.target.value)}
                  value={itemDiagnosticValueNote}
                />
              </Field>
            </div>
          </section>

          <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
            <h2 className="text-xl font-semibold text-ink">Distractor diagnostic notes</h2>
            <p className="mt-1 text-sm text-muted">
              Add notes for incorrect options. The optional student-safe hint is stored for future derived feedback, not shown during initial administration.
            </p>
            <div className="mt-5 space-y-5">
              {optionLabels
                .filter((label) => label !== correctOption)
                .map((label) => (
                  <div className="rounded-lg border border-line bg-slate-50 p-4" key={label}>
                    <h3 className="font-semibold text-ink">Option {label}</h3>
                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                      <Field label="Distractor diagnostic value">
                        <textarea
                          className="min-h-20 rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
                          disabled={!isEditable}
                          onChange={(event) =>
                            updateOptionNote(label, { distractor_diagnostic_value: event.target.value })
                          }
                          value={optionNotes[label]?.distractor_diagnostic_value ?? ""}
                        />
                      </Field>
                      <Field label="Why tempting">
                        <textarea
                          className="min-h-20 rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
                          disabled={!isEditable}
                          onChange={(event) =>
                            updateOptionNote(label, { why_tempting: event.target.value })
                          }
                          value={optionNotes[label]?.why_tempting ?? ""}
                        />
                      </Field>
                      <Field label="Misconception or reasoning pattern">
                        <textarea
                          className="min-h-20 rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
                          disabled={!isEditable}
                          onChange={(event) =>
                            updateOptionNote(label, {
                              misconception_reasoning_pattern: event.target.value
                            })
                          }
                          value={optionNotes[label]?.misconception_reasoning_pattern ?? ""}
                        />
                      </Field>
                      <Field label="Strengthens hypothesis">
                        <textarea
                          className="min-h-20 rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
                          disabled={!isEditable}
                          onChange={(event) =>
                            updateOptionNote(label, { strengthens_hypothesis: event.target.value })
                          }
                          value={optionNotes[label]?.strengthens_hypothesis ?? ""}
                        />
                      </Field>
                      <Field label="Weakens hypothesis">
                        <textarea
                          className="min-h-20 rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
                          disabled={!isEditable}
                          onChange={(event) =>
                            updateOptionNote(label, { weakens_hypothesis: event.target.value })
                          }
                          value={optionNotes[label]?.weakens_hypothesis ?? ""}
                        />
                      </Field>
                      <Field label="Follow-up probe suggestion">
                        <textarea
                          className="min-h-20 rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
                          disabled={!isEditable}
                          onChange={(event) =>
                            updateOptionNote(label, { follow_up_probe_suggestion: event.target.value })
                          }
                          value={optionNotes[label]?.follow_up_probe_suggestion ?? ""}
                        />
                      </Field>
                    </div>
                    <div className="mt-4">
                      <Field label="Student-safe feedback hint (optional)">
                        <textarea
                          className="min-h-20 rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
                          disabled={!isEditable}
                          onChange={(event) =>
                            updateOptionNote(label, { student_safe_feedback_hint: event.target.value })
                          }
                          value={optionNotes[label]?.student_safe_feedback_hint ?? ""}
                        />
                      </Field>
                    </div>
                    <details className="mt-4 rounded-md border border-line bg-white p-3">
                      <summary className="cursor-pointer text-sm font-semibold text-ink">
                        Legacy distractor rationale
                      </summary>
                      <div className="mt-3">
                        <Field label={`Option ${label} rationale`} hint="Used by existing publish validation. If blank, the diagnostic notes above derive a rationale.">
                          <textarea
                            className="min-h-20 rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
                            disabled={!isEditable}
                            onChange={(event) =>
                              setDistractorRationales((current) => ({
                                ...current,
                                [label]: event.target.value
                              }))
                            }
                            value={distractorRationales[label] ?? ""}
                          />
                        </Field>
                      </div>
                    </details>
                  </div>
                ))}
            </div>
          </section>

          <details className="rounded-lg border border-line bg-white p-5 shadow-soft">
            <summary className="cursor-pointer text-lg font-semibold text-ink">
              Advanced publishing metadata
            </summary>
            <div className="mt-5 grid gap-6 lg:grid-cols-2">
              <Field
                label="Expected reasoning patterns"
                hint="One pattern per line. If blank, the guided notes above are used."
              >
                <textarea
                  className="min-h-40 rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
                  disabled={!isEditable}
                  onChange={(event) => setExpectedReasoning(event.target.value)}
                  value={expectedReasoning}
                />
              </Field>
              <Field
                label="Possible misconception indicators"
                hint="One indicator per line. If blank, distractor notes above are used."
              >
                <textarea
                  className="min-h-40 rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
                  disabled={!isEditable}
                  onChange={(event) => setMisconceptionIndicators(event.target.value)}
                  value={misconceptionIndicators}
                />
              </Field>
            </div>
            <div className="mt-5">
              <Field label="Administration rules JSON" hint="Optional advanced JSON object. Guided fields above are preferred.">
                <textarea
                  className="min-h-28 rounded-md border border-line px-3 py-2 font-mono text-sm outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
                  disabled={!isEditable}
                  onChange={(event) => setAdministrationRules(event.target.value)}
                  value={administrationRules}
                />
              </Field>
            </div>
          </details>

          <div className="flex flex-wrap gap-2">
            <Button disabled={!isEditable || isSubmitting} type="submit">
              <Save className="h-4 w-4" aria-hidden="true" />
              {isSubmitting ? "Saving" : props.mode === "create" ? "Add MCQ item" : "Save item"}
            </Button>
            {props.mode === "edit" ? (
              <Button
                disabled={item?.is_content_locked || item?.status === "archived" || isArchiving}
                onClick={archiveItem}
                type="button"
                variant="danger"
              >
                <Archive className="h-4 w-4" aria-hidden="true" />
                Archive
              </Button>
            ) : null}
          </div>
        </form>
      ) : null}
    </div>
  );
}
