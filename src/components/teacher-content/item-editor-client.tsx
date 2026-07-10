"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, Plus, Save, Trash2 } from "lucide-react";
import { apiRequest, errorFromUnknown } from "./api";
import {
  normalizeOptions,
  parseJsonObject,
  stringifyJson
} from "./form-utils";
import {
  buildDistractorRationalesFromTeacherNotes,
  buildItemAdministrationRulesFromTeacherMetadata,
  readTeacherItemMetadata
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

type ItemEditorProps =
  | {
      mode: "create";
      conceptUnitPublicId?: string;
      assessmentPublicId?: string;
    }
  | {
      mode: "edit";
      itemPublicId: string;
    };

export function ItemEditorClient(props: ItemEditorProps) {
  const router = useRouter();
  const itemPublicId = props.mode === "edit" ? props.itemPublicId : null;
  const conceptUnitPublicId = props.mode === "create" ? props.conceptUnitPublicId : null;
  const assessmentPublicId = props.mode === "create" ? props.assessmentPublicId : null;
  const [item, setItem] = useState<ItemDetail | null>(null);
  const [itemLabel, setItemLabel] = useState("");
  const [itemStem, setItemStem] = useState("");
  const [options, setOptions] = useState<ItemOption[]>([
    { label: "A", text: "" },
    { label: "B", text: "" },
    { label: "C", text: "" },
    { label: "D", text: "" }
  ]);
  const [correctOption, setCorrectOption] = useState("A");
  const [expectedReasoningNote, setExpectedReasoningNote] = useState("");
  const [itemDiagnosticValueNote, setItemDiagnosticValueNote] = useState("");
  const [targetReasoningNote, setTargetReasoningNote] = useState("");
  const [strongReasoningNote, setStrongReasoningNote] = useState("");
  const [plainLanguageDistractorNotes, setPlainLanguageDistractorNotes] = useState("");
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
      setAdministrationRules(stringifyJson(loaded.administration_rules));
      setItemOrder(String(loaded.item_order));
      setIncludedInPublishedSet(loaded.included_in_published_set);
      const metadata = readTeacherItemMetadata(loaded.administration_rules);
      setItemLabel(metadata.item_label);
      setExpectedReasoningNote(metadata.expected_reasoning_note);
      setItemDiagnosticValueNote(metadata.item_diagnostic_value_note);
      setTargetReasoningNote(metadata.correct_option_notes.target_reasoning_note ?? "");
      setStrongReasoningNote(metadata.correct_option_notes.strong_reasoning_should_mention ?? "");
      setPlainLanguageDistractorNotes(metadata.plain_language_distractor_diagnostic_notes);
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
    const correctOptionIndex = options.findIndex((option) => option.label === correctOption);
    setOptions((current) =>
      current
        .filter((_, optionIndex) => optionIndex !== index)
        .map((option, optionIndex) => ({
          ...option,
          label: String.fromCharCode(65 + optionIndex)
        }))
    );
    if (label === correctOption) {
      setCorrectOption("");
    } else if (correctOptionIndex > index) {
      setCorrectOption(String.fromCharCode(65 + correctOptionIndex - 1));
    }
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
      const advancedRules = parseJsonObject(administrationRules, "Advanced settings");
      const administration_rules = buildItemAdministrationRulesFromTeacherMetadata({
        administration_rules: advancedRules,
        metadata: {
          item_label: itemLabel,
          item_purpose: "initial_item",
          expected_reasoning_note: expectedReasoningNote,
          item_diagnostic_value_note: itemDiagnosticValueNote,
          plain_language_distractor_diagnostic_notes: plainLanguageDistractorNotes,
          correct_option_notes: {
            target_reasoning_note: targetReasoningNote,
            strong_reasoning_should_mention: strongReasoningNote
          }
        }
      });
      const derivedExpectedReasoning = [
        expectedReasoningNote,
        targetReasoningNote,
        strongReasoningNote
      ]
        .map((entry) => entry.trim())
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
          existing_rationales: {},
          option_notes: [],
          plain_language_distractor_diagnostic_notes: plainLanguageDistractorNotes
        }),
        expected_reasoning_patterns:
          derivedExpectedReasoning,
        possible_misconception_indicators: [],
        administration_rules,
        included_in_published_set: includedInPublishedSet
      };

      if (assessmentPublicId) {
        const data = await apiRequest<ItemResponse>(
          `/api/teacher/assessments/${assessmentPublicId}/items`,
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
              <Field label="Item title / short label">
                <input
                  className="rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
                  disabled={!isEditable}
                  onChange={(event) => setItemLabel(event.target.value)}
                  placeholder="e.g. Theta scale boundary"
                  value={itemLabel}
                />
              </Field>

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
                <div className="grid gap-3 rounded-lg border border-line p-3 md:grid-cols-[72px_minmax(0,1fr)_120px_auto]" key={index}>
                  <div>
                    <span className="block text-sm font-medium text-ink">Option</span>
                    <span className="mt-2 inline-flex h-10 min-w-10 items-center justify-center rounded-md border border-line bg-slate-50 px-3 font-semibold text-ink">
                      {option.label}
                    </span>
                  </div>
                  <Field label="Text">
                    <input
                      className="rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
                      disabled={!isEditable}
                      onChange={(event) => updateOption(index, { text: event.target.value })}
                      required
                      value={option.text}
                    />
                  </Field>
                  <label className="flex items-end gap-2 pb-2 text-sm font-medium text-ink">
                    <input
                      checked={correctOption === option.label}
                      className="h-4 w-4"
                      disabled={!isEditable}
                      name="correct-option"
                      onChange={() => setCorrectOption(option.label)}
                      type="radio"
                    />
                    Mark as key
                  </label>
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
            </div>
          </section>

          <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
            <h2 className="text-xl font-semibold text-ink">Distractor diagnostic notes</h2>
            <p className="mt-1 text-sm text-muted">
              Write in plain language how the distractors may relate to possible misconceptions, partial understanding, guessing, or other reasoning patterns. Selecting a distractor is indirect evidence only; the system should consider written reasoning, confidence, timing, and other student responses before interpreting it.
            </p>
            <Field label="Distractor diagnostic notes" hint="These notes are teacher-only interpretation guidance, not labels or ground truth.">
              <textarea
                className="mt-5 min-h-48 rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
                disabled={!isEditable}
                onChange={(event) => setPlainLanguageDistractorNotes(event.target.value)}
                placeholder="Option B may suggest confusion between reliability and validity. Option C may suggest treating reliability as a fixed property of the test rather than a sample-dependent estimate. Option D may suggest interpreting a group-level coefficient as an individual-level statement. These are possible interpretations, not firm conclusions."
                value={plainLanguageDistractorNotes}
              />
            </Field>
          </section>

          <section className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-lg border border-line bg-white p-5 shadow-soft">
              <h2 className="text-xl font-semibold text-ink">Student preview</h2>
              <p className="mt-1 text-sm text-muted">
                Students see only the stem and option text during protected administration.
              </p>
              <div className="mt-4 rounded-md border border-line bg-slate-50 p-4">
                <p className="whitespace-pre-wrap text-sm leading-6 text-ink">
                  {itemStem || "Item stem will appear here."}
                </p>
                <ol className="mt-4 space-y-2">
                  {options.map((option) => (
                    <li className="text-sm text-ink" key={`student-preview-${option.label}`}>
                      <span className="font-semibold">{option.label || "?"}.</span>{" "}
                      {option.text || "Option text"}
                    </li>
                  ))}
                </ol>
              </div>
            </div>
            <div className="rounded-lg border border-line bg-white p-5 shadow-soft">
              <h2 className="text-xl font-semibold text-ink">Teacher preview</h2>
              <p className="mt-1 text-sm text-muted">
                Teacher-only preview includes the key and diagnostic notes.
              </p>
              <dl className="mt-4 space-y-3 text-sm">
                <div>
                  <dt className="text-muted">Correct answer/key</dt>
                  <dd className="font-semibold text-ink">{correctOption || "Not selected"}</dd>
                </div>
                <div>
                  <dt className="text-muted">Expected / target reasoning</dt>
                  <dd className="whitespace-pre-wrap text-ink">
                    {targetReasoningNote || "No target reasoning note yet."}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted">Strong reasoning should mention</dt>
                  <dd className="whitespace-pre-wrap text-ink">
                    {strongReasoningNote || "No strong-reasoning note yet."}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted">Distractor diagnostic notes</dt>
                  <dd className="whitespace-pre-wrap text-ink">
                    {plainLanguageDistractorNotes || "No distractor note yet."}
                  </dd>
                </div>
              </dl>
            </div>
          </section>

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
