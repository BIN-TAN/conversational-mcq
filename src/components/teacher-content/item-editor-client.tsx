"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArrowLeft, Image as ImageIcon, Link2, Plus, Save, Trash2, Video, X } from "lucide-react";
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
import type { AssessmentDetail, ItemDetail, ItemMediaAsset, ItemOption, StructuredApiError } from "./types";
import {
  Breadcrumbs,
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

type AssessmentDetailResponse = {
  assessment: AssessmentDetail;
};

type SaveIntent = "add_another" | "return" | "stay";

type ItemMediaDraft = {
  media_public_id?: string;
  placement: "item_stem" | "option";
  option_label: string | null;
  media_type: "image" | "video" | "reference_link";
  source_type: "uploaded" | "external_url";
  public_or_signed_url: string | null;
  external_url: string | null;
  title: string;
  alt_text_or_description: string;
  caption: string;
  transcript_or_content_summary: string;
  source_attribution: string;
  order_index: number;
  active: boolean;
};

type AssessmentContext = Pick<
  AssessmentDetail,
  "assessment_public_id" | "title" | "content_state"
> & {
  mini_test_items?: ItemDetail[];
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

function defaultOptions(): ItemOption[] {
  return [
    { label: "A", text: "" },
    { label: "B", text: "" },
    { label: "C", text: "" },
    { label: "D", text: "" }
  ];
}

function draftFromMediaAsset(asset: ItemMediaAsset): ItemMediaDraft {
  return {
    media_public_id: asset.media_public_id,
    placement: asset.placement,
    option_label: asset.option_label,
    media_type: asset.media_type,
    source_type: asset.source_type,
    public_or_signed_url: asset.source_type === "uploaded" ? asset.url : null,
    external_url: asset.source_type === "external_url" ? asset.url : null,
    title: asset.title ?? "",
    alt_text_or_description: asset.alt_text_or_description,
    caption: asset.caption ?? "",
    transcript_or_content_summary: asset.transcript_or_content_summary ?? "",
    source_attribution: asset.source_attribution ?? "",
    order_index: asset.order_index,
    active: asset.active
  };
}

function blankMediaDraft(orderIndex: number): ItemMediaDraft {
  return {
    placement: "item_stem",
    option_label: null,
    media_type: "image",
    source_type: "external_url",
    public_or_signed_url: null,
    external_url: "",
    title: "",
    alt_text_or_description: "",
    caption: "",
    transcript_or_content_summary: "",
    source_attribution: "",
    order_index: orderIndex,
    active: true
  };
}

function mediaDraftToInput(asset: ItemMediaDraft, orderIndex: number) {
  return {
    media_public_id: asset.media_public_id,
    placement: asset.placement,
    option_label: asset.placement === "option" ? asset.option_label : null,
    media_type: asset.media_type,
    source_type: asset.source_type,
    public_or_signed_url:
      asset.source_type === "uploaded" && asset.public_or_signed_url?.trim()
        ? asset.public_or_signed_url.trim()
        : null,
    external_url:
      asset.source_type === "external_url" && asset.external_url?.trim()
        ? asset.external_url.trim()
        : null,
    title: asset.title.trim() || null,
    alt_text_or_description: asset.alt_text_or_description.trim(),
    caption: asset.caption.trim() || null,
    transcript_or_content_summary: asset.transcript_or_content_summary.trim() || null,
    source_attribution: asset.source_attribution.trim() || null,
    order_index: orderIndex,
    active: asset.active
  };
}

function mediaIcon(mediaType: ItemMediaDraft["media_type"]) {
  if (mediaType === "video") {
    return <Video className="h-4 w-4" aria-hidden="true" />;
  }

  if (mediaType === "reference_link") {
    return <Link2 className="h-4 w-4" aria-hidden="true" />;
  }

  return <ImageIcon className="h-4 w-4" aria-hidden="true" />;
}

function MediaDraftPreview({
  mediaAssets,
  compact = false
}: {
  mediaAssets: ItemMediaDraft[];
  compact?: boolean;
}) {
  const activeAssets = mediaAssets.filter((asset) => asset.active);

  if (activeAssets.length === 0) {
    return null;
  }

  return (
    <div className={compact ? "mt-3 grid gap-2" : "mt-4 grid gap-3"}>
      {activeAssets.map((asset, index) => {
        const url = asset.source_type === "uploaded" ? asset.public_or_signed_url : asset.external_url;

        return (
          <figure
            className="rounded-md border border-line bg-white p-3 text-sm"
            key={asset.media_public_id ?? `media-preview-${index}`}
          >
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
              {mediaIcon(asset.media_type)}
              <span>
                {asset.media_type.replace("_", " ")}
                {asset.placement === "option" && asset.option_label ? ` for option ${asset.option_label}` : ""}
              </span>
            </div>
            {asset.media_type === "image" && url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                alt={asset.alt_text_or_description || "Item media preview"}
                className="mt-2 max-h-56 w-full rounded-md object-contain"
                src={url}
              />
            ) : url ? (
              <p className="mt-2 break-all text-accent">{url}</p>
            ) : null}
            {asset.title ? <figcaption className="mt-2 font-semibold text-ink">{asset.title}</figcaption> : null}
            <p className="mt-1 leading-6 text-muted">
              {asset.alt_text_or_description || "Accessible description is required before saving."}
            </p>
            {asset.caption ? <p className="mt-1 text-muted">{asset.caption}</p> : null}
            {asset.transcript_or_content_summary ? (
              <p className="mt-2 text-xs leading-5 text-muted">{asset.transcript_or_content_summary}</p>
            ) : null}
            {asset.source_attribution ? (
              <p className="mt-1 text-[0.68rem] uppercase tracking-wide text-muted">
                {asset.source_attribution}
              </p>
            ) : null}
          </figure>
        );
      })}
    </div>
  );
}

export function ItemEditorClient(props: ItemEditorProps) {
  const router = useRouter();
  const itemPublicId = props.mode === "edit" ? props.itemPublicId : null;
  const conceptUnitPublicId = props.mode === "create" ? props.conceptUnitPublicId : null;
  const assessmentPublicId = props.mode === "create" ? props.assessmentPublicId : null;
  const [item, setItem] = useState<ItemDetail | null>(null);
  const [assessmentContext, setAssessmentContext] = useState<AssessmentContext | null>(null);
  const [itemLabel, setItemLabel] = useState("");
  const [itemStem, setItemStem] = useState("");
  const [options, setOptions] = useState<ItemOption[]>(defaultOptions);
  const [correctOption, setCorrectOption] = useState("A");
  const [expectedReasoningNote, setExpectedReasoningNote] = useState("");
  const [itemDiagnosticValueNote, setItemDiagnosticValueNote] = useState("");
  const [targetReasoningNote, setTargetReasoningNote] = useState("");
  const [strongReasoningNote, setStrongReasoningNote] = useState("");
  const [plainLanguageDistractorNotes, setPlainLanguageDistractorNotes] = useState("");
  const [mediaAssets, setMediaAssets] = useState<ItemMediaDraft[]>([]);
  const [administrationRules, setAdministrationRules] = useState("{}");
  const [itemOrder, setItemOrder] = useState("");
  const [includedInPublishedSet, setIncludedInPublishedSet] = useState(true);
  const [error, setError] = useState<StructuredApiError | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(props.mode === "edit");
  const [isContextLoading, setIsContextLoading] = useState(Boolean(assessmentPublicId));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeSaveIntent, setActiveSaveIntent] = useState<SaveIntent | null>(null);
  const [isArchiving, setIsArchiving] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  const optionLabels = useMemo(
    () => options.map((option) => option.label.trim()).filter(Boolean),
    [options]
  );

  const loadAssessmentContext = useCallback(async () => {
    if (!assessmentPublicId) {
      setIsContextLoading(false);
      return;
    }

    setIsContextLoading(true);

    try {
      const data = await apiRequest<AssessmentDetailResponse>(
        `/api/teacher/assessments/${assessmentPublicId}`
      );
      setAssessmentContext(data.assessment);
    } catch (caught) {
      setError(errorFromUnknown(caught));
    } finally {
      setIsContextLoading(false);
    }
  }, [assessmentPublicId]);

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
      setAssessmentContext(
        loaded.assessment_public_id
          ? {
              assessment_public_id: loaded.assessment_public_id,
              title: loaded.assessment_title ?? "Mini test",
              content_state: loaded.content_state ?? "draft_editable",
              mini_test_items: []
            }
          : null
      );
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
      setMediaAssets((loaded.media_assets ?? []).map(draftFromMediaAsset));
      setHasUnsavedChanges(false);
    } catch (caught) {
      setError(errorFromUnknown(caught));
    } finally {
      setIsLoading(false);
    }
  }, [itemPublicId]);

  useEffect(() => {
    void loadItem();
  }, [loadItem]);

  useEffect(() => {
    void loadAssessmentContext();
  }, [loadAssessmentContext]);

  function markDirty() {
    setHasUnsavedChanges(true);
  }

  function updateOption(index: number, patch: Partial<ItemOption>) {
    markDirty();
    setOptions((current) =>
      current.map((option, optionIndex) =>
        optionIndex === index ? { ...option, ...patch } : option
      )
    );
  }

  function addOption() {
    const nextLabel = String.fromCharCode(65 + options.length);
    markDirty();
    setOptions((current) => [...current, { label: nextLabel, text: "" }]);
  }

  function removeOption(index: number) {
    markDirty();
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

  function resetCreateForm() {
    setItem(null);
    setItemLabel("");
    setItemStem("");
    setOptions(defaultOptions());
    setCorrectOption("A");
    setExpectedReasoningNote("");
    setItemDiagnosticValueNote("");
    setTargetReasoningNote("");
    setStrongReasoningNote("");
    setPlainLanguageDistractorNotes("");
    setMediaAssets([]);
    setAdministrationRules("{}");
    setItemOrder("");
    setIncludedInPublishedSet(true);
    setHasUnsavedChanges(false);
  }

  function parentAssessmentHref() {
    const parentPublicId = assessmentPublicId ?? item?.assessment_public_id;

    return parentPublicId
      ? `/teacher/content/assessments/${parentPublicId}`
      : "/teacher/content/assessments";
  }

  function parentAssessmentTitle() {
    return assessmentContext?.title ?? item?.assessment_title ?? "Mini test";
  }

  function leaveEditor() {
    if (hasUnsavedChanges) {
      const confirmed = window.confirm("Discard unsaved changes and return to the mini test?");

      if (!confirmed) {
        return;
      }
    }

    router.push(parentAssessmentHref());
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

    for (const [index, media] of mediaAssets.entries()) {
      if (!media.alt_text_or_description.trim()) {
        return {
          code: "validation_failed",
          message: "Media needs an accessible description.",
          details: { issues: [{ path: `media_assets.${index}.alt_text_or_description`, message: "Add a description." }] }
        };
      }

      if (media.source_type === "external_url" && !media.external_url?.trim()) {
        return {
          code: "validation_failed",
          message: "External media needs an HTTPS URL.",
          details: { issues: [{ path: `media_assets.${index}.external_url`, message: "Add an HTTPS URL." }] }
        };
      }

      if (media.media_type === "video" && !media.transcript_or_content_summary.trim()) {
        return {
          code: "validation_failed",
          message: "Video media needs a transcript or content summary.",
          details: {
            issues: [
              {
                path: `media_assets.${index}.transcript_or_content_summary`,
                message: "Add a transcript or summary."
              }
            ]
          }
        };
      }

      if (media.placement === "option" && (!media.option_label || !labels.includes(media.option_label))) {
        return {
          code: "validation_failed",
          message: "Option media must be attached to an existing option.",
          details: { issues: [{ path: `media_assets.${index}.option_label`, message: "Choose an option." }] }
        };
      }
    }

    return null;
  }

  function addMediaAsset() {
    markDirty();
    setMediaAssets((current) => [...current, blankMediaDraft(current.length)]);
  }

  function updateMediaAsset(index: number, patch: Partial<ItemMediaDraft>) {
    markDirty();
    setMediaAssets((current) =>
      current.map((asset, assetIndex) =>
        assetIndex === index
          ? {
              ...asset,
              ...patch,
              option_label:
                patch.placement === "item_stem"
                  ? null
                  : patch.placement === "option" && !asset.option_label
                    ? optionLabels[0] ?? null
                    : patch.option_label ?? asset.option_label
            }
          : asset
      )
    );
  }

  function removeMediaAsset(index: number) {
    markDirty();
    setMediaAssets((current) => current.filter((_, assetIndex) => assetIndex !== index));
  }

  function moveMediaAsset(index: number, direction: -1 | 1) {
    markDirty();
    setMediaAssets((current) => {
      const next = [...current];
      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= next.length) {
        return current;
      }

      [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
      return next;
    });
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) {
      return;
    }

    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const saveIntent = (submitter?.value as SaveIntent | undefined) ?? (
      props.mode === "create" ? "add_another" : "stay"
    );
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
    setActiveSaveIntent(saveIntent);

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
        media_assets: mediaAssets.map(mediaDraftToInput),
        included_in_published_set: includedInPublishedSet
      };

      if (assessmentPublicId) {
        await apiRequest<ItemResponse>(
          `/api/teacher/assessments/${assessmentPublicId}/items`,
          {
            method: "POST",
            body: JSON.stringify({
              ...payload,
              item_order: itemOrder ? Number(itemOrder) : undefined
            })
          }
        );
        setSuccess("MCQ item saved.");
        setHasUnsavedChanges(false);

        if (saveIntent === "return") {
          router.push(`${parentAssessmentHref()}?item_saved=1`);
          return;
        }

        resetCreateForm();
        await loadAssessmentContext();
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
        setHasUnsavedChanges(false);
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
      setHasUnsavedChanges(false);
      if (saveIntent === "return") {
        router.push(`${parentAssessmentHref()}?item_saved=1`);
        return;
      }
      setSuccess("Item saved. Version increments when content changes.");
      await loadItem();
    } catch (caught) {
      setError(errorFromUnknown(caught));
    } finally {
      setIsSubmitting(false);
      setActiveSaveIntent(null);
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

  const title = props.mode === "create" ? "Add MCQ item" : "Edit MCQ item";
  const assessmentHref = parentAssessmentHref();
  const assessmentTitle = parentAssessmentTitle();
  const existingItemCount = assessmentContext?.mini_test_items?.length ?? 0;
  const isCreateEditable =
    props.mode === "create" &&
    (!assessmentContext || assessmentContext.content_state === "draft_editable");
  const isEditable =
    isCreateEditable ||
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
  const createReadOnlyReason =
    assessmentContext && assessmentContext.content_state !== "draft_editable"
      ? "Return the mini test to draft before adding MCQ items."
      : null;

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: "Mini tests", href: "/teacher/content/assessments" },
          { label: assessmentTitle, href: assessmentHref },
          { label: title }
        ]}
      />
      <PageHeader
        eyebrow="MCQ item"
        title={title}
        description="Build one MCQ item with teacher-only diagnostic notes for interpretation."
        actions={
          <Button onClick={leaveEditor} type="button" variant="secondary">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to mini test
          </Button>
        }
      />

      <ErrorPanel error={error} />
      <SuccessPanel message={success} />

      {isLoading || isContextLoading ? <LoadingRow label="Loading item context" /> : null}

      {!isLoading && !isContextLoading ? (
        <form className="space-y-6" onSubmit={onSubmit}>
          {props.mode === "create" && assessmentPublicId ? (
            <section className="rounded-lg border border-line bg-white p-4 text-sm text-muted shadow-soft">
              <span className="font-semibold text-ink">{existingItemCount}</span>{" "}
              existing MCQ {existingItemCount === 1 ? "item" : "items"} in {assessmentTitle}.
              New items are assigned the next available order automatically when item order is blank.
            </section>
          ) : null}
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
            {createReadOnlyReason ? (
              <p className="mb-5 rounded-md border border-line bg-slate-50 p-3 text-sm leading-6 text-muted">
                {createReadOnlyReason}
              </p>
            ) : null}

            <div className="grid gap-4">
              <Field label="Item title / short label">
                <input
                  className="rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
                  disabled={!isEditable}
                  onChange={(event) => {
                    markDirty();
                    setItemLabel(event.target.value);
                  }}
                  placeholder="e.g. Theta scale boundary"
                  value={itemLabel}
                />
              </Field>

              <Field label="Stem">
                <textarea
                  className="min-h-28 rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
                  disabled={!isEditable}
                  onChange={(event) => {
                    markDirty();
                    setItemStem(event.target.value);
                  }}
                  required
                  value={itemStem}
                />
              </Field>

              <label className="flex items-start gap-3 rounded-md border border-line bg-slate-50 p-3 text-sm text-ink">
                <input
                  checked={includedInPublishedSet}
                  className="mt-1 h-4 w-4"
                  disabled={!isEditable}
                  onChange={(event) => {
                    markDirty();
                    setIncludedInPublishedSet(event.target.checked);
                  }}
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
                <Field label="Item order (optional)" hint="Leave blank to assign the next available item order automatically.">
                  <input
                    className="rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
                    disabled={!isEditable}
                    min={1}
                    onChange={(event) => {
                      markDirty();
                      setItemOrder(event.target.value);
                    }}
                    type="number"
                    value={itemOrder}
                  />
                </Field>
              ) : null}
            </div>
          </section>

          <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
            <h2 className="text-xl font-semibold text-ink">Higher-order item design</h2>
            <p className="mt-2 text-sm leading-6 text-muted">
              Initial MCQ items should usually ask students to apply, analyze, or evaluate ideas. Basic recall is best used only when it has clear diagnostic value. Creation is better elicited later through a constructed-response activity.
            </p>
          </section>

          <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
            <div className="flex flex-col gap-3 border-b border-line pb-4 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-xl font-semibold text-ink">Media</h2>
                <p className="mt-1 text-sm leading-6 text-muted">
                  Add optional images, videos, or reference links. Descriptions are required because the LLM receives accessible media context, not direct media content.
                </p>
              </div>
              <Button disabled={!isEditable} onClick={addMediaAsset} type="button" variant="secondary">
                <Plus className="h-4 w-4" aria-hidden="true" />
                Add media
              </Button>
            </div>
            <p className="mt-3 rounded-md border border-line bg-slate-50 p-3 text-xs leading-5 text-muted">
              Image upload storage is disabled until a server-side storage provider is configured. Use HTTPS URLs for now. PNG, JPEG, and WebP uploads are validated server-side when storage is enabled; SVG and video binary uploads are not accepted.
            </p>
            {mediaAssets.length === 0 ? (
              <p className="mt-4 text-sm text-muted">No media attached.</p>
            ) : (
              <div className="mt-4 space-y-4">
                {mediaAssets.map((media, mediaIndex) => (
                  <div
                    className="rounded-lg border border-line bg-slate-50 p-4"
                    data-testid={`teacher-media-row-${mediaIndex}`}
                    key={media.media_public_id ?? `new-media-${mediaIndex}`}
                  >
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div className="flex items-center gap-2 text-sm font-semibold text-ink">
                        {mediaIcon(media.media_type)}
                        Media {mediaIndex + 1}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          disabled={!isEditable || mediaIndex === 0}
                          onClick={() => moveMediaAsset(mediaIndex, -1)}
                          type="button"
                          variant="secondary"
                        >
                          Move up
                        </Button>
                        <Button
                          disabled={!isEditable || mediaIndex === mediaAssets.length - 1}
                          onClick={() => moveMediaAsset(mediaIndex, 1)}
                          type="button"
                          variant="secondary"
                        >
                          Move down
                        </Button>
                        <Button
                          disabled={!isEditable}
                          onClick={() => removeMediaAsset(mediaIndex)}
                          type="button"
                          variant="danger"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                          Delete
                        </Button>
                      </div>
                    </div>
                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                      <Field label="Media type">
                        <select
                          className="rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
                          disabled={!isEditable}
                          onChange={(event) =>
                            updateMediaAsset(mediaIndex, {
                              media_type: event.target.value as ItemMediaDraft["media_type"]
                            })
                          }
                          value={media.media_type}
                        >
                          <option value="image">Image</option>
                          <option value="video">Video link</option>
                          <option value="reference_link">Reference link</option>
                        </select>
                      </Field>
                      <Field label="Source">
                        <select
                          className="rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
                          disabled={!isEditable}
                          onChange={(event) =>
                            updateMediaAsset(mediaIndex, {
                              source_type: event.target.value as ItemMediaDraft["source_type"],
                              public_or_signed_url: null
                            })
                          }
                          value={media.source_type}
                        >
                          <option value="external_url">HTTPS URL</option>
                          <option disabled value="uploaded">Upload image (storage not configured)</option>
                        </select>
                      </Field>
                      <Field label="Placement">
                        <select
                          className="rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
                          disabled={!isEditable}
                          onChange={(event) =>
                            updateMediaAsset(mediaIndex, {
                              placement: event.target.value as ItemMediaDraft["placement"]
                            })
                          }
                          value={media.placement}
                        >
                          <option value="item_stem">Stem</option>
                          <option value="option">Option</option>
                        </select>
                      </Field>
                      {media.placement === "option" ? (
                        <Field label="Option">
                          <select
                            className="rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
                            disabled={!isEditable}
                            onChange={(event) =>
                              updateMediaAsset(mediaIndex, { option_label: event.target.value })
                            }
                            value={media.option_label ?? optionLabels[0] ?? ""}
                          >
                            {optionLabels.map((label) => (
                              <option key={label} value={label}>
                                Option {label}
                              </option>
                            ))}
                          </select>
                        </Field>
                      ) : null}
                      <Field label="URL">
                        <input
                          className="rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
                          disabled={!isEditable || media.source_type === "uploaded"}
                          onChange={(event) => updateMediaAsset(mediaIndex, { external_url: event.target.value })}
                          placeholder="https://..."
                          required={media.source_type === "external_url"}
                          value={media.external_url ?? ""}
                        />
                      </Field>
                      <Field label="Title (optional)">
                        <input
                          className="rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
                          disabled={!isEditable}
                          onChange={(event) => updateMediaAsset(mediaIndex, { title: event.target.value })}
                          value={media.title}
                        />
                      </Field>
                      <Field label="Alt text / content description">
                        <textarea
                          className="min-h-20 rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
                          disabled={!isEditable}
                          onChange={(event) =>
                            updateMediaAsset(mediaIndex, { alt_text_or_description: event.target.value })
                          }
                          required
                          value={media.alt_text_or_description}
                        />
                      </Field>
                      <Field label="Caption (optional)">
                        <textarea
                          className="min-h-20 rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
                          disabled={!isEditable}
                          onChange={(event) => updateMediaAsset(mediaIndex, { caption: event.target.value })}
                          value={media.caption}
                        />
                      </Field>
                      <Field
                        label={
                          media.media_type === "video"
                            ? "Transcript or content summary"
                            : "Transcript or content summary (optional)"
                        }
                      >
                        <textarea
                          className="min-h-20 rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
                          disabled={!isEditable}
                          onChange={(event) =>
                            updateMediaAsset(mediaIndex, {
                              transcript_or_content_summary: event.target.value
                            })
                          }
                          required={media.media_type === "video"}
                          value={media.transcript_or_content_summary}
                        />
                      </Field>
                      <Field label="Attribution (optional)">
                        <input
                          className="rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
                          disabled={!isEditable}
                          onChange={(event) =>
                            updateMediaAsset(mediaIndex, { source_attribution: event.target.value })
                          }
                          value={media.source_attribution}
                        />
                      </Field>
                    </div>
                  </div>
                ))}
              </div>
            )}
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
                      onChange={() => {
                        markDirty();
                        setCorrectOption(option.label);
                      }}
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
                  onChange={(event) => {
                    markDirty();
                    setTargetReasoningNote(event.target.value);
                  }}
                  value={targetReasoningNote}
                />
              </Field>
              <Field label="Strong reasoning should mention">
                <textarea
                  className="min-h-20 rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
                  disabled={!isEditable}
                  onChange={(event) => {
                    markDirty();
                    setStrongReasoningNote(event.target.value);
                  }}
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
                onChange={(event) => {
                  markDirty();
                  setPlainLanguageDistractorNotes(event.target.value);
                }}
                placeholder="Option B may suggest confusion between reliability and validity. Option C may suggest treating reliability as a fixed property of the test rather than a sample-dependent estimate. Option D may suggest interpreting a group-level coefficient as an individual-level statement. These are possible interpretations, not firm conclusions."
                value={plainLanguageDistractorNotes}
              />
            </Field>
          </section>

          <section className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-lg border border-line bg-white p-5 shadow-soft" id="student-preview">
              <h2 className="text-xl font-semibold text-ink">Student preview</h2>
              <p className="mt-1 text-sm text-muted">
                Students see only the stem and option text during protected administration.
              </p>
              <div className="mt-4 rounded-md border border-line bg-slate-50 p-4">
                <p className="whitespace-pre-wrap text-sm leading-6 text-ink">
                  {itemStem || "Item stem will appear here."}
                </p>
                <MediaDraftPreview
                  mediaAssets={mediaAssets.filter((media) => media.placement === "item_stem")}
                />
                <ol className="mt-4 space-y-2">
                  {options.map((option) => (
                    <li className="text-sm text-ink" key={`student-preview-${option.label}`}>
                      <span className="font-semibold">{option.label || "?"}.</span>{" "}
                      {option.text || "Option text"}
                      <MediaDraftPreview
                        compact
                        mediaAssets={mediaAssets.filter(
                          (media) => media.placement === "option" && media.option_label === option.label
                        )}
                      />
                    </li>
                  ))}
                </ol>
              </div>
            </div>
            <div className="rounded-lg border border-line bg-white p-5 shadow-soft" id="teacher-preview">
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
                <div>
                  <dt className="text-muted">Media context for interpretation</dt>
                  <dd className="text-ink">
                    {mediaAssets.length > 0
                      ? `${mediaAssets.length} media ${mediaAssets.length === 1 ? "asset" : "assets"} represented by descriptions, captions, transcripts, or summaries. Direct media is not sent to the LLM in this phase.`
                      : "No media context yet."}
                  </dd>
                </div>
              </dl>
              <MediaDraftPreview mediaAssets={mediaAssets} />
            </div>
          </section>

          <div className="flex flex-wrap gap-2 rounded-lg border border-line bg-white p-4 shadow-soft">
            {props.mode === "create" ? (
              <>
                <Button
                  disabled={!isEditable || isSubmitting}
                  name="save_intent"
                  type="submit"
                  value="add_another"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  {isSubmitting && activeSaveIntent === "add_another"
                    ? "Saving"
                    : "Save item and add another"}
                </Button>
                <Button
                  disabled={!isEditable || isSubmitting}
                  name="save_intent"
                  type="submit"
                  value="return"
                  variant="secondary"
                >
                  <Save className="h-4 w-4" aria-hidden="true" />
                  {isSubmitting && activeSaveIntent === "return"
                    ? "Saving"
                    : "Save item and return to mini test"}
                </Button>
                <Button disabled={isSubmitting} onClick={leaveEditor} type="button" variant="secondary">
                  <X className="h-4 w-4" aria-hidden="true" />
                  Cancel
                </Button>
              </>
            ) : (
              <>
                <Button
                  disabled={!isEditable || isSubmitting}
                  name="save_intent"
                  type="submit"
                  value="stay"
                >
                  <Save className="h-4 w-4" aria-hidden="true" />
                  {isSubmitting && activeSaveIntent === "stay" ? "Saving" : "Save changes"}
                </Button>
                <Button
                  disabled={!isEditable || isSubmitting}
                  name="save_intent"
                  type="submit"
                  value="return"
                  variant="secondary"
                >
                  <Save className="h-4 w-4" aria-hidden="true" />
                  {isSubmitting && activeSaveIntent === "return"
                    ? "Saving"
                    : "Save changes and return to mini test"}
                </Button>
                <Button disabled={isSubmitting} onClick={leaveEditor} type="button" variant="secondary">
                  <X className="h-4 w-4" aria-hidden="true" />
                  Cancel
                </Button>
              </>
            )}
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
