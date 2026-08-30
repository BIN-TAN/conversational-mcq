"use client";

import { type FormEvent, type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  BookOpenCheck,
  CheckCircle2,
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
  source_kind: "docx" | "pdf" | "image";
  byte_size: number;
  sha256: string;
  content_summary: string;
  limitations: string[];
  warnings: string[];
  created_at: string;
};

type AssistantState = {
  ready_for_item_generation: boolean;
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
  source_materials: SourceMaterial[];
};

const MAX_ASSISTANT_FILES = 5;
const MAX_ASSISTANT_FILE_BYTES = 15_000_000;
const MAX_ASSISTANT_TOTAL_BYTES = 30_000_000;
const ACCEPTED_ASSISTANT_FILES = ".pdf,.docx,.png,.jpg,.jpeg,.webp";

function fileSizeLabel(bytes: number) {
  if (bytes < 1_000_000) return `${Math.max(1, Math.round(bytes / 1000))} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

function localId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function lines(value: string) {
  return value.split("\n").map((entry) => entry.trim()).filter(Boolean);
}

function ItemDesignAssistantWorkspace({
  assistantFiles,
  assistantInput,
  blueprint,
  busy,
  design,
  onAssistantInputChange,
  onFilesAdd,
  onFileRemove,
  onOpenReview,
  onSend,
  readOnly,
  transcriptEndRef
}: {
  assistantFiles: File[];
  assistantInput: string;
  blueprint: Blueprint;
  busy: "load" | "save" | "assistant" | "generate" | null;
  design: DesignResponse;
  onAssistantInputChange: (value: string) => void;
  onFilesAdd: (files: File[]) => void;
  onFileRemove: (index: number) => void;
  onOpenReview: () => void;
  onSend: (event: FormEvent<HTMLFormElement>) => void;
  readOnly: boolean;
  transcriptEndRef: RefObject<HTMLDivElement | null>;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const evidenceCount = blueprint.objectives.reduce(
    (total, objective) => total + objective.evidence_requirements.filter(Boolean).length,
    0
  );
  const messages = design.assistant_thread.messages;
  const suggestions = [
    "I will add course material",
    "Help me refine the learning objectives",
    "I have exemplar items students found difficult"
  ];

  return (
    <section className="overflow-hidden rounded-md border border-line bg-white shadow-soft">
      <div className="grid min-h-[640px] lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-h-[600px] min-w-0 flex-col lg:border-r lg:border-line">
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
          </header>

          <div
            aria-live="polite"
            className="flex-1 space-y-4 overflow-y-auto bg-[#F8FAF9] px-4 py-5 sm:px-6"
            data-testid="item-design-assistant-transcript"
          >
            {messages.length === 0 ? (
              <div className="mx-auto max-w-xl py-8 text-center">
                <BookOpenCheck className="mx-auto h-8 w-8 text-accent" aria-hidden="true" />
                <h3 className="mt-4 text-lg font-semibold text-ink">Start with the course material</h3>
                <p className="mt-2 text-sm leading-6 text-muted">
                  Upload a PDF, Word file, or screenshot; paste an excerpt; or describe the section. The
                  assistant will help turn it into objectives, observable evidence, and
                  misconception hypotheses.
                </p>
                <div className="mt-5 flex flex-wrap justify-center gap-2">
                  {suggestions.map((suggestion) => (
                    <button
                      className="rounded-md border border-line bg-white px-3 py-2 text-left text-sm font-medium text-ink transition hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={readOnly || busy !== null}
                      key={suggestion}
                      onClick={() => onAssistantInputChange(suggestion)}
                      type="button"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
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

            {busy === "assistant" ? (
              <div className="flex justify-start">
                <div className="rounded-md border border-line bg-white px-4 py-3 text-sm text-muted">
                  Reviewing your material and updating the design...
                </div>
              </div>
            ) : null}
            <div ref={transcriptEndRef} />
          </div>

          <form className="border-t border-line bg-white p-4" onSubmit={onSend}>
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
              value={assistantInput}
            />
            <input
              accept={ACCEPTED_ASSISTANT_FILES}
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
                  Add PDF, Word, or images
                </button>
                <p className="text-xs leading-5 text-muted">Up to 5 files, 15 MB each.</p>
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
                <dt className="text-muted">Exemplars</dt>
                <dd className="mt-1 text-lg font-semibold text-ink">{blueprint.exemplar_items.length}</dd>
              </div>
            </dl>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Draft target</p>
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

export function ItemDesignClient({ assessmentPublicId }: { assessmentPublicId: string }) {
  const router = useRouter();
  const [design, setDesign] = useState<DesignResponse | null>(null);
  const [blueprint, setBlueprint] = useState<Blueprint | null>(null);
  const [error, setError] = useState<StructuredApiError | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState<"load" | "save" | "assistant" | "generate" | null>("load");
  const [view, setView] = useState<"assistant" | "review">("assistant");
  const [assistantInput, setAssistantInput] = useState("");
  const [assistantFiles, setAssistantFiles] = useState<File[]>([]);
  const [assistantClientMessageId, setAssistantClientMessageId] = useState<string | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);

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
    if (view !== "assistant") return;
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [busy, design?.assistant_thread.messages.length, view]);

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

  function handleAssistantInputChange(value: string) {
    setAssistantInput(value);
    if (busy !== "assistant") setAssistantClientMessageId(null);
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
    if (!message || !design || !blueprint) return;

    setBusy("assistant");
    setError(null);
    setSuccess(null);
    const clientMessageId = assistantClientMessageId ?? crypto.randomUUID();
    setAssistantClientMessageId(clientMessageId);

    try {
      const currentDesign = JSON.stringify(blueprint) === JSON.stringify(design.blueprint)
        ? design
        : await saveBlueprint(false);
      if (!currentDesign) return;

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
      setAssistantFiles([]);
      setAssistantClientMessageId(null);
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

      <ErrorPanel error={error} />
      <SuccessPanel message={success} />
      {busy === "load" ? <LoadingRow label="Loading assessment design" /> : null}

      {blueprint && design ? (
        <>
          <div
            aria-label="Item-design workspace"
            className="inline-flex w-full rounded-md border border-line bg-[#F5F7F6] p-1 sm:w-auto"
            role="tablist"
          >
            <button
              aria-selected={view === "assistant"}
              className={`inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold transition sm:flex-none ${
                view === "assistant" ? "bg-white text-accent shadow-sm" : "text-muted hover:text-ink"
              }`}
              onClick={() => setView("assistant")}
              role="tab"
              type="button"
            >
              <MessageSquareText className="h-4 w-4" aria-hidden="true" />
              Author with assistant
            </button>
            <button
              aria-selected={view === "review"}
              className={`inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold transition sm:flex-none ${
                view === "review" ? "bg-white text-accent shadow-sm" : "text-muted hover:text-ink"
              }`}
              onClick={() => setView("review")}
              role="tab"
              type="button"
            >
              <FileText className="h-4 w-4" aria-hidden="true" />
              Review design
            </button>
          </div>

          {view === "assistant" ? (
            <ItemDesignAssistantWorkspace
              assistantFiles={assistantFiles}
              assistantInput={assistantInput}
              blueprint={blueprint}
              busy={busy}
              design={design}
              onAssistantInputChange={handleAssistantInputChange}
              onFilesAdd={handleAssistantFilesAdd}
              onFileRemove={handleAssistantFileRemove}
              onOpenReview={() => setView("review")}
              onSend={handleAssistantSend}
              readOnly={readOnly}
              transcriptEndRef={transcriptEndRef}
            />
          ) : (
            <>
          <section className="border-y border-line bg-emerald-50 px-5 py-4 text-sm leading-6 text-emerald-950">
            <div className="flex gap-3">
              <BookOpenCheck className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
              <p>
                Review the section, objectives, evidence, misconception hypotheses, exemplars,
                and draft settings. Generated items remain proposals until you edit them and
                confirm every answer key.
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
          )}
        </>
      ) : null}
    </div>
  );
}
