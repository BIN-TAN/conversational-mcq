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
  const [itemStem, setItemStem] = useState("");
  const [options, setOptions] = useState<ItemOption[]>([
    { label: "A", text: "" },
    { label: "B", text: "" },
    { label: "C", text: "" }
  ]);
  const [correctOption, setCorrectOption] = useState("A");
  const [distractorRationales, setDistractorRationales] = useState<Record<string, string>>({});
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
        message: "Return the concept unit to draft before editing this item."
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
      const payload = {
        item_stem: itemStem,
        options: options.map((option) => ({
          label: option.label.trim(),
          text: option.text
        })),
        correct_option: correctOption,
        distractor_rationales: Object.fromEntries(
          optionLabels
            .filter((label) => label !== correctOption)
            .map((label) => [label, distractorRationales[label] ?? ""])
        ),
        expected_reasoning_patterns: linesToArray(expectedReasoning),
        possible_misconception_indicators: linesToArray(misconceptionIndicators),
        administration_rules: parseJsonObject(administrationRules, "Administration rules"),
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

  const title = props.mode === "create" ? "New item" : "Item editor";
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
      ? "Return the concept unit to draft before editing published items."
      : item?.status === "archived"
        ? "Archived items are preserved for records and are not editable."
        : "Return the parent assessment to draft before editing this item.";

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="item"
        title={title}
        description="Edit MCQ content, answer metadata, and later profiling evidence fields."
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
              <Field label="Item stem">
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
                    Candidate items may stay in the concept unit. Publishing counts only included active items.
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
                <p className="mt-1 text-sm text-muted">Use 2 to 6 option rows. Labels must be unique.</p>
              </div>
              <Button disabled={!isEditable || options.length >= 6} onClick={addOption} type="button" variant="secondary">
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
              <Field label="Correct option">
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
            <h2 className="text-xl font-semibold text-ink">Distractor rationales</h2>
            <p className="mt-1 text-sm text-muted">
              Every incorrect option requires a rationale before the concept unit can publish.
            </p>
            <div className="mt-5 grid gap-4">
              {optionLabels
                .filter((label) => label !== correctOption)
                .map((label) => (
                  <Field label={`Option ${label}`} key={label}>
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
                ))}
            </div>
          </section>

          <section className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-lg border border-line bg-white p-5 shadow-soft">
              <Field
                label="Expected reasoning patterns"
                hint="One pattern per line. Required before publishing."
              >
                <textarea
                  className="min-h-40 rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
                  disabled={!isEditable}
                  onChange={(event) => setExpectedReasoning(event.target.value)}
                  value={expectedReasoning}
                />
              </Field>
            </div>
            <div className="rounded-lg border border-line bg-white p-5 shadow-soft">
              <Field
                label="Possible misconception indicators"
                hint="One indicator per line. Required before publishing."
              >
                <textarea
                  className="min-h-40 rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
                  disabled={!isEditable}
                  onChange={(event) => setMisconceptionIndicators(event.target.value)}
                  value={misconceptionIndicators}
                />
              </Field>
            </div>
          </section>

          <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
            <Field label="Administration rules" hint="JSON object">
              <textarea
                className="min-h-28 rounded-md border border-line px-3 py-2 font-mono text-sm outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
                disabled={!isEditable}
                onChange={(event) => setAdministrationRules(event.target.value)}
                value={administrationRules}
              />
            </Field>
          </section>

          <div className="flex flex-wrap gap-2">
            <Button disabled={!isEditable || isSubmitting} type="submit">
              <Save className="h-4 w-4" aria-hidden="true" />
              {isSubmitting ? "Saving" : props.mode === "create" ? "Create item" : "Save item"}
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
