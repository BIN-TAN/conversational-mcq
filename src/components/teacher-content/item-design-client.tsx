"use client";

import { type FormEvent, type ReactNode, type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  BookOpenCheck,
  CheckCircle2,
  ChevronDown,
  FileText,
  MessageSquareText,
  Paperclip,
  PencilLine,
  Plus,
  Save,
  Send,
  Sparkles,
  Trash2,
  X
} from "lucide-react";
import { SafeTutorMessageMarkdown } from "@/components/safe-tutor-message-markdown";
import { useUnsavedChanges } from "@/components/ui/use-unsaved-changes";
import { WorkspaceTabs } from "@/components/ui/workspace-tabs";
import { apiRequest, ClientApiError, errorFromUnknown } from "./api";
import { blueprintIssueLabels, normalizeBlueprint } from "./item-design-blueprint";
import {
  defaultItemDesignPath,
  ITEM_DESIGN_PATHS,
  itemDesignPathStarter,
  readStoredItemDesignPath,
  storeItemDesignPath,
  type ItemDesignPath
} from "./item-design-paths";
import { prepareTopicMiniTests, topicPreparationMessage, topicRunStepText, type TopicRunState } from "./topic-preparation";
import type { StructuredApiError } from "./types";
import { Button, collectIssues, ErrorPanel, Field, LoadingRow, PageHeader, SuccessPanel } from "./ui";

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

type CognitiveDemandBand =
  | "foundational"
  | "analyzing"
  | "evaluating"
  | "creating";

const COGNITIVE_DEMAND_OPTIONS: Array<{
  value: CognitiveDemandBand;
  label: string;
}> = [
  {
    value: "foundational",
    label: "Foundational: remembering, understanding, applying"
  },
  { value: "analyzing", label: "Analyzing" },
  { value: "evaluating", label: "Evaluating" },
  { value: "creating", label: "Creating" }
];

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
    difficulty_mix: CognitiveDemandBand[];
    context_notes: string | null;
  };
};

type AssistantMessage = {
  message_id: string;
  client_message_id: string;
  role: "teacher" | "assistant";
  message_text: string;
  created_at: string;
  agent_call_public_id: string | null;
  attachment_material_ids: string[];
};

type SourceMaterial = {
  material_id: string;
  file_name: string;
  media_type: string;
  source_kind: "docx" | "text" | "pdf" | "image";
  byte_size: number;
  sha256: string;
  content_summary: string;
  limitations: string[];
  warnings: string[];
  created_at: string;
};

type CourseTopic = {
  topic_id: string;
  title: string;
  summary: string;
  knowledge_points: string[];
  content_notes: string;
  source_items: Array<{ text: string; answer_note: string | null }>;
  source_material_ids: string[];
};

type TopicMiniTest = {
  topic_id: string;
  assessment_public_id: string;
  title: string;
  status: string;
  /** The latest generated drafts of that mini test, when there are any. */
  draft_review_url?: string | null;
};

type AssistantState = {
  ready_for_item_generation: boolean;
  topic_map?: { topics: CourseTopic[]; item_templates: Array<{ template_id: string; text: string }>; selected_topic_id: string | null };
  topic_bank_id?: string | null;
  change_summary: string[];
  remaining_questions: string[];
};

type DesignResponse = {
  assessment: { assessment_public_id: string; title: string; status: string; is_editable: boolean };
  concept_unit_public_id: string;
  concept_unit_version: number;
  blueprint: Blueprint;
  blueprint_hash: string;
  assistant_thread: {
    schema_version: "evidence-centered-item-design-thread-v1";
    messages: AssistantMessage[];
  };
  assistant_state: AssistantState;
  topic_mini_tests?: TopicMiniTest[];
  source_materials: SourceMaterial[];
};

const MAX_ASSISTANT_FILES = 5;
const MAX_ASSISTANT_FILE_BYTES = 15_000_000;
const MAX_ASSISTANT_TOTAL_BYTES = 30_000_000;
const ACCEPTED_ASSISTANT_FILES = ".pdf,.docx,.png,.jpg,.jpeg,.webp,.txt,.md,.csv,.json,.xlsx,.xls";

function fileSizeLabel(bytes: number) {
  if (bytes < 1_000_000) return `${Math.max(1, Math.round(bytes / 1000))} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

function localId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function lines(value: string) {
  return value.split("\n");
}

/** Names the design-panel entries a failed save needs, in the panel's own words. */
function describeBlueprintIssues(error: ClientApiError): ClientApiError {
  if (error.code !== "validation_failed") return error;
  const entries = blueprintIssueLabels(collectIssues(error.details).map((issue) => issue.path));
  if (entries.length === 0) return error;
  return new ClientApiError(
    {
      code: error.code,
      message: `The design panel has incomplete entries. Complete or remove them in Review design, then try again: ${entries.join("; ")}.`,
      details: error.details
    },
    error.status
  );
}

function DesignEntry({ title, summary, children }: { title: string; summary: string; children: ReactNode }) {
  const [open, setOpen] = useState(!summary.trim());
  return (
    <details className="group rounded-md border border-line bg-white" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="flex cursor-pointer list-none items-start justify-between gap-3 p-4 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="block font-semibold text-ink">{title}</span>
          {summary ? <span className="mt-1 block break-words text-sm text-muted">{summary}</span> : null}
        </span>
        <ChevronDown className="mt-1 h-4 w-4 shrink-0 transition group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="border-t border-line p-4">{children}</div>
    </details>
  );
}

function ItemDesignAssistantWorkspace({
  assistantFiles,
  assistantInput,
  blueprint,
  busy,
  design,
  error,
  onAssistantInputChange,
  onStarterSelect,
  onFilesAdd,
  onFileRemove,
  onOpenReview,
  onSend,
  onCreateTopicMiniTest,
  creatingTopicId,
  onGenerate,
  onImportExistingItems,
  existingItemFiles,
  onExistingItemFilesChange,
  accessibleWording,
  onAccessibleWordingChange,
  onPrepareOtherTopics,
  onStopTopicRun,
  topicRun,
  topicRunActive,
  topicRunStopping,
  readOnly,
  transcriptEndRef,
  path,
  onPathChoose,
  pendingMessage
}: {
  assistantFiles: File[];
  assistantInput: string;
  blueprint: Blueprint;
  busy: "load" | "save" | "assistant" | "generate" | "import" | null;
  design: DesignResponse;
  error: StructuredApiError | null;
  onAssistantInputChange: (value: string) => void;
  onStarterSelect: (prompt: string) => void;
  onFilesAdd: (files: File[]) => void;
  onFileRemove: (index: number) => void;
  onOpenReview: () => void;
  onSend: (event: FormEvent<HTMLFormElement>) => void;
  onCreateTopicMiniTest: (topicId: string) => void;
  creatingTopicId: string | null;
  onGenerate: () => void;
  onImportExistingItems: () => void;
  existingItemFiles: File[];
  onExistingItemFilesChange: (files: File[]) => void;
  accessibleWording: boolean;
  onAccessibleWordingChange: (value: boolean) => void;
  onPrepareOtherTopics: () => void;
  onStopTopicRun: () => void;
  topicRun: TopicRunState[] | null;
  topicRunActive: boolean;
  topicRunStopping: boolean;
  readOnly: boolean;
  transcriptEndRef: RefObject<HTMLDivElement | null>;
  path: ItemDesignPath | null;
  onPathChoose: (path: ItemDesignPath) => void;
  pendingMessage: { text: string; files: string[] } | null;
}) {
  const topicMap = design.assistant_state.topic_map ?? { topics: [], item_templates: [], selected_topic_id: null };
  const topicMiniTests = design.topic_mini_tests ?? [];
  const otherTopics = topicMap.topics.filter((topic) => topic.topic_id !== topicMap.selected_topic_id);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messageInputRef = useRef<HTMLTextAreaElement>(null);
  const evidenceCount = blueprint.objectives.reduce(
    (total, objective) => total + objective.evidence_requirements.filter(Boolean).length,
    0
  );
  const messages = design.assistant_thread.messages;
  const reviewRequest = `Plan for ${blueprint.generation_settings.target_item_count} items with ${blueprint.generation_settings.option_count} options each unless we agree otherwise. Fill in the design panel yourself and ask only essential questions, one at a time. Prepare the design for my review; do not generate items yet.`;
  // Further ways to start a new mini test, once the instructor has chosen to write new items.
  const newItemStarters = [
    {
      label: "Plan a topic-based test",
      icon: MessageSquareText,
      prompt: "Help me plan a mini test for one topic. First clarify the topic, student level, and scope if they are not already clear. Then propose measurable learning objectives, observable evidence, and a balanced mix of cognitive demands. Suggest how to distribute the items across objectives."
    },
    {
      label: "Probe common misconceptions",
      icon: Sparkles,
      prompt: "Help me turn the misconceptions or student-language examples I provide into a mini-test design. Ask for the topic and examples if missing. For each hypothesis, identify the related objective and reasoning evidence that could distinguish it from a slip, guessing, or incomplete explanation. Treat misconceptions as hypotheses to investigate, not established facts about students."
    }
  ];
  const chosenPath = ITEM_DESIGN_PATHS.find((entry) => entry.id === path) ?? null;
  const importBlock = design.assessment.is_editable ? (
    <div className={`rounded-md border p-3 ${path === "existing" ? "border-accent bg-[#F8FAF9]" : "border-line"}`}>
      <p className="text-sm font-medium text-ink">{path === "existing" ? "Bring your items into review" : "Already have items for this topic?"}</p>
      <p className="mt-1 text-xs leading-5 text-muted">
        The assistant reads the finished items for this topic in your course materials, or in files you attach here: PDF, Word, Excel, CSV, text or images. It keeps your wording and the keys your file states, and suggests any missing target reasoning, essential elements and notes on the wrong options. You review everything before an item is added.
      </p>
      <label className="mt-2 flex items-start gap-2 text-xs leading-5 text-ink">
        <input
          checked={accessibleWording}
          className="mt-1"
          disabled={readOnly || busy !== null}
          onChange={(event) => onAccessibleWordingChange(event.target.checked)}
          type="checkbox"
        />
        <span>
          Suggest simpler wording at a middle to high school reading level (grades 8 to 10). Key terms, symbols, numbers, formulas, tables, the options and the key stay the same. In review, each item starts with the simpler wording, and you can switch any item back to your own wording. Clear this box to keep every item as written.
        </span>
      </label>
      <label className="mt-2 block text-xs font-medium text-ink" htmlFor="existing-item-files">Files with your items (optional)</label>
      <input
        accept={ACCEPTED_ASSISTANT_FILES}
        className="mt-1 block w-full text-xs"
        disabled={readOnly || busy !== null}
        id="existing-item-files"
        multiple
        onChange={(event) => onExistingItemFilesChange(Array.from(event.target.files ?? []).slice(0, MAX_ASSISTANT_FILES))}
        type="file"
      />
      {existingItemFiles.length > 0 ? (
        <p className="mt-1 text-xs text-muted">{existingItemFiles.map((file) => file.name).join(", ")}</p>
      ) : null}
      <Button
        className="mt-2 w-full"
        disabled={readOnly || busy !== null}
        onClick={onImportExistingItems}
        type="button"
        variant={path === "existing" ? "primary" : "secondary"}
      >
        <FileText className="h-4 w-4" aria-hidden="true" />
        {busy === "import" ? "Reading your items" : "Import my items"}
      </Button>
      {busy === "import" ? (
        <p className="mt-2 text-xs leading-5 text-muted" role="status">
          Reading your items and checking each one. This takes a few minutes; keep this page open.
        </p>
      ) : null}
    </div>
  ) : null;
  const generateBlock = design.assistant_state.ready_for_item_generation && design.assessment.is_editable ? (
    <div className="rounded-md border border-line bg-[#F8FAF9] p-3">
      <p className="text-sm font-medium text-ink">
        {path === "existing" ? "New drafts as well (optional)" : "The design is ready for drafts."}
      </p>
      <p className="mt-1 text-xs leading-5 text-muted">
        {path === "existing"
          ? "If you want more items than you have, the assistant can write new drafts from the same design. Writing and checking them takes a few minutes, and you review every draft."
          : "Writing the drafts and checking each one takes a few minutes. You read every item and confirm every answer key before anything is added."}
      </p>
      <Button
        className="mt-2 w-full"
        disabled={readOnly || busy !== null}
        onClick={onGenerate}
        type="button"
        variant={path === "existing" ? "secondary" : "primary"}
      >
        <Sparkles className="h-4 w-4" aria-hidden="true" />
        {busy === "generate" ? "Writing and checking drafts" : "Generate drafts"}
      </Button>
      {busy === "generate" ? (
        <p className="mt-2 text-xs leading-5 text-muted" role="status">This takes a few minutes. Keep this page open.</p>
      ) : null}
    </div>
  ) : path === "new" && design.assessment.is_editable ? (
    <div className="rounded-md border border-line bg-[#F8FAF9] p-3">
      <p className="text-sm font-medium text-ink">Drafts come after the design</p>
      <p className="mt-1 text-xs leading-5 text-muted">
        Send your course materials to the assistant first. Once the design panel is filled in and has no open questions, a Generate drafts button appears here.
      </p>
    </div>
  ) : null;

  return (
    <section className="overflow-hidden rounded-md border border-line bg-white shadow-soft">
      <div className="grid lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col lg:border-r lg:border-line">
          <header className="border-b border-line px-5 py-4">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent">
                <MessageSquareText className="h-5 w-5" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <h2 className="font-semibold text-ink">Item-design assistant</h2>
                <p className="text-sm text-muted">{design.assessment.title}</p>
              </div>
            </div>
            {messages.length > 0 ? (
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs" role="group" aria-label="Starting point">
                <span className="text-muted">Starting point:</span>
                {ITEM_DESIGN_PATHS.map((entry) => (
                  <button
                    aria-pressed={path === entry.id}
                    className={`rounded-md border px-2 py-1 font-medium transition hover:border-accent ${
                      path === entry.id ? "border-accent bg-accent-soft text-accent" : "border-line text-ink"
                    }`}
                    disabled={busy !== null}
                    key={entry.id}
                    onClick={() => onPathChoose(entry.id)}
                    type="button"
                  >
                    {entry.title}
                  </button>
                ))}
              </div>
            ) : null}
          </header>

          <div
            aria-live="polite"
            className="max-h-[55dvh] min-h-48 flex-1 space-y-4 overflow-y-auto bg-[#F8FAF9] px-4 py-5 sm:px-6"
            data-testid="item-design-assistant-transcript"
          >
            {messages.length === 0 ? (
              <div className="mx-auto max-w-2xl py-2">
                <div className="text-center">
                  <BookOpenCheck className="mx-auto h-8 w-8 text-accent" aria-hidden="true" />
                  <h3 className="mt-4 text-lg font-semibold text-ink">How would you like to start?</h3>
                  <p className="mt-1 text-sm leading-6 text-muted">
                    Either way, the assistant first fills in the item specifications with you, and you review them.
                  </p>
                </div>
                <div className="mt-5 grid gap-3 sm:grid-cols-2" role="group" aria-label="How to start">
                  {ITEM_DESIGN_PATHS.map((entry) => (
                    <button
                      aria-pressed={path === entry.id}
                      className={`flex min-w-0 flex-col gap-2 rounded-md border bg-white px-4 py-4 text-left transition hover:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60 ${
                        path === entry.id ? "border-accent ring-2 ring-accent-soft" : "border-line"
                      }`}
                      disabled={readOnly || busy !== null}
                      key={entry.id}
                      onClick={() => {
                        onPathChoose(entry.id);
                        requestAnimationFrame(() => messageInputRef.current?.focus());
                      }}
                      type="button"
                    >
                      <span className="flex items-center gap-2 text-sm font-semibold text-ink">
                        {entry.id === "existing"
                          ? <FileText className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
                          : <Sparkles className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />}
                        {entry.title}
                      </span>
                      <span className="text-xs leading-5 text-muted">{entry.description}</span>
                    </button>
                  ))}
                </div>
                {chosenPath ? (
                  <p className="mt-4 rounded-md border border-line bg-white px-3 py-2 text-sm leading-6 text-ink" role="status">
                    {chosenPath.next_step}
                  </p>
                ) : null}
                {path === "new" ? (
                  <div className="mt-3">
                    <p className="text-xs text-muted">Or start from a plan instead of materials:</p>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      {newItemStarters.map((suggestion) => (
                        <button
                          className="flex min-w-0 items-center gap-2 rounded-md border border-line bg-white px-3 py-2 text-left text-sm font-medium text-ink transition hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60"
                          disabled={readOnly || busy !== null}
                          key={suggestion.label}
                          onClick={() => {
                            onStarterSelect(`${suggestion.prompt}\n\n${reviewRequest}`);
                            requestAnimationFrame(() => messageInputRef.current?.focus());
                          }}
                          type="button"
                        >
                          <suggestion.icon className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
                          <span>{suggestion.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {messages.map((message) => {
              const attachments = message.attachment_material_ids.flatMap((materialId) => {
                const material = design.source_materials.find(
                  (entry) => entry.material_id === materialId
                );
                return material ? [material] : [];
              });
              return (
              <div
                className={`flex ${message.role === "teacher" ? "justify-end" : "justify-start"}`}
                key={message.message_id}
              >
                <div
                  className={
                    message.role === "teacher"
                      ? "max-w-[88%] rounded-md bg-accent px-4 py-3 text-sm leading-6 text-white sm:max-w-[78%]"
                      : "max-w-[92%] rounded-md border border-line bg-white px-4 py-3 text-ink sm:max-w-[84%]"
                  }
                >
                  {message.role === "assistant" ? (
                    <SafeTutorMessageMarkdown message={message.message_text} />
                  ) : (
                    <p className="whitespace-pre-wrap">{message.message_text}</p>
                  )}
                  {attachments.length > 0 ? (
                    <ul
                      className={`mt-3 space-y-1 border-t pt-2 text-xs ${
                        message.role === "teacher"
                          ? "border-white/30 text-white"
                          : "border-line text-muted"
                      }`}
                    >
                      {attachments.map((material) => (
                        <li className="flex items-center gap-2" key={material.material_id}>
                          <Paperclip className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                          <span className="min-w-0 truncate">{material.file_name}</span>
                          <span className="shrink-0 opacity-80">
                            {fileSizeLabel(material.byte_size)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </div>
              );
            })}

            {busy === "assistant" && pendingMessage ? (
              <div className="flex justify-end">
                <div className="max-w-[88%] rounded-md bg-accent px-4 py-3 text-sm leading-6 text-white sm:max-w-[78%]">
                  <p className="whitespace-pre-wrap">{pendingMessage.text}</p>
                  {pendingMessage.files.length > 0 ? (
                    <ul className="mt-3 space-y-1 border-t border-white/30 pt-2 text-xs text-white">
                      {pendingMessage.files.map((name) => (
                        <li className="flex items-center gap-2" key={name}>
                          <Paperclip className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                          <span className="min-w-0 truncate">{name}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </div>
            ) : null}
            {busy === "assistant" ? (
              <div className="flex justify-start">
                <div className="rounded-md border border-line bg-white px-4 py-3 text-sm text-muted">
                  Reading your material and updating the design. This can take a few minutes.
                </div>
              </div>
            ) : null}
            <div ref={transcriptEndRef} />
          </div>

          <form className="border-t border-line bg-white p-4" onSubmit={onSend}>
            <ErrorPanel error={error} focusOnError />
            <label className="sr-only" htmlFor="item-design-assistant-message">
              Message the item-design assistant
            </label>
            <textarea
              className="min-h-28 w-full resize-y rounded-md border border-line px-3 py-3 text-sm leading-6 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
              disabled={readOnly || busy !== null}
              id="item-design-assistant-message"
              maxLength={20000}
              onChange={(event) => onAssistantInputChange(event.target.value)}
              placeholder="Describe the topic, paste course material, list objectives, or add exemplar items..."
              ref={messageInputRef}
              rows={6}
              value={assistantInput}
            />
            <input
              accept={ACCEPTED_ASSISTANT_FILES}
              aria-label="Course material files"
              className="sr-only"
              disabled={readOnly || busy !== null}
              multiple
              onChange={(event) => {
                onFilesAdd(Array.from(event.target.files ?? []));
                event.target.value = "";
              }}
              ref={fileInputRef}
              type="file"
            />
            {assistantFiles.length > 0 ? (
              <ul className="mt-3 grid gap-2 sm:grid-cols-2" aria-label="Selected course materials">
                {assistantFiles.map((file, index) => (
                  <li
                    className="flex min-w-0 items-center gap-2 rounded-md border border-line bg-[#F8FAF9] px-3 py-2 text-sm"
                    key={`${file.name}_${file.size}_${file.lastModified}_${index}`}
                  >
                    <Paperclip className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate text-ink">{file.name}</span>
                    <span className="shrink-0 text-xs text-muted">{fileSizeLabel(file.size)}</span>
                    <button
                      aria-label={`Remove ${file.name}`}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted transition hover:bg-white hover:text-ink"
                      disabled={readOnly || busy !== null}
                      onClick={() => onFileRemove(index)}
                      type="button"
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <button
                  className="inline-flex h-9 items-center gap-2 rounded-md border border-line bg-white px-3 text-sm font-semibold text-ink transition hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={readOnly || busy !== null || assistantFiles.length >= MAX_ASSISTANT_FILES}
                  onClick={() => fileInputRef.current?.click()}
                  type="button"
                >
                  <Paperclip className="h-4 w-4" aria-hidden="true" />
                  Add files (PDF, Word, Excel, text or images)
                </button>
                <p className="text-xs leading-5 text-muted">Up to 5 files, 15 MB each, 30 MB total.</p>
              </div>
              <div className="flex items-center justify-end gap-2">
                <p className="hidden max-w-xs text-right text-xs leading-5 text-muted xl:block">
                  You will review all design details and answer keys before items are added.
                </p>
                <Button
                  className="shrink-0"
                  disabled={
                    readOnly ||
                    busy !== null ||
                    (!assistantInput.trim() && assistantFiles.length === 0)
                  }
                  type="submit"
                >
                  <Send className="h-4 w-4" aria-hidden="true" />
                  {busy === "assistant" ? "Working" : "Send"}
                </Button>
              </div>
            </div>
          </form>
        </div>

        <aside className="border-t border-line bg-white lg:border-t-0">
          <div className="border-b border-line px-5 py-4">
            <h2 className="font-semibold text-ink">Current design</h2>
            <p className="mt-1 text-sm leading-5 text-muted">Updated as you work with the assistant.</p>
          </div>
          <div className="space-y-5 p-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Section or topic</p>
              <p className="mt-1 text-sm font-medium leading-6 text-ink">{blueprint.section_topic}</p>
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-4 border-y border-line py-4 text-sm">
              <div>
                <dt className="text-muted">Objectives</dt>
                <dd className="mt-1 text-lg font-semibold text-ink">{blueprint.objectives.length}</dd>
              </div>
              <div>
                <dt className="text-muted">Evidence points</dt>
                <dd className="mt-1 text-lg font-semibold text-ink">{evidenceCount}</dd>
              </div>
              <div>
                <dt className="text-muted">Misconceptions</dt>
                <dd className="mt-1 text-lg font-semibold text-ink">{blueprint.misconception_hypotheses.length}</dd>
              </div>
              <div>
                <dt className="text-muted">Example items</dt>
                <dd className="mt-1 text-lg font-semibold text-ink">{blueprint.exemplar_items.length}</dd>
              </div>
            </dl>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Planned items</p>
              <p className="mt-1 text-sm leading-6 text-ink">
                {blueprint.generation_settings.target_item_count} items, {blueprint.generation_settings.option_count} options each
              </p>
            </div>

            {design.source_materials.length > 0 ? (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                  Course materials ({design.source_materials.length})
                </p>
                <ul className="mt-2 space-y-2">
                  {design.source_materials.slice(-4).reverse().map((material) => (
                    <li className="flex min-w-0 items-center gap-2 text-sm text-ink" key={material.material_id}>
                      <Paperclip className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate">{material.file_name}</span>
                    </li>
                  ))}
                </ul>
                {design.source_materials.length > 4 ? (
                  <p className="mt-2 text-xs text-muted">
                    {design.source_materials.length - 4} earlier material{design.source_materials.length - 4 === 1 ? "" : "s"}
                  </p>
                ) : null}
              </div>
            ) : null}

            {topicMap.topics.length > 0 ? (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                  Course topic bank ({topicMap.topics.length} {topicMap.topics.length === 1 ? "topic" : "topics"})
                </p>
                <p className="mt-1 text-xs leading-5 text-muted">
                  One mini test per topic. The materials are kept, so the other topics need no new upload.
                </p>
                <ul className="mt-2 space-y-2">
                  {topicMap.topics.map((topic) => {
                    const selected = topic.topic_id === topicMap.selected_topic_id;
                    const other = topicMiniTests.find((entry) =>
                      entry.topic_id === topic.topic_id && entry.assessment_public_id !== design.assessment.assessment_public_id);
                    return (
                      <li key={topic.topic_id}>
                        <details className="rounded-md border border-line" open={selected}>
                          <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-ink">
                            {topic.title}
                            {selected ? <span className="ml-2 text-xs font-semibold text-accent">This mini test</span> : null}
                          </summary>
                          <div className="border-t border-line px-3 py-2">
                            <ul className="list-disc space-y-1 pl-4 text-sm leading-5 text-muted">
                              {topic.knowledge_points.map((point) => <li key={point}>{point}</li>)}
                            </ul>
                            {selected ? null : other ? (
                              <div className="mt-2 space-y-1">
                                <a
                                  className="block text-sm font-semibold text-accent underline"
                                  href={`/teacher/content/assessments/${other.assessment_public_id}/item-design`}
                                >
                                  Open its mini test: {other.title}
                                </a>
                                {other.draft_review_url ? (
                                  <a className="block text-sm font-semibold text-accent underline" href={other.draft_review_url}>
                                    Review its drafts
                                  </a>
                                ) : null}
                              </div>
                            ) : (
                              <Button
                                className="mt-2 w-full"
                                disabled={creatingTopicId !== null || busy !== null || topicRunActive}
                                onClick={() => onCreateTopicMiniTest(topic.topic_id)}
                                type="button"
                                variant="secondary"
                              >
                                {creatingTopicId === topic.topic_id ? "Creating…" : "Create a mini test for this topic"}
                              </Button>
                            )}
                          </div>
                        </details>
                      </li>
                    );
                  })}
                </ul>
                {otherTopics.length > 0 && design.assessment.is_editable ? (
                  <div className="mt-3 space-y-2">
                    <Button
                      className="w-full"
                      disabled={busy !== null || creatingTopicId !== null || topicRunActive}
                      onClick={onPrepareOtherTopics}
                      type="button"
                      variant="secondary"
                    >
                      <Sparkles className="h-4 w-4" aria-hidden="true" />
                      {topicRunActive ? "Preparing the other topics" : `Prepare the other topics (${otherTopics.length})`}
                    </Button>
                    <p className="text-xs leading-5 text-muted">
                      For each topic, this creates its mini test, fills in the design panel and writes checked drafts for you to review. It takes a few minutes per topic, so keep this page open. You can stop and start again later; finished topics are kept.
                    </p>
                    {topicRun ? (
                      <ol className="space-y-2" aria-live="polite">
                        {topicRun.map((entry) => (
                          <li className="rounded-md border border-line px-3 py-2 text-sm" key={entry.topic_id}>
                            <p className="font-medium text-ink">{entry.title}</p>
                            <p className="text-xs text-muted">{topicRunStepText(entry.step)}</p>
                            {entry.note ? <p className="mt-1 text-xs leading-5 text-muted">{entry.note}</p> : null}
                            {entry.link ? (
                              <a className="mt-1 inline-block text-xs font-semibold text-accent underline" href={entry.link}>
                                {entry.step === "ready" ? "Review the drafts" : "Open the mini test"}
                              </a>
                            ) : null}
                          </li>
                        ))}
                      </ol>
                    ) : null}
                    {topicRunActive ? (
                      <Button className="w-full" disabled={topicRunStopping} onClick={onStopTopicRun} type="button" variant="secondary">
                        {topicRunStopping ? "Stopping after the current step" : "Stop after the current step"}
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}

            {design.assistant_state.change_summary.length > 0 ? (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">Latest changes</p>
                <ul className="mt-2 space-y-2 text-sm leading-5 text-ink">
                  {design.assistant_state.change_summary.map((entry) => (
                    <li className="flex gap-2" key={entry}>
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
                      <span>{entry}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {design.assistant_state.remaining_questions.length > 0 ? (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">Questions to resolve</p>
                <ul className="mt-2 list-disc space-y-2 pl-5 text-sm leading-5 text-ink">
                  {design.assistant_state.remaining_questions.map((entry) => <li key={entry}>{entry}</li>)}
                </ul>
              </div>
            ) : null}

            {path === "existing" ? <>{importBlock}{generateBlock}</> : <>{generateBlock}{importBlock}</>}

            <Button className="w-full" onClick={onOpenReview} type="button" variant="secondary">
              <PencilLine className="h-4 w-4" aria-hidden="true" />
              Review and edit design
            </Button>
          </div>
        </aside>
      </div>
    </section>
  );
}

export function ItemDesignClient({
  assessmentPublicId,
  initialView = "assistant",
  autoPrepareTopic = false
}: {
  assessmentPublicId: string;
  initialView?: "assistant" | "review";
  /** A mini test just created from the course topic bank: ask the assistant to fill its design panel. */
  autoPrepareTopic?: boolean;
}) {
  const router = useRouter();
  const [design, setDesign] = useState<DesignResponse | null>(null);
  const [blueprint, setBlueprint] = useState<Blueprint | null>(null);
  const [error, setError] = useState<StructuredApiError | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState<"load" | "save" | "assistant" | "generate" | "import" | null>("load");
  const [existingItemFiles, setExistingItemFiles] = useState<File[]>([]);
  // Suggest simpler wording for imported items (on by default); the teacher chooses per item in review.
  const [accessibleWording, setAccessibleWording] = useState(true);
  const [view, setView] = useState<"assistant" | "review">(initialView);
  const [assistantInput, setAssistantInput] = useState("");
  const [assistantFiles, setAssistantFiles] = useState<File[]>([]);
  const [assistantClientMessageId, setAssistantClientMessageId] = useState<string | null>(null);
  const [creatingTopicId, setCreatingTopicId] = useState<string | null>(null);
  const [topicRun, setTopicRun] = useState<TopicRunState[] | null>(null);
  const [topicRunActive, setTopicRunActive] = useState(false);
  const stopTopicRun = useRef(false);
  const [topicRunStopping, setTopicRunStopping] = useState(false);
  const autoPrepareStarted = useRef(false);
  const [path, setPath] = useState<ItemDesignPath | null>(null);
  // The message being sent, shown in the conversation while the assistant works.
  const [pendingMessage, setPendingMessage] = useState<{ text: string; files: string[] } | null>(null);
  const pathRestored = useRef(false);
  // Files sent while adapting existing items; they come into review once the design is filled in.
  const pendingItemFiles = useRef<File[] | null>(null);
  const starterPrefixRef = useRef("");
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const isDirty = Boolean(blueprint && design && JSON.stringify(blueprint) !== JSON.stringify(design.blueprint));
  const { allowNavigation } = useUnsavedChanges(isDirty || Boolean(assistantInput.trim()) || assistantFiles.length > 0 || topicRunActive || (busy !== null && busy !== "load"));

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

  useEffect(() => {
    if (!design || pathRestored.current) return;
    pathRestored.current = true;
    const restored = defaultItemDesignPath(design, readStoredItemDesignPath(assessmentPublicId));
    setPath(restored);
    // A new design reopened in this browser: the chosen path's opening message is ready again.
    if (restored && design.assistant_thread.messages.length === 0 && design.assessment.is_editable && !autoPrepareTopic) {
      const prefix = `${itemDesignPathStarter(restored, design.blueprint.generation_settings)}\n\n`;
      starterPrefixRef.current = prefix;
      setAssistantInput((current) => current.trim() ? current : prefix);
    }
  }, [design, assessmentPublicId, autoPrepareTopic]);

  function handlePathChoose(next: ItemDesignPath) {
    if (!design || !blueprint) return;
    setPath(next);
    storeItemDesignPath(assessmentPublicId, next);
    if (design.assistant_thread.messages.length === 0 && design.assessment.is_editable) {
      handleStarterSelect(itemDesignPathStarter(next, blueprint.generation_settings));
    }
  }

  // A mini test created from the course topic bank: the assistant fills its design panel once.
  useEffect(() => {
    if (!autoPrepareTopic || autoPrepareStarted.current || !design || !blueprint || busy !== null) return;
    const topicMap = design.assistant_state.topic_map;
    const topic = topicMap?.topics.find((entry) => entry.topic_id === topicMap.selected_topic_id);
    if (!topic || design.assistant_thread.messages.length > 0 || !design.assessment.is_editable) return;
    autoPrepareStarted.current = true;
    router.replace(`/teacher/content/assessments/${assessmentPublicId}/item-design`);
    void sendAssistantMessage(topicPreparationMessage(topic.title));
    // sendAssistantMessage reads the current design; the guard above runs it once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPrepareTopic, design, blueprint, busy, assessmentPublicId, router]);

  useEffect(() => {
    if (view !== "assistant") return;
    const transcript = transcriptEndRef.current?.parentElement;
    if (transcript) transcript.scrollTop = transcript.scrollHeight;
  }, [busy, design?.assistant_thread.messages.length, view]);

  function updateBlueprint(updater: (current: Blueprint) => Blueprint) {
    if (busy !== null) return;
    setSuccess(null);
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
          blueprint: normalizeBlueprint(blueprint)
        })
      }
    ).catch((caught: unknown) => {
      throw caught instanceof ClientApiError ? describeBlueprintIssues(caught) : caught;
    });
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
      allowNavigation();
      router.push(generated.review_url);
    } catch (caught) {
      setError(errorFromUnknown(caught));
    } finally {
      setBusy(null);
    }
  }

  function handleAssistantInputChange(value: string) {
    setAssistantInput(value);
    if (busy !== "assistant") setAssistantClientMessageId(null);
  }

  function handleStarterSelect(prompt: string) {
    if (busy !== null || !design?.assessment.is_editable) return;
    // Replace only an untouched starter prefix, never teacher-written material.
    const material = starterPrefixRef.current && assistantInput.startsWith(starterPrefixRef.current)
      ? assistantInput.slice(starterPrefixRef.current.length)
      : assistantInput;
    const prefix = `${prompt}\n\n`;
    const message = prefix + material;
    if (message.length > 20000) {
      setError({ code: "validation_failed", message: "There is not enough room to add this starter. Shorten the message first; your text and attachments have not changed." });
      return;
    }
    setError(null);
    starterPrefixRef.current = prefix;
    handleAssistantInputChange(message);
  }

  function handleAssistantFilesAdd(files: File[]) {
    if (files.length === 0) return;
    const next = [...assistantFiles, ...files];
    if (next.length > MAX_ASSISTANT_FILES) {
      setError({
        code: "validation_failed",
        message: `Attach no more than ${MAX_ASSISTANT_FILES} files in one message.`
      });
      return;
    }
    const tooLarge = next.find((file) => file.size > MAX_ASSISTANT_FILE_BYTES);
    if (tooLarge) {
      setError({
        code: "validation_failed",
        message: `${tooLarge.name} is larger than the 15 MB attachment limit.`
      });
      return;
    }
    const totalBytes = next.reduce((total, file) => total + file.size, 0);
    if (totalBytes > MAX_ASSISTANT_TOTAL_BYTES) {
      setError({
        code: "validation_failed",
        message: "The selected course materials are too large to process together."
      });
      return;
    }
    setError(null);
    setAssistantFiles(next);
    setAssistantClientMessageId(null);
  }

  function handleAssistantFileRemove(index: number) {
    setAssistantFiles((current) => current.filter((_file, fileIndex) => fileIndex !== index));
    setAssistantClientMessageId(null);
  }

  async function handleAssistantSend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = assistantInput.trim() || (
      assistantFiles.length > 0
        ? "Please use the attached course materials to help refine this mini test."
        : ""
    );
    const sentFiles = assistantFiles;
    const response = await sendAssistantMessage(message);
    if (!response || path !== "existing") return;
    if (sentFiles.length > 0) {
      pendingItemFiles.current = sentFiles;
      setExistingItemFiles(sentFiles);
    }
    // Adapting existing items: once the assistant has filled in the design without open
    // questions, the items come into review. Otherwise the instructor answers first.
    if (pendingItemFiles.current && response.assistant_state.ready_for_item_generation &&
      response.assistant_state.remaining_questions.length === 0) {
      const files = pendingItemFiles.current;
      pendingItemFiles.current = null;
      await importExistingItems(files);
    }
  }

  async function handleCreateTopicMiniTest(topicId: string) {
    setCreatingTopicId(topicId);
    setError(null);
    setSuccess(null);
    try {
      const created = await apiRequest<{ assessment_public_id: string; builder_url: string; created: boolean }>(
        `/api/teacher/assessments/${assessmentPublicId}/item-design/topic-mini-test`,
        { method: "POST", body: JSON.stringify({ topic_id: topicId }) }
      );
      allowNavigation();
      router.push(created.builder_url);
    } catch (caught) {
      setError(errorFromUnknown(caught));
      setCreatingTopicId(null);
    }
  }

  async function handleImportExistingItems() {
    if (!design || busy !== null) return;
    pendingItemFiles.current = null;
    await importExistingItems(existingItemFiles);
  }

  async function importExistingItems(files: File[]) {
    setBusy("import");
    setError(null);
    setSuccess(null);
    try {
      const form = new FormData();
      files.forEach((file) => form.append("files", file, file.name));
      form.append("accessible_wording", accessibleWording ? "true" : "false");
      const imported = await apiRequest<{ review_url: string }>(
        `/api/teacher/assessments/${assessmentPublicId}/item-design/existing-items`,
        { method: "POST", body: form }
      );
      setExistingItemFiles([]);
      allowNavigation();
      router.push(imported.review_url);
    } catch (caught) {
      setError(errorFromUnknown(caught));
    } finally {
      setBusy(null);
    }
  }

  async function handlePrepareOtherTopics() {
    if (!design || topicRunActive) return;
    const topicMap = design.assistant_state.topic_map;
    const topics = (topicMap?.topics ?? []).filter((topic) => topic.topic_id !== topicMap?.selected_topic_id);
    if (topics.length === 0) return;
    stopTopicRun.current = false;
    setTopicRunStopping(false);
    setTopicRunActive(true);
    setError(null);
    setSuccess(null);
    setTopicRun(topics.map((topic) => ({ topic_id: topic.topic_id, title: topic.title, step: "waiting", link: null, note: null })));
    try {
      await prepareTopicMiniTests({
        bank_assessment_public_id: assessmentPublicId,
        topics: topics.map((topic) => ({ topic_id: topic.topic_id, title: topic.title, has_source_items: topic.source_items.length > 0 })),
        existing: design.topic_mini_tests ?? [],
        accessible_wording: accessibleWording,
        onUpdate: (state) => setTopicRun((current) =>
          current ? current.map((entry) => entry.topic_id === state.topic_id ? state : entry) : current),
        shouldStop: () => stopTopicRun.current
      });
    } finally {
      setTopicRunActive(false);
      void apiRequest<DesignResponse>(`/api/teacher/assessments/${assessmentPublicId}/item-design`)
        .then((response) => setDesign((current) => current ? { ...current, topic_mini_tests: response.topic_mini_tests } : current))
        .catch(() => undefined);
    }
  }

  async function sendAssistantMessage(message: string): Promise<DesignResponse | null> {
    if (!message || !design || !blueprint) return null;

    setBusy("assistant");
    setError(null);
    setSuccess(null);
    setPendingMessage({ text: message, files: assistantFiles.map((file) => file.name) });
    const clientMessageId = assistantClientMessageId ?? crypto.randomUUID();
    setAssistantClientMessageId(clientMessageId);

    try {
      const currentDesign = JSON.stringify(blueprint) === JSON.stringify(design.blueprint)
        ? design
        : await saveBlueprint(false);
      if (!currentDesign) return null;

      const requestPayload = {
        client_message_id: clientMessageId,
        expected_blueprint_hash: currentDesign.blueprint_hash,
        expected_concept_unit_version: currentDesign.concept_unit_version,
        message
      };
      const requestBody = assistantFiles.length > 0
        ? (() => {
            const form = new FormData();
            form.append("payload", JSON.stringify(requestPayload));
            assistantFiles.forEach((file) => form.append("files", file, file.name));
            return form;
          })()
        : JSON.stringify(requestPayload);
      const response = await apiRequest<DesignResponse>(
        `/api/teacher/assessments/${assessmentPublicId}/item-design/assistant`,
        {
          method: "POST",
          body: requestBody
        }
      );
      setDesign(response);
      setBlueprint(response.blueprint);
      setAssistantInput("");
      starterPrefixRef.current = "";
      setAssistantFiles([]);
      setAssistantClientMessageId(null);
      return response;
    } catch (caught) {
      setError(errorFromUnknown(caught));
      return null;
    } finally {
      setBusy(null);
      setPendingMessage(null);
    }
  }

  const readOnly = !design?.assessment.is_editable || busy !== null || topicRunActive;

  return (
    <div className="space-y-6">
      <PageHeader
        description={design ? design.assessment.title : undefined}
        title="Design mini test"
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

      {!design ? <ErrorPanel error={error} focusOnError /> : null}
      {busy === "load" ? <LoadingRow label="Loading assessment design" /> : null}

      {blueprint && design ? (
        <>
          <WorkspaceTabs
            id="item-design"
            label="Item-design workspace"
            tabs={[
              { id: "assistant", label: "Author with assistant", icon: <MessageSquareText className="h-4 w-4" aria-hidden="true" /> },
              { id: "review", label: "Review design", icon: <FileText className="h-4 w-4" aria-hidden="true" /> }
            ]}
            value={view}
            onChange={setView}
          />
          <div className="space-y-6" id="item-design-panel" role="tabpanel" aria-labelledby={`item-design-tab-${view}`} tabIndex={0}>

          {view === "assistant" ? (
            <ItemDesignAssistantWorkspace
              assistantFiles={assistantFiles}
              assistantInput={assistantInput}
              blueprint={blueprint}
              busy={busy}
              design={design}
              error={error}
              onAssistantInputChange={handleAssistantInputChange}
              onStarterSelect={handleStarterSelect}
              onFilesAdd={handleAssistantFilesAdd}
              onFileRemove={handleAssistantFileRemove}
              onOpenReview={() => setView("review")}
              onSend={handleAssistantSend}
              onCreateTopicMiniTest={(topicId) => void handleCreateTopicMiniTest(topicId)}
              creatingTopicId={creatingTopicId}
              onGenerate={() => void handleGenerate()}
              onImportExistingItems={() => void handleImportExistingItems()}
              existingItemFiles={existingItemFiles}
              onExistingItemFilesChange={setExistingItemFiles}
              accessibleWording={accessibleWording}
              onAccessibleWordingChange={setAccessibleWording}
              onPrepareOtherTopics={() => void handlePrepareOtherTopics()}
              onStopTopicRun={() => { stopTopicRun.current = true; setTopicRunStopping(true); }}
              topicRun={topicRun}
              topicRunActive={topicRunActive}
              topicRunStopping={topicRunStopping}
              path={path}
              onPathChoose={handlePathChoose}
              pendingMessage={pendingMessage}
              readOnly={readOnly}
              transcriptEndRef={transcriptEndRef}
            />
          ) : (
            <>
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
                <DesignEntry title={`Learning objective ${index + 1}`} summary={objective.statement} key={objective.objective_id}>
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
                </DesignEntry>
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
              <DesignEntry title={`Misconception example ${index + 1}`} summary={misconception.statement} key={misconception.misconception_id}>
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
              </DesignEntry>
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
              <DesignEntry title={`Exemplar ${index + 1}`} summary={exemplar.item_text} key={exemplar.exemplar_id}>
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
              </DesignEntry>
            ))}
            <Button
              disabled={readOnly || blueprint.exemplar_items.length >= 12}
              onClick={() => updateBlueprint((current) => ({ ...current, exemplar_items: [...current.exemplar_items, { exemplar_id: localId("exemplar"), item_text: "", observed_difficulty_note: null }] }))}
              type="button"
              variant="secondary"
            ><Plus className="h-4 w-4" aria-hidden="true" /> Add exemplar item</Button>

            <div className="grid gap-4 border-t border-line pt-5 md:grid-cols-2">
              <Field label="Number of draft items" hint="3-5 items per mini-test are recommended; 3-12 are allowed.">
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
                  <option value={3}>3</option><option value={4}>4</option>
                  {/* Option E is reserved for the student's "I don't know yet" choice, so items have at most four options. */}
                  {blueprint.generation_settings.option_count === 5 ? <option value={5}>5 (cannot be published)</option> : null}
                </select>
              </Field>
              <Field label="Cognitive demand mix">
                <div className="grid gap-3 sm:grid-cols-2">
                  {COGNITIVE_DEMAND_OPTIONS.map((option) => {
                    const checked = blueprint.generation_settings.difficulty_mix.includes(
                      option.value
                    );
                    return (
                    <label className="flex items-start gap-2 text-sm text-ink" key={option.value}>
                      <input
                        checked={checked}
                        className="mt-0.5"
                        disabled={
                          readOnly ||
                          (checked && blueprint.generation_settings.difficulty_mix.length === 1)
                        }
                        onChange={(event) => updateBlueprint((current) => ({
                          ...current,
                          generation_settings: {
                            ...current.generation_settings,
                            difficulty_mix: event.target.checked
                              ? [...current.generation_settings.difficulty_mix, option.value]
                              : current.generation_settings.difficulty_mix.filter(
                                  (entry) => entry !== option.value
                                )
                          }
                        }))}
                        type="checkbox"
                      />
                      <span>{option.label}</span>
                    </label>
                    );
                  })}
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

          <section className="sticky bottom-0 z-10 space-y-3 border-t border-line bg-white p-4 shadow-soft" aria-label="Design actions">
            <ErrorPanel error={error} focusOnError />
            <SuccessPanel message={success} />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted" role="status">{busy === "save" ? "Saving the design." : busy === "generate" ? "Writing and checking drafts. This takes a few minutes; keep this page open." : isDirty ? "Unsaved changes" : "All design changes saved"}</p>
            <div className="flex flex-wrap gap-2">
              <Button disabled={readOnly || busy !== null} onClick={handleSave} type="button" variant="secondary">
                <Save className="h-4 w-4" aria-hidden="true" /> {busy === "save" ? "Saving" : "Save design"}
              </Button>
              <Button disabled={readOnly || busy !== null} onClick={handleGenerate} type="button">
                <Sparkles className="h-4 w-4" aria-hidden="true" /> {busy === "generate" ? "Generating drafts" : "Save and generate drafts"}
              </Button>
            </div>
            </div>
          </section>
            </>
          )}
          </div>
        </>
      ) : null}
    </div>
  );
}
