"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArrowLeft, FilePenLine, Image as ImageIcon, Link2, Plus, Save, Trash2, Video, X } from "lucide-react";
import { apiRequest, errorFromUnknown } from "./api";
import {
  normalizeOptions,
  parseJsonObject,
  stringifyJson
} from "./form-utils";
import {
  blanketDistractorRationale,
  buildDistractorRationalesFromTeacherNotes,
  buildItemAdministrationRulesFromTeacherMetadata,
  earlierOptionNoteText,
  ESSENTIAL_ELEMENTS_RANGE,
  essentialElementsList,
  readLegacyDistractorNote,
  readOptionRationales,
  readTeacherItemMetadata,
  type TeacherDiagnosticOptionNote
} from "@/lib/services/content/teacher-diagnostic-context";
import type { AssessmentDetail, ItemDetail, ItemMediaAsset, ItemOption, StructuredApiError } from "./types";
import { ItemContent, ItemContentAuthoringPreview } from "@/components/item-content";
import { ItemVideoEmbed } from "@/components/item-media-video";
import type { ItemMediaPlacementValue } from "@/lib/item-content/media-placement";
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

type CreateAssessmentRevisionResponse = {
  revision: {
    revision_assessment_public_id: string;
    target_item_public_id: string | null;
  };
};

type SaveIntent = "add_another" | "return" | "stay";

// Teacher notes for one option, kept in the same order as the options so that removing or
// relabelling an option moves its notes with it. "preserved" keeps older note fields.
type OptionNoteDraft = {
  rationale: string;
  idea_label: string;
  preserved: TeacherDiagnosticOptionNote | null;
};

const IDEA_LABEL_MAX_LENGTH = 60;

function blankOptionNote(): OptionNoteDraft {
  return { rationale: "", idea_label: "", preserved: null };
}

function optionNotesForSave(
  options: ItemOption[],
  drafts: OptionNoteDraft[],
  correctOption: string
): TeacherDiagnosticOptionNote[] {
  return options.flatMap((option, index) => {
    const label = option.label.trim();
    if (!label || label === correctOption) return [];
    const draft = drafts[index] ?? blankOptionNote();
    const preserved: Partial<TeacherDiagnosticOptionNote> = { ...(draft.preserved ?? {}) };
    delete preserved.label;
    delete preserved.misconception_reasoning_pattern;
    delete preserved.idea_label;
    return [{
      ...preserved,
      label,
      misconception_reasoning_pattern: draft.rationale.trim() || undefined,
      idea_label: draft.idea_label.trim() || undefined
    }];
  });
}

type ItemMediaDraft = {
  media_public_id?: string;
  placement: ItemMediaPlacementValue;
  option_label: string | null;
  media_type: "image" | "video" | "reference_link";
  source_type: "uploaded" | "external_url";
  public_or_signed_url: string | null;
  external_url: string | null;
  title: string;
  alt_text_or_description: string;
  student_alt_text: string;
  teacher_llm_media_description: string;
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
    alt_text_or_description: asset.student_alt_text ?? asset.alt_text_or_description,
    student_alt_text: asset.student_alt_text ?? asset.alt_text_or_description,
    teacher_llm_media_description:
      asset.teacher_llm_media_description ?? asset.alt_text_or_description,
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
    student_alt_text: "",
    teacher_llm_media_description: "",
    caption: "",
    transcript_or_content_summary: "",
    source_attribution: "",
    order_index: orderIndex,
    active: true
  };
}

function mediaDraftToInput(asset: ItemMediaDraft, orderIndex: number) {
  const studentAltText = asset.student_alt_text.trim() || asset.alt_text_or_description.trim();

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
    alt_text_or_description: studentAltText,
    student_alt_text: studentAltText,
    teacher_llm_media_description:
      asset.teacher_llm_media_description.trim() || studentAltText,
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
                {asset.placement === "explanation" ? " with the explanation" : ""}
              </span>
            </div>
            {asset.media_type === "video" && url ? (
              <div className="mt-2">
                <ItemVideoEmbed title={asset.title || asset.student_alt_text || "Item video"} url={url} />
              </div>
            ) : null}
            {asset.media_type === "image" && url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                alt={asset.student_alt_text || asset.alt_text_or_description || "Item media preview"}
                className="mt-2 max-h-56 w-full rounded-md object-contain"
                src={url}
              />
            ) : url ? (
              <p className="mt-2 break-all text-accent">{url}</p>
            ) : null}
            {asset.title ? <figcaption className="mt-2 font-semibold text-ink">{asset.title}</figcaption> : null}
            <p className="mt-1 leading-6 text-muted">
              {asset.student_alt_text || asset.alt_text_or_description || "Student alt text is required before saving."}
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
  const [optionNotes, setOptionNotes] = useState<OptionNoteDraft[]>(() => defaultOptions().map(blankOptionNote));
  // The older single note for all distractors. Shown (and kept) only when the item has one.
  const [legacyDistractorNote, setLegacyDistractorNote] = useState("");
  const [showLegacyDistractorNote, setShowLegacyDistractorNote] = useState(false);
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
  const [showRevisionForm, setShowRevisionForm] = useState(false);
  const [revisionReason, setRevisionReason] = useState("");
  const [isCreatingRevision, setIsCreatingRevision] = useState(false);

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
      const loadedOptions = normalizeOptions(loaded.options);
      const rationales = readOptionRationales({
        administration_rules: loaded.administration_rules,
        distractor_rationales: loaded.distractor_rationales,
        option_labels: loadedOptions.map((option) => option.label),
        correct_option: loaded.correct_option
      });
      setOptionNotes(
        loadedOptions.map((option) => {
          const preserved =
            metadata.option_notes.find(
              (note) => note.label.trim().toUpperCase() === option.label.trim().toUpperCase()
            ) ?? null;
          const entry = rationales.find((candidate) => candidate.label === option.label);
          return {
            rationale: entry?.rationale || preserved?.misconception_reasoning_pattern || "",
            idea_label: entry?.idea_label || preserved?.idea_label || "",
            preserved
          };
        })
      );
      const legacyNote =
        readLegacyDistractorNote(loaded.administration_rules) ||
        blanketDistractorRationale({
          distractor_rationales: loaded.distractor_rationales,
          option_labels: loadedOptions.map((option) => option.label),
          correct_option: loaded.correct_option
        });
      setLegacyDistractorNote(legacyNote);
      setShowLegacyDistractorNote(Boolean(legacyNote));
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
    setOptionNotes((current) => [...current, blankOptionNote()]);
  }

  function updateOptionNote(index: number, patch: Partial<Omit<OptionNoteDraft, "preserved">>) {
    markDirty();
    setOptionNotes((current) => {
      const next = [...current];
      while (next.length <= index) next.push(blankOptionNote());
      next[index] = { ...next[index], ...patch };
      return next;
    });
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
    setOptionNotes((current) => current.filter((_, optionIndex) => optionIndex !== index));
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
    setOptionNotes(defaultOptions().map(blankOptionNote));
    setLegacyDistractorNote("");
    setShowLegacyDistractorNote(false);
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

    // Essential elements are required for publishing (item-publication-rules), not for saving
    // a draft, so an instructor can save work in progress.

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

  function addMediaAsset(mediaType: ItemMediaDraft["media_type"] = "image") {
    markDirty();
    setMediaAssets((current) => [
      ...current,
      {
        ...blankMediaDraft(current.length),
        media_type: mediaType,
        title:
          mediaType === "image"
            ? "Image"
            : mediaType === "video"
              ? "Video link"
              : "Reference link"
      }
    ]);
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
                patch.placement === "item_stem" || patch.placement === "explanation"
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
      const savedOptionNotes = optionNotesForSave(options, optionNotes, correctOption);
      const legacyNoteToKeep = showLegacyDistractorNote ? legacyDistractorNote : "";
      const administration_rules = buildItemAdministrationRulesFromTeacherMetadata({
        administration_rules: advancedRules,
        metadata: {
          item_label: itemLabel,
          item_purpose: "initial_item",
          expected_reasoning_note: expectedReasoningNote,
          item_diagnostic_value_note: itemDiagnosticValueNote,
          plain_language_distractor_diagnostic_notes: legacyNoteToKeep,
          correct_option_notes: {
            target_reasoning_note: targetReasoningNote,
            strong_reasoning_should_mention: strongReasoningNote
          },
          option_notes: savedOptionNotes
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
          option_notes: savedOptionNotes,
          plain_language_distractor_diagnostic_notes: legacyNoteToKeep
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

  async function createCorrectedItemVersion() {
    if (!item?.assessment_public_id || !itemPublicId) {
      return;
    }

    const reason = revisionReason.trim();
    if (reason.length < 5) {
      setError({
        code: "validation_failed",
        message: "Briefly describe what needs correction."
      });
      return;
    }

    setIsCreatingRevision(true);
    setError(null);

    try {
      const data = await apiRequest<CreateAssessmentRevisionResponse>(
        `/api/teacher/assessments/${item.assessment_public_id}/revision`,
        {
          method: "POST",
          body: JSON.stringify({
            revision_reason: reason,
            source_item_public_id: itemPublicId
          })
        }
      );
      router.push(
        data.revision.target_item_public_id
          ? `/teacher/content/items/${data.revision.target_item_public_id}`
          : `/teacher/content/assessments/${data.revision.revision_assessment_public_id}`
      );
    } catch (caught) {
      setError(errorFromUnknown(caught));
    } finally {
      setIsCreatingRevision(false);
    }
  }

  const title = props.mode === "create" ? "Add MCQ item" : "Edit MCQ item";
  const essentialElements = essentialElementsList(strongReasoningNote);
  const essentialElementCount = essentialElements.length;
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
    ? "Student data collection has started. The administered content is now read-only to preserve the session record."
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
          { label: "Assessment library", href: "/teacher/content/assessments" },
          { label: assessmentTitle, href: assessmentHref },
          { label: title }
        ]}
      />
      <PageHeader
        title={title}
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
              <div className="mb-5 rounded-md border border-line bg-slate-50 p-4 text-sm leading-6 text-muted">
                <p>{readOnlyReason}</p>
                {item.is_content_locked ? (
                  <div className="mt-3">
                    {!showRevisionForm ? (
                      <Button onClick={() => setShowRevisionForm(true)} type="button" variant="secondary">
                        <FilePenLine className="h-4 w-4" aria-hidden="true" />
                        Correct for future attempts
                      </Button>
                    ) : (
                      <div className="space-y-3">
                        <Field label="Reason for correction">
                          <textarea
                            className="min-h-24 rounded-md border border-line bg-white px-3 py-2 text-ink outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
                            onChange={(event) => setRevisionReason(event.target.value)}
                            placeholder="Describe the wording, option, or answer-key issue."
                            value={revisionReason}
                          />
                        </Field>
                        <p>
                          A new editable mini-test version will be created. Existing attempts and
                          responses will continue to use this version unchanged.
                        </p>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            disabled={isCreatingRevision}
                            onClick={createCorrectedItemVersion}
                            type="button"
                          >
                            <FilePenLine className="h-4 w-4" aria-hidden="true" />
                            {isCreatingRevision ? "Creating" : "Create editable correction"}
                          </Button>
                          <Button
                            disabled={isCreatingRevision}
                            onClick={() => {
                              setShowRevisionForm(false);
                              setRevisionReason("");
                            }}
                            type="button"
                            variant="secondary"
                          >
                            <X className="h-4 w-4" aria-hidden="true" />
                            Cancel
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
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

              <section className="rounded-lg border border-line bg-slate-50 p-4" aria-labelledby="item-stem-composer-heading">
                <div className="flex flex-col gap-3 border-b border-line pb-4 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-ink" id="item-stem-composer-heading">
                      Item stem
                    </h2>
                    <p className="mt-1 text-sm leading-6 text-muted">
                      Write the item wording and place images, video links, or reference links in the same ordered stem sequence.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2" aria-label="Add media to item stem">
                    <Button
                      aria-label="Add image to item stem"
                      disabled={!isEditable}
                      onClick={() => addMediaAsset("image")}
                      type="button"
                      variant="secondary"
                    >
                      <ImageIcon className="h-4 w-4" aria-hidden="true" />
                      Add image
                    </Button>
                    <Button
                      aria-label="Add video link to item stem"
                      disabled={!isEditable}
                      onClick={() => addMediaAsset("video")}
                      type="button"
                      variant="secondary"
                    >
                      <Video className="h-4 w-4" aria-hidden="true" />
                      Add video
                    </Button>
                    <Button
                      aria-label="Add reference link to item stem"
                      disabled={!isEditable}
                      onClick={() => addMediaAsset("reference_link")}
                      type="button"
                      variant="secondary"
                    >
                      <Link2 className="h-4 w-4" aria-hidden="true" />
                      Add reference link
                    </Button>
                  </div>
                </div>
                <Field label="Item wording">
                  <textarea
                    className="min-h-36 rounded-md border border-line bg-white px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
                    disabled={!isEditable}
                    onChange={(event) => {
                      markDirty();
                      setItemStem(event.target.value);
                    }}
                    required
                    value={itemStem}
                  />
                </Field>
                <ItemContentAuthoringPreview testId="item-stem-authoring-preview" text={itemStem} />
                <p className="mt-3 rounded-md border border-line bg-white p-3 text-xs leading-5 text-muted">
                  Image upload storage is disabled until a server-side storage provider is configured. Use HTTPS URLs for now. PNG, JPEG, and WebP uploads are validated server-side when storage is enabled; SVG and video binary uploads are not accepted.
                </p>
                {mediaAssets.length === 0 ? (
                  <p className="mt-4 text-sm text-muted">No stem media attached.</p>
                ) : (
                  <div className="mt-4 space-y-4">
                    {mediaAssets.map((media, mediaIndex) => (
                      <div
                        className="rounded-lg border border-line bg-white p-4"
                        data-testid={`teacher-media-row-${mediaIndex}`}
                        key={media.media_public_id ?? `new-media-${mediaIndex}`}
                      >
                        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                          <div className="flex items-center gap-2 text-sm font-semibold text-ink">
                            {mediaIcon(media.media_type)}
                            Stem media {mediaIndex + 1}
                            {media.placement === "option" && media.option_label ? (
                              <span className="text-xs font-normal text-muted">
                                currently attached to option {media.option_label}
                              </span>
                            ) : null}
                            {media.placement === "explanation" ? (
                              <span className="text-xs font-normal text-muted">
                                shown with the explanation in the answer review
                              </span>
                            ) : null}
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              aria-label={`Move stem media ${mediaIndex + 1} up`}
                              disabled={!isEditable || mediaIndex === 0}
                              onClick={() => moveMediaAsset(mediaIndex, -1)}
                              type="button"
                              variant="secondary"
                            >
                              Move up
                            </Button>
                            <Button
                              aria-label={`Move stem media ${mediaIndex + 1} down`}
                              disabled={!isEditable || mediaIndex === mediaAssets.length - 1}
                              onClick={() => moveMediaAsset(mediaIndex, 1)}
                              type="button"
                              variant="secondary"
                            >
                              Move down
                            </Button>
                            <Button
                              aria-label={`Remove stem media ${mediaIndex + 1}`}
                              disabled={!isEditable}
                              onClick={() => removeMediaAsset(mediaIndex)}
                              type="button"
                              variant="danger"
                            >
                              <Trash2 className="h-4 w-4" aria-hidden="true" />
                              Remove
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
                          <Field
                            label="Shown with"
                            hint="Explanation media is shown to students only in the answer review, after they submit."
                          >
                            <select
                              className="rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
                              data-testid={`teacher-media-placement-${mediaIndex}`}
                              disabled={!isEditable}
                              onChange={(event) => {
                                const value = event.target.value;
                                if (value.startsWith("option:")) {
                                  updateMediaAsset(mediaIndex, { placement: "option", option_label: value.slice(7) });
                                } else {
                                  updateMediaAsset(mediaIndex, { placement: value === "explanation" ? "explanation" : "item_stem" });
                                }
                              }}
                              value={
                                media.placement === "option" && media.option_label
                                  ? `option:${media.option_label}`
                                  : media.placement === "explanation"
                                    ? "explanation"
                                    : "item_stem"
                              }
                            >
                              <option value="item_stem">Question text</option>
                              {optionLabels.map((label) => (
                                <option key={`placement-option-${label}`} value={`option:${label}`}>
                                  Option {label}
                                </option>
                              ))}
                              <option value="explanation">Explanation (answer review)</option>
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
                          <Field label="Student alt text">
                            <textarea
                              className="min-h-20 rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
                              disabled={!isEditable}
                              onChange={(event) =>
                                updateMediaAsset(mediaIndex, {
                                  alt_text_or_description: event.target.value,
                                  student_alt_text: event.target.value
                                })
                              }
                              required
                              value={media.student_alt_text}
                            />
                          </Field>
                          <Field label="Teacher-only LLM media description (optional)">
                            <textarea
                              className="min-h-20 rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
                              disabled={!isEditable}
                              onChange={(event) =>
                                updateMediaAsset(mediaIndex, {
                                  teacher_llm_media_description: event.target.value
                                })
                              }
                              value={media.teacher_llm_media_description}
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
                <div className="mt-5 grid gap-4 lg:grid-cols-2">
                  <div className="rounded-md border border-line bg-white p-4">
                    <h3 className="text-sm font-semibold text-ink">Teacher preview</h3>
                    <ItemContent className="mt-2 whitespace-pre-wrap text-sm leading-6 text-ink" text={itemStem || "Item stem will appear here."} />
                    <MediaDraftPreview mediaAssets={mediaAssets.filter((media) => media.placement === "item_stem")} />
                  </div>
                  <div className="rounded-md border border-line bg-white p-4">
                    <h3 className="text-sm font-semibold text-ink">Student preview</h3>
                    <ItemContent className="mt-2 whitespace-pre-wrap text-sm leading-6 text-ink" text={itemStem || "Item stem will appear here."} />
                    <MediaDraftPreview mediaAssets={mediaAssets.filter((media) => media.placement === "item_stem")} />
                  </div>
                </div>
              </section>

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
                    <ItemContentAuthoringPreview showHint={false} testId={`option-authoring-preview-${option.label}`} text={option.text} />
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

          <section className="rounded-lg border border-line bg-white p-5 shadow-soft" aria-labelledby="item-reasoning-heading">
            <h2 className="text-xl font-semibold text-ink" id="item-reasoning-heading">
              Reasoning and distractors
            </h2>
            <p className="mt-1 text-sm leading-6 text-muted">
              Teacher-only. Students never see the key or these notes. Rationales describe ideas a student might
              hold; they are hypotheses, not judgments of any student.
            </p>
            <div className="mt-5 grid gap-4">
              <Field
                label="Target reasoning note (optional)"
                hint="What a student needs to understand to reach the correct answer."
              >
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
              <ItemContentAuthoringPreview testId="target-reasoning-authoring-preview" text={targetReasoningNote} />
              <Field
                label="Essential elements (1 to 3)"
                hint="One per line: only the points an explanation must state to justify the correct answer. An explanation missing any of them is rated limited, so leave out extras. Required before publishing."
              >
                <textarea
                  aria-describedby="essential-elements-count"
                  className="min-h-20 rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
                  disabled={!isEditable}
                  onChange={(event) => {
                    markDirty();
                    setStrongReasoningNote(event.target.value);
                  }}
                  placeholder={"Reliability is consistency of scores\nHigh reliability does not establish validity"}
                  value={strongReasoningNote}
                />
              </Field>
              <p
                className={`-mt-2 text-xs ${essentialElementCount >= ESSENTIAL_ELEMENTS_RANGE.min && essentialElementCount <= ESSENTIAL_ELEMENTS_RANGE.max ? "text-muted" : "text-amber-800"}`}
                id="essential-elements-count"
              >
                {essentialElementCount} listed{essentialElementCount >= ESSENTIAL_ELEMENTS_RANGE.min && essentialElementCount <= ESSENTIAL_ELEMENTS_RANGE.max ? "" : " (one to three are needed before publishing; you can save a draft now)"}
              </p>

              <div className="grid gap-3">
                <h3 className="text-sm font-semibold text-ink">Incorrect options</h3>
                {options.every((option) => option.label === correctOption) ? (
                  <p className="text-sm text-muted">Add options to describe them here.</p>
                ) : null}
                {options.map((option, index) => {
                  if (option.label === correctOption) return null;
                  const note = optionNotes[index] ?? blankOptionNote();
                  const earlier = earlierOptionNoteText(note.preserved);
                  return (
                    <div
                      className="grid gap-3 rounded-md border border-line p-3"
                      data-testid={`option-rationale-${option.label}`}
                      key={`option-notes-${index}`}
                    >
                      <p className="text-sm font-semibold text-ink">
                        Option {option.label}
                        {option.text ? (
                          <ItemContent as="span" className="ml-2 font-normal text-muted" text={option.text} />
                        ) : null}
                      </p>
                      <Field label="Why a student might choose this option">
                        <textarea
                          className="min-h-16 rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
                          disabled={!isEditable}
                          onChange={(event) => updateOptionNote(index, { rationale: event.target.value })}
                          placeholder="The specific incorrect idea that could lead to this choice."
                          value={note.rationale}
                        />
                      </Field>
                      <ItemContentAuthoringPreview showHint={false} text={note.rationale} />
                      <Field
                        label="Idea label (optional)"
                        hint="A few words. Two chosen options in a mini test with the same label show as an answer pattern."
                      >
                        <input
                          className="rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
                          disabled={!isEditable}
                          maxLength={IDEA_LABEL_MAX_LENGTH}
                          onChange={(event) => updateOptionNote(index, { idea_label: event.target.value })}
                          placeholder="reliability = validity"
                          value={note.idea_label}
                        />
                      </Field>
                      {earlier && earlier !== legacyDistractorNote.trim() ? (
                        <p className="text-xs leading-5 text-muted">
                          <span className="font-semibold">Earlier note for this option (kept):</span> {earlier}
                        </p>
                      ) : null}
                    </div>
                  );
                })}
              </div>

              {showLegacyDistractorNote ? (
                <Field
                  label="Earlier note for all options"
                  hint="From the older single note box. It is kept as written; move each point into the option it describes."
                >
                  <textarea
                    className="min-h-24 rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
                    disabled={!isEditable}
                    onChange={(event) => {
                      markDirty();
                      setLegacyDistractorNote(event.target.value);
                    }}
                    value={legacyDistractorNote}
                  />
                </Field>
              ) : null}
            </div>
          </section>

          <section className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-lg border border-line bg-white p-5 shadow-soft" id="student-preview">
              <h2 className="text-xl font-semibold text-ink">Student preview</h2>
              <p className="mt-1 text-sm text-muted">
                Students see only the stem and option text during protected administration.
              </p>
              <div className="mt-4 rounded-md border border-line bg-slate-50 p-4">
                <ItemContent className="whitespace-pre-wrap text-sm leading-6 text-ink" text={itemStem || "Item stem will appear here."} />
                <MediaDraftPreview
                  mediaAssets={mediaAssets.filter((media) => media.placement === "item_stem")}
                />
                <ol className="mt-4 space-y-2">
                  {options.map((option) => (
                    <li className="text-sm text-ink" key={`student-preview-${option.label}`}>
                      <span className="font-semibold">{option.label || "?"}.</span>{" "}
                      <ItemContent inline text={option.text || "Option text"} />
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
                  <ItemContent as="dd" className="whitespace-pre-wrap text-ink" text={targetReasoningNote || "No target reasoning note yet."} />
                  <MediaDraftPreview
                    compact
                    mediaAssets={mediaAssets.filter((media) => media.placement === "explanation")}
                  />
                </div>
                <div>
                  <dt className="text-muted">Essential elements</dt>
                  <dd className="text-ink">
                    {essentialElements.length > 0 ? (
                      <ol className="list-decimal space-y-1 pl-5">
                        {essentialElements.map((element, index) => (
                          <li key={`essential-${index}`}>{element}</li>
                        ))}
                      </ol>
                    ) : (
                      "None listed yet."
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted">Why a student might choose each incorrect option</dt>
                  <dd className="text-ink">
                    <ul className="space-y-1">
                      {options.map((option, index) =>
                        option.label === correctOption ? null : (
                          <li key={`preview-rationale-${index}`}>
                            <span className="font-semibold">{option.label}.</span>{" "}
                            <ItemContent inline text={optionNotes[index]?.rationale.trim() || "No rationale yet."} />
                            {optionNotes[index]?.idea_label.trim() ? (
                              <span className="ml-1 text-muted">({optionNotes[index]?.idea_label.trim()})</span>
                            ) : null}
                          </li>
                        )
                      )}
                    </ul>
                    {showLegacyDistractorNote && legacyDistractorNote.trim() ? (
                      <p className="mt-2 whitespace-pre-wrap text-muted">Earlier note for all options: {legacyDistractorNote}</p>
                    ) : null}
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
