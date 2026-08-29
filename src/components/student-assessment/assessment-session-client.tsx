"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  Loader2,
  LogOut,
  MessageSquareText,
  RefreshCw,
  Send
} from "lucide-react";
import type {
  ConfidenceRating,
  StructuredStudentApiError,
  StudentReviewItem,
  StudentReviewResponse,
  StudentActivityRuntimeProjection,
  StudentFormativeConversation,
  StudentSafeMediaAsset,
  StudentSafeItem,
  StudentSessionState,
  StudentTranscriptEntry
} from "@/lib/student-assessment-ui/types";
import {
  beginConceptUnit,
  chooseStudentActivityRuntimeAction,
  chooseProgression,
  completeInitialConceptUnit,
  endAssessmentAttempt,
  exitSession,
  fetchSessionState,
  fetchStudentReview,
  fetchStudentTranscript,
  newClientActionId,
  requestProgression,
  retryFormativeConversationOpening,
  retryFormativeConversationResponse,
  saveConfidence,
  saveOption,
  saveReasoning,
  saveTemptingOption,
  selectNextChoice,
  sendFollowupMessage,
  sendFormativeConversationEvent,
  sendFormativeConversationMessage,
  sendProcessEvents,
  sendRevisionResponse,
  startStudentActivityRuntime,
  startAssessmentSession,
  submitStudentActivityRuntimeResponse,
  submitTopicDialogueResponse,
  stopFollowup,
  updateInFlowItem,
  updateFormativeConversationLifecycle,
  updatePackageReviewItem
} from "./api";
import { useStudentProcessEvents } from "./process-events";
import {
  buildInitialAdminPrompt,
  studentIndicatedReasoningUncertainty,
  temptingOptionsForSelectedAnswer
} from "@/lib/student-assessment/initial-admin-prompts";
import { SafeTutorMessageMarkdown } from "@/components/safe-tutor-message-markdown";

const MAX_REASONING_LENGTH = 5000;
const IDK_OPTION_LABEL = "E";
const IDK_OPTION_TEXT = "I don't know yet.";
const STUDENT_FACING_TUTOR_LABEL = "Assessment Tutor";
const PACKAGE_FEEDBACK_PRESENTER_VERSION = "package-feedback-presenter-v1";
const DISPLAY_EVENT_CONTRACT_VERSION = "display-ack-v1";
const FORMATIVE_RESPONSE_SAVED_NOTICE_MS = 10_000;
const FORMATIVE_RESPONSE_DELAY_NOTICE_MS = 25_000;

type FailedAction = {
  label: string;
  retry: () => void;
};

type PackageReviewEditDraft = {
  itemPublicId: string;
  selectedOption: string;
  reasoningText: string;
  confidenceRating: ConfidenceRating | "";
  noTemptingOption: boolean;
  temptingOption: string;
  temptingOptionReason: string;
};

type InFlowEditField = "answer" | "reasoning" | "confidence" | "tempting";
type InFlowEditDraft = {
  field: InFlowEditField;
  selectedOption: string;
  reasoningText: string;
  confidenceRating: ConfidenceRating | "";
  noTemptingOption: boolean;
  temptingOption: string;
  temptingOptionReason: string;
};

function confidenceLabel(confidence: ConfidenceRating) {
  if (confidence === "low") {
    return "Low";
  }

  if (confidence === "medium") {
    return "Medium";
  }

  return "High";
}

function answerOptionsFor(item: StudentSafeItem) {
  return [
    ...item.options,
    {
      label: IDK_OPTION_LABEL,
      text: IDK_OPTION_TEXT
    }
  ];
}

function temptingOptionsFor(item: Pick<StudentSafeItem, "options">, selectedOption: string | null | undefined) {
  return temptingOptionsForSelectedAnswer(item, selectedOption);
}

function displayAnswer(option: string | null | undefined) {
  return option === IDK_OPTION_LABEL ? "I don't know yet" : option ?? "Not answered";
}

function buildInFlowEditDraft(item: StudentSafeItem, field: InFlowEditField): InFlowEditDraft {
  return {
    field,
    selectedOption: item.existing_selected_option ?? "",
    reasoningText: item.existing_reasoning_text ?? "",
    confidenceRating: item.existing_confidence_rating ?? "",
    noTemptingOption: item.no_tempting_option || !item.tempting_option,
    temptingOption: item.tempting_option ?? "",
    temptingOptionReason: item.tempting_option_reason ?? ""
  };
}

function buildReviewEditDraft(item: StudentReviewItem): PackageReviewEditDraft {
  return {
    itemPublicId: item.item_public_id,
    selectedOption: item.existing_selected_option ?? "",
    reasoningText: item.existing_reasoning_text ?? "",
    confidenceRating: item.existing_confidence_rating ?? "",
    noTemptingOption: item.no_tempting_option || !item.tempting_option,
    temptingOption: item.tempting_option ?? "",
    temptingOptionReason: item.tempting_option_reason ?? ""
  };
}

function reviewEditDraftIsComplete(draft: PackageReviewEditDraft | null) {
  if (!draft) {
    return false;
  }

  if (!draft.selectedOption || !draft.reasoningText.trim() || !draft.confidenceRating) {
    return false;
  }

  if (draft.noTemptingOption) {
    return true;
  }

  return Boolean(draft.temptingOption && draft.temptingOptionReason.trim());
}

function ErrorNotice({ error }: { error: StructuredStudentApiError | null }) {
  if (!error) {
    return null;
  }

  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900" role="alert">
      <div className="flex gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <div>
          <p className="font-semibold" data-testid="student-safe-error-message">
            {error.message}
          </p>
        </div>
      </div>
    </div>
  );
}

function displayTranscriptText(entry: StudentTranscriptEntry) {
  if (entry.actor !== "student") {
    return entry.message_text;
  }

  if (entry.interaction_type === "option_selected" || entry.interaction_type === "transfer_option_selected") {
    const selected = entry.message_text.match(/^Selected option\s+(.+)\.$/i)?.[1]?.trim();
    return selected === IDK_OPTION_LABEL ? "I don't know yet." : selected || entry.message_text;
  }

  if (
    entry.interaction_type === "confidence_selected" ||
    entry.interaction_type === "transfer_confidence_selected"
  ) {
    const selected = entry.message_text.match(/^Selected\s+(.+)\s+confidence\.$/i)?.[1]?.trim();
    return selected ? selected.charAt(0).toUpperCase() + selected.slice(1).toLowerCase() : entry.message_text;
  }

  return entry.message_text;
}

function formatTranscriptTimestamp(value: string) {
  return new Date(value).toLocaleString();
}

function ChatBubble({ entry }: { entry: StudentTranscriptEntry }) {
  const isAssistant = entry.actor === "assistant";

  return (
    <div className={isAssistant ? "flex justify-start" : "flex justify-end"}>
      <div
        className={
          isAssistant
            ? "max-w-[86%] rounded-2xl rounded-bl-md border border-line bg-white px-4 py-3 shadow-sm sm:max-w-[78%]"
            : "max-w-[72%] rounded-2xl rounded-br-md bg-[#23312d] px-3 py-2 text-white shadow-sm sm:max-w-[62%]"
        }
        data-testid={isAssistant ? "agent-chat-message" : "student-chat-message"}
        title={formatTranscriptTimestamp(entry.created_at)}
      >
        <p className={isAssistant ? "mb-1 text-[0.68rem] font-semibold uppercase tracking-wide text-accent" : "mb-1 text-right text-[0.68rem] font-semibold uppercase tracking-wide text-white/65"}>
          {isAssistant ? STUDENT_FACING_TUTOR_LABEL : "You"}
        </p>
        <p className="whitespace-pre-wrap text-sm leading-6">{displayTranscriptText(entry)}</p>
        <time className="sr-only" dateTime={entry.created_at}>
          {formatTranscriptTimestamp(entry.created_at)}
        </time>
      </div>
    </div>
  );
}

function FormativeConversationBubble({
  turn
}: {
  turn: StudentFormativeConversation["transcript"][number];
}) {
  const isTutor = turn.actor === "tutor";
  return (
    <div className={isTutor ? "flex justify-start" : "flex justify-end"}>
      <div
        className={
          isTutor
            ? "max-w-[86%] rounded-2xl rounded-bl-md border border-line bg-white px-4 py-3 shadow-sm sm:max-w-[78%]"
            : "max-w-[72%] rounded-2xl rounded-br-md bg-[#23312d] px-3 py-2 text-white shadow-sm sm:max-w-[62%]"
        }
        data-testid={
          isTutor
            ? "formative-conversation-tutor-message"
            : "formative-conversation-student-message"
        }
      >
        <p
          className={
            isTutor
              ? "mb-1 text-[0.68rem] font-semibold uppercase tracking-wide text-accent"
              : "mb-1 text-right text-[0.68rem] font-semibold uppercase tracking-wide text-white/65"
          }
        >
          {isTutor ? STUDENT_FACING_TUTOR_LABEL : "You"}
        </p>
        {isTutor ? (
          <SafeTutorMessageMarkdown message={turn.message_text} />
        ) : (
          <>
            <p className="whitespace-pre-wrap text-sm leading-6">
              {turn.message_text}
            </p>
            {turn.assistant_response_status &&
            turn.assistant_response_status !== "completed" ? (
              <p
                className="mt-2 text-xs text-white/75"
                data-testid={`formative-response-${turn.assistant_response_status}`}
              >
                {turn.assistant_response_status === "failed"
                  ? "Your message is saved, but the tutor has not responded."
                  : "Your message is saved."}
              </p>
            ) : null}
          </>
        )}
        <time className="sr-only" dateTime={turn.created_at}>
          {formatTranscriptTimestamp(turn.created_at)}
        </time>
      </div>
    </div>
  );
}

export function FormativeOpeningStatus({
  isBusy = false,
  onRetry,
  status
}: {
  isBusy?: boolean;
  onRetry?: () => void;
  status: "preparing" | "retry_available" | "unavailable";
}) {
  if (status === "preparing") {
    return (
      <p
        aria-live="polite"
        className="mt-4 flex items-center gap-2 rounded-md bg-slate-50 px-3 py-2 text-sm text-muted"
        data-testid="formative-conversation-opening-preparing"
        role="status"
      >
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        Reviewing your responses and preparing personalized learning support...
      </p>
    );
  }

  if (status === "retry_available") {
    return (
      <div
        className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md bg-slate-50 px-3 py-2"
        data-testid="formative-conversation-opening-retry"
      >
        <p className="text-sm text-muted">
          Your responses are saved. Personalized learning support is not ready
          yet.
        </p>
        <button
          className="inline-flex items-center gap-2 rounded-md border border-line bg-white px-3 py-2 text-xs font-semibold text-ink hover:border-accent disabled:opacity-60"
          disabled={isBusy}
          onClick={onRetry}
          type="button"
        >
          {isBusy ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
          )}
          {isBusy ? "Trying again..." : "Try again"}
        </button>
      </div>
    );
  }

  return (
    <p
      className="mt-4 rounded-md bg-slate-50 px-3 py-2 text-sm text-muted"
      data-testid="formative-conversation-opening-unavailable"
    >
      Personalized learning support is temporarily unavailable. Your responses
      are saved. You can pause and return later.
    </p>
  );
}

function FormativeResponseWaitingStatus({
  onReviewAnswers
}: {
  onReviewAnswers?: () => void;
}) {
  const [stage, setStage] = useState<"preparing" | "saved" | "delayed">(
    "preparing"
  );

  useEffect(() => {
    const savedTimer = window.setTimeout(
      () => setStage("saved"),
      FORMATIVE_RESPONSE_SAVED_NOTICE_MS
    );
    const delayedTimer = window.setTimeout(
      () => setStage("delayed"),
      FORMATIVE_RESPONSE_DELAY_NOTICE_MS
    );

    return () => {
      window.clearTimeout(savedTimer);
      window.clearTimeout(delayedTimer);
    };
  }, []);

  const message =
    stage === "preparing"
      ? "Preparing a response..."
      : stage === "saved"
        ? "Still preparing a response. Your message is saved."
        : "This is taking a little longer than usual. You can review your answers or earlier messages while you wait.";

  return (
    <div className="flex justify-start" data-testid="formative-conversation-response-pending">
      <div
        aria-live="polite"
        className="max-w-[86%] rounded-2xl rounded-bl-md border border-line bg-white px-4 py-3 shadow-sm sm:max-w-[78%]"
        role="status"
      >
        <p className="mb-1 text-[0.68rem] font-semibold uppercase tracking-wide text-accent">
          {STUDENT_FACING_TUTOR_LABEL}
        </p>
        <div className="flex items-start gap-2 text-sm leading-6 text-muted">
          <Loader2 className="mt-1 h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
          <p>{message}</p>
        </div>
        {stage === "delayed" && onReviewAnswers ? (
          <button
            className="mt-3 inline-flex items-center rounded-md border border-line bg-white px-3 py-2 text-xs font-semibold text-ink hover:border-accent"
            onClick={onReviewAnswers}
            type="button"
          >
            Review your answers
          </button>
        ) : null}
      </div>
    </div>
  );
}

function FormativeConversationControls(input: {
  conversation: StudentFormativeConversation;
  draft: string;
  isAwaitingTutorResponse: boolean;
  isBusy: boolean;
  isRetryingOpening: boolean;
  onBackspace: () => void;
  onChange: (value: string) => void;
  onEnd: () => void;
  onPaste: (pastedCharacterCount: number) => void;
  onPause: () => void;
  onRetryOpening: () => void;
  onRetryResponse: () => void;
  onReviewAnswers?: () => void;
  onResume: () => void;
  onSend: () => void;
}) {
  const { conversation } = input;
  const response = conversation.assistant_response;
  const responseIsPending =
    input.isAwaitingTutorResponse ||
    response?.status === "pending" ||
    response?.status === "retrying";

  if (responseIsPending) {
    return (
      <FormativeResponseWaitingStatus
        onReviewAnswers={input.onReviewAnswers}
      />
    );
  }

  return (
    <section
      aria-label="Learning conversation controls"
      className="rounded-lg border border-line bg-white p-4 shadow-sm"
      data-testid="formative-conversation-controls"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">Learning conversation</h2>
          <p className="mt-1 text-xs text-muted">
            Ask a question or explain what you are thinking.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {conversation.can_pause ? (
            <button
              className="rounded-md border border-line bg-white px-3 py-2 text-xs font-semibold text-ink hover:border-accent disabled:opacity-60"
              disabled={input.isBusy}
              onClick={input.onPause}
              type="button"
            >
              Pause conversation
            </button>
          ) : null}
          {conversation.can_resume ? (
            <button
              className="rounded-md border border-line bg-white px-3 py-2 text-xs font-semibold text-ink hover:border-accent disabled:opacity-60"
              disabled={input.isBusy}
              onClick={input.onResume}
              type="button"
            >
              Resume conversation
            </button>
          ) : null}
          {conversation.can_end ? (
            <button
              className="rounded-md border border-line bg-white px-3 py-2 text-xs font-semibold text-ink hover:border-red-300 disabled:opacity-60"
              disabled={input.isBusy}
              onClick={input.onEnd}
              type="button"
            >
              End conversation
            </button>
          ) : null}
        </div>
      </div>
      {response?.status === "failed" ? (
          <div
            className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2"
            data-testid="formative-conversation-response-retry"
          >
            <p className="text-sm text-amber-950">
              Your message is saved. The tutor could not respond just now.
            </p>
            {response.can_retry ? (
              <button
                className="inline-flex items-center gap-2 rounded-md border border-amber-300 bg-white px-3 py-2 text-xs font-semibold text-ink hover:border-accent disabled:opacity-60"
                disabled={input.isBusy}
                onClick={input.onRetryResponse}
                type="button"
              >
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                Try tutor response again
              </button>
            ) : null}
          </div>
      ) : conversation.can_send ? (
        <div className="mt-4 flex items-end gap-2">
          <label className="flex-1">
            <span className="sr-only">Message the assessment tutor</span>
            <textarea
              className="min-h-24 w-full resize-y rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/15"
              data-testid="formative-conversation-input"
              disabled={input.isBusy}
              maxLength={conversation.message_max_chars}
              onChange={(event) => input.onChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Backspace" || event.key === "Delete") {
                  input.onBackspace();
                }
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  input.onSend();
                }
              }}
              onPaste={(event) =>
                input.onPaste(
                  event.clipboardData.getData("text").length
                )
              }
              placeholder="Type your message..."
              value={input.draft}
            />
          </label>
          <button
            aria-label="Send message"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-accent text-white hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60"
            data-testid="send-formative-conversation-message"
            disabled={input.isBusy || !input.draft.trim()}
            onClick={input.onSend}
            type="button"
          >
            {input.isBusy ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
        </div>
      ) : conversation.opening_status === "preparing" ? (
        <FormativeOpeningStatus status="preparing" />
      ) : conversation.can_retry_opening ? (
        <FormativeOpeningStatus
          isBusy={input.isRetryingOpening}
          onRetry={input.onRetryOpening}
          status="retry_available"
        />
      ) : conversation.opening_status === "unavailable" ? (
        <FormativeOpeningStatus status="unavailable" />
      ) : (
        <p className="mt-4 rounded-md bg-slate-50 px-3 py-2 text-sm text-muted">
          {conversation.status === "paused"
            ? "This conversation is paused. Resume it when you are ready to continue."
            : "This conversation has ended. Use End attempt when you are ready to finish the assessment."}
        </p>
      )}
    </section>
  );
}

function shouldHideActiveAgentTranscriptEntry(entry: StudentTranscriptEntry, state: StudentSessionState) {
  if (entry.actor !== "assistant") {
    return false;
  }

  const currentItemPublicId = state.current_item?.item_public_id ?? null;
  const sameCurrentItem = Boolean(currentItemPublicId && entry.item_public_id === currentItemPublicId);

  if (
    (state.assessment_state === "ITEM_PRESENTED" || state.assessment_state === "AWAIT_ANSWER") &&
    sameCurrentItem
  ) {
    return entry.interaction_type === "present_item";
  }

  if (state.assessment_state === "TRANSFER_ITEM" && sameCurrentItem) {
    return entry.interaction_type === "transfer_item";
  }

  if (state.assessment_state === "AWAIT_REASON" && sameCurrentItem) {
    return entry.interaction_type === "request_reasoning" ||
      entry.interaction_type === "transfer_request_reasoning";
  }

  if (state.assessment_state === "AWAIT_CONFIDENCE" && sameCurrentItem) {
    return entry.interaction_type === "request_confidence" ||
      entry.interaction_type === "transfer_request_confidence";
  }

  if (state.assessment_state === "AWAIT_TEMPTING_OPTION" && sameCurrentItem) {
    return entry.interaction_type === "request_tempting_option" ||
      entry.interaction_type === "transfer_request_tempting_option";
  }

  if (state.assessment_state === "AWAIT_TEMPTING_REASON" && sameCurrentItem) {
    return entry.interaction_type === "request_tempting_reason" ||
      entry.interaction_type === "transfer_request_tempting_reason";
  }

  if (state.assessment_state === "PACKAGE_REVIEW") {
    return entry.interaction_type === "package_review";
  }

  return false;
}

function AgentMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex justify-start">
      <div
        className="max-w-[92%] rounded-2xl rounded-bl-md border border-line bg-white px-4 py-3 shadow-sm sm:max-w-[82%]"
        data-testid="agent-chat-message"
      >
        <div className="flex gap-2.5">
          <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
            <MessageSquareText className="h-4 w-4" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1 text-sm leading-6 text-ink">
            <p className="mb-1 text-[0.68rem] font-semibold uppercase tracking-wide text-accent">
              {STUDENT_FACING_TUTOR_LABEL}
            </p>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

function OptionChip({
  label,
  text,
  disabled,
  onSelect,
  testId
}: {
  label: string;
  text?: string;
  disabled: boolean;
  onSelect: () => void;
  testId: string;
}) {
  return (
    <button
      className="inline-flex min-h-10 items-center gap-2 rounded-full border border-line bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:border-accent hover:bg-accent-soft focus:outline-none focus:ring-2 focus:ring-accent-soft disabled:cursor-not-allowed disabled:opacity-60"
      data-testid={testId}
      disabled={disabled}
      onClick={onSelect}
      type="button"
    >
      <span className="flex h-6 w-6 items-center justify-center rounded-full border border-current text-xs">
        {label}
      </span>
      {text ? <span className="font-normal">{text}</span> : null}
    </button>
  );
}

function StudentMediaList({
  mediaAssets,
  compact = false,
  linksInteractive = true
}: {
  mediaAssets: StudentSafeMediaAsset[];
  compact?: boolean;
  linksInteractive?: boolean;
}) {
  if (mediaAssets.length === 0) {
    return null;
  }

  return (
    <div className={compact ? "mt-2 grid gap-2" : "mt-4 grid gap-3"} data-testid="student-item-media-list">
      {mediaAssets.map((asset) => (
        <figure
          className={
            compact
              ? "rounded-lg border border-line bg-white/80 p-2"
              : "rounded-xl border border-line bg-[#fbfcfa] p-3"
          }
          data-testid={`student-item-media-${asset.media_public_id}`}
          key={asset.media_public_id}
        >
          {asset.media_type === "image" && asset.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              alt={asset.alt_text_or_description}
              className="max-h-72 w-full rounded-lg object-contain"
              src={asset.url}
            />
          ) : asset.url && linksInteractive ? (
            <a
              className="text-sm font-semibold text-accent underline-offset-4 hover:underline"
              href={asset.url}
              rel="noreferrer"
              target="_blank"
            >
              {asset.title ?? (asset.media_type === "video" ? "Open media link" : "Open reference link")}
            </a>
          ) : asset.url ? (
            <span className="text-sm font-semibold text-accent">
              {asset.title ?? (asset.media_type === "video" ? "Media link" : "Reference link")}
            </span>
          ) : null}
          {asset.title && asset.media_type === "image" ? (
            <figcaption className="mt-2 text-sm font-semibold text-ink">{asset.title}</figcaption>
          ) : null}
          <p className="mt-1 text-sm leading-6 text-muted">{asset.alt_text_or_description}</p>
          {asset.caption ? <p className="mt-1 text-xs text-muted">{asset.caption}</p> : null}
          {asset.transcript_or_content_summary ? (
            <p className="mt-2 text-xs leading-5 text-muted">{asset.transcript_or_content_summary}</p>
          ) : null}
          {asset.source_attribution ? (
            <p className="mt-1 text-[0.68rem] uppercase tracking-wide text-muted">
              {asset.source_attribution}
            </p>
          ) : null}
        </figure>
      ))}
    </div>
  );
}

function AgentItemMessage({
  item,
  disabled,
  isTransferItem = false,
  onSelect
}: {
  item: StudentSafeItem;
  disabled: boolean;
  isTransferItem?: boolean;
  onSelect: (label: string) => void;
}) {
  const initialItemLabel =
    item.initial_item_position && item.initial_item_total
      ? `Item ${item.initial_item_position} of ${item.initial_item_total} - ${Math.max(
          item.initial_item_total - item.initial_item_position,
          0
        )} remaining after this`
      : `Item ${item.item_order}`;
  const answerPrompt = buildInitialAdminPrompt({
    kind: "answer_prompt",
    assessmentState: isTransferItem ? "TRANSFER_ITEM" : "AWAIT_ANSWER",
    itemPublicId: item.item_public_id,
    itemOrder: item.item_order,
    itemPosition: item.initial_item_position,
    initialItemTotal: item.initial_item_total,
    itemRole: isTransferItem ? "transfer" : "initial"
  });

  return (
    <AgentMessage>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">
        {isTransferItem ? "Additional question" : initialItemLabel}
      </p>
      <p className="mt-2 whitespace-pre-wrap text-[0.95rem] leading-7 text-ink">{item.item_stem}</p>
      <StudentMediaList mediaAssets={item.media_assets.filter((asset) => asset.placement === "item_stem")} />
      <div className="mt-4 grid gap-1.5">
        {answerOptionsFor(item).map((option) => {
          const selected = item.existing_selected_option === option.label;
          const optionMedia = item.media_assets.filter(
            (asset) => asset.placement === "option" && asset.option_label === option.label
          );

          return (
            <button
              aria-pressed={selected}
              className={
                selected
                  ? "rounded-xl border border-accent bg-accent-soft px-3 py-2.5 text-left ring-2 ring-accent-soft transition focus:outline-none focus:ring-2 focus:ring-accent disabled:cursor-not-allowed disabled:opacity-70"
                  : "rounded-xl border border-line bg-[#fbfcfa] px-3 py-2.5 text-left transition hover:border-accent hover:bg-accent-soft focus:outline-none focus:ring-2 focus:ring-accent disabled:cursor-not-allowed disabled:opacity-70"
              }
              data-testid={`chat-option-card-${item.item_public_id}-${option.label}`}
              disabled={disabled}
              key={option.label}
              onClick={() => onSelect(option.label)}
              type="button"
            >
              <span className="block text-sm leading-6">
                <span className="font-semibold">{option.label}.</span> {option.text}
              </span>
              <StudentMediaList compact linksInteractive={false} mediaAssets={optionMedia} />
            </button>
          );
        })}
      </div>
      <p className="mt-3 font-medium text-ink">{answerPrompt.prompt_text}</p>
    </AgentMessage>
  );
}

function ConfidenceMessage({
  disabled,
  item,
  isTransferItem = false,
  onSelect
}: {
  disabled: boolean;
  item: StudentSafeItem | null;
  isTransferItem?: boolean;
  onSelect: (confidence: ConfidenceRating) => void;
}) {
  const levels: ConfidenceRating[] = ["low", "medium", "high"];
  const confidencePrompt = buildInitialAdminPrompt({
    kind: "confidence_prompt",
    assessmentState: "AWAIT_CONFIDENCE",
    itemPublicId: item?.item_public_id ?? null,
    itemOrder: item?.item_order ?? null,
    itemRole: isTransferItem ? "transfer" : "initial",
    selectedOption: item?.existing_selected_option ?? null,
    latestStudentResponse: item?.existing_reasoning_text ?? null,
    indicatedUnknown: studentIndicatedReasoningUncertainty(item?.existing_reasoning_text)
  });

  return (
    <AgentMessage>
      <p className="font-medium text-ink">{confidencePrompt.prompt_text}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {levels.map((level) => (
          <button
            className="rounded-full border border-line bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:border-accent hover:bg-accent-soft focus:outline-none focus:ring-2 focus:ring-accent-soft disabled:cursor-not-allowed disabled:opacity-60"
            data-testid={`chat-confidence-${level}`}
            disabled={disabled}
            key={level}
            onClick={() => onSelect(level)}
            type="button"
          >
            {confidenceLabel(level)}
          </button>
        ))}
      </div>
    </AgentMessage>
  );
}

function TemptingOptionMessage({
  item,
  disabled,
  isTransferItem = false,
  onNo,
  onSelect
}: {
  item: StudentSafeItem;
  disabled: boolean;
  isTransferItem?: boolean;
  onNo: () => void;
  onSelect: (label: string) => void;
}) {
  const temptingPrompt = buildInitialAdminPrompt({
    kind: "tempting_option_prompt",
    assessmentState: "AWAIT_TEMPTING_OPTION",
    itemPublicId: item.item_public_id,
    itemOrder: item.item_order,
    selectedOption: item.existing_selected_option,
    itemRole: isTransferItem ? "transfer" : "initial"
  });

  return (
    <AgentMessage>
      <p className="font-medium text-ink">{temptingPrompt.prompt_text}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {temptingOptionsFor(item, item.existing_selected_option).map((option) => (
          <OptionChip
            disabled={disabled}
            key={option.label}
            label={option.label}
            onSelect={() => onSelect(option.label)}
            testId={`chat-tempting-option-${item.item_public_id}-${option.label}`}
          />
        ))}
        <button
          className="rounded-full border border-line bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:border-accent hover:bg-accent-soft focus:outline-none focus:ring-2 focus:ring-accent-soft disabled:cursor-not-allowed disabled:opacity-60"
          data-testid="chat-no-tempting"
          disabled={disabled}
          onClick={onNo}
          type="button"
        >
          No
        </button>
      </div>
    </AgentMessage>
  );
}

function TextComposer({
  label,
  placeholder,
  value,
  maxLength,
  disabled,
  testId,
  sendTestId,
  onChange,
  onSend,
  sendLabel = "Send"
}: {
  label: string;
  placeholder: string;
  value: string;
  maxLength: number;
  disabled: boolean;
  testId: string;
  sendTestId?: string;
  onChange: (value: string) => void;
  onSend: () => void;
  sendLabel?: string;
}) {
  return (
    <div className="ml-auto w-full max-w-[82%] rounded-2xl rounded-br-md border border-line bg-white px-3 py-2.5 shadow-sm sm:max-w-[72%]">
      <label className="sr-only" htmlFor={testId}>
        {label}
      </label>
      <textarea
        className="min-h-20 w-full resize-none rounded-xl border border-line px-3 py-2 text-sm leading-6 text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft disabled:bg-[#f4f6f3]"
        data-testid={testId}
        disabled={disabled}
        id={testId}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            onSend();
          }
        }}
        placeholder={placeholder}
        value={value}
      />
      <div className="mt-2 flex items-center justify-between gap-3">
        <p className="text-xs text-muted">
          Press Enter to send; Shift+Enter adds a new line. {value.length} / {maxLength}
        </p>
        <button
          className="inline-flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60"
          data-testid={sendTestId ?? `${testId}-send`}
          disabled={disabled || !value.trim()}
          onClick={onSend}
          type="button"
        >
          <Send className="h-4 w-4" aria-hidden="true" />
          {sendLabel}
        </button>
      </div>
    </div>
  );
}

function PackageReviewMessage({
  review,
  isBusy,
  isCompletingPackage,
  editingItemId,
  editDraft,
  onCancelEdit,
  onContinue,
  onEditDraftChange,
  onSaveEdit,
  onStartEdit
}: {
  review: StudentReviewResponse | null;
  isBusy: boolean;
  isCompletingPackage: boolean;
  editingItemId: string | null;
  editDraft: PackageReviewEditDraft | null;
  onCancelEdit: () => void;
  onContinue: () => void;
  onEditDraftChange: (draft: PackageReviewEditDraft) => void;
  onSaveEdit: () => void;
  onStartEdit: (item: StudentReviewItem) => void;
}) {
  const reviewPrompt = buildInitialAdminPrompt({
    kind: "package_review_prompt",
    assessmentState: "PACKAGE_REVIEW",
    initialItemTotal: review?.items.length ?? null
  });

  return (
    <AgentMessage>
      <p className="font-medium text-ink">{reviewPrompt.prompt_text}</p>
      {review ? (
        <div className="mt-4 grid gap-2" data-testid="package-review-list">
          {review.items.map((item) => {
            const currentDraft = editingItemId === item.item_public_id ? editDraft : null;
            const isEditing = Boolean(currentDraft);

            return (
              <div className="rounded-xl border border-line bg-[#fbfcfa] px-3 py-2.5" key={item.item_public_id}>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <details className="min-w-0 flex-1 group" open={isEditing}>
                    <summary className="cursor-pointer list-none rounded-lg px-1 py-1 focus:outline-none focus:ring-2 focus:ring-accent-soft">
                      <span className="block text-xs font-semibold uppercase tracking-wide text-muted">
                        Item {item.initial_item_position ?? item.item_order} response
                      </span>
                      <span className="mt-1 block text-sm leading-6 text-ink">
                        Answer: {displayAnswer(item.existing_selected_option)}
                        {item.existing_confidence_rating
                          ? ` · Confidence: ${confidenceLabel(item.existing_confidence_rating)}`
                          : ""}
                      </span>
                      <span className="mt-1 block text-xs font-medium text-accent group-open:hidden">
                        Expand details
                      </span>
                      <span className="mt-1 hidden text-xs font-medium text-accent group-open:block">
                        Hide details
                      </span>
                    </summary>
                    <div className="mt-2 space-y-2 border-t border-line pt-3">
                      <p className="whitespace-pre-wrap text-sm leading-6 text-ink">{item.item_stem}</p>
                      <StudentMediaList mediaAssets={item.media_assets.filter((asset) => asset.placement === "item_stem")} />
                      <dl className="grid gap-2 text-sm">
                        <div>
                          <dt className="font-semibold text-ink">Reason</dt>
                          <dd className="whitespace-pre-wrap text-muted">
                            {item.existing_reasoning_text ?? "No reason provided"}
                          </dd>
                        </div>
                        <div>
                          <dt className="font-semibold text-ink">Tempting option</dt>
                          <dd className="text-muted">
                            {item.no_tempting_option
                              ? "No"
                              : item.tempting_option
                                ? item.tempting_option
                                : "Not provided"}
                          </dd>
                        </div>
                        {!item.no_tempting_option && item.tempting_option_reason ? (
                          <div>
                            <dt className="font-semibold text-ink">What made it tempting</dt>
                            <dd className="whitespace-pre-wrap text-muted">{item.tempting_option_reason}</dd>
                          </div>
                        ) : null}
                      </dl>
                    </div>
                  </details>
                  {item.can_edit && !isEditing ? (
                    <button
                      className="w-fit rounded-full border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink transition hover:border-accent hover:bg-accent-soft focus:outline-none focus:ring-2 focus:ring-accent-soft disabled:cursor-not-allowed disabled:opacity-60"
                      data-testid={`package-review-edit-${item.item_public_id}`}
                      disabled={isBusy}
                      onClick={() => onStartEdit(item)}
                      type="button"
                    >
                      Edit response
                    </button>
                  ) : null}
                </div>
                {currentDraft ? (
                  <div className="mt-3 grid gap-3 rounded-xl border border-line bg-white p-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted">Answer</p>
                      <div className="mt-2 grid gap-2">
                        {answerOptionsFor(item).map((option) => {
                          const selected = currentDraft.selectedOption === option.label;

                          return (
                            <button
                              aria-pressed={selected}
                              className={
                                selected
                                  ? "rounded-xl border border-accent bg-accent-soft px-3 py-2.5 text-left ring-2 ring-accent-soft transition focus:outline-none focus:ring-2 focus:ring-accent disabled:cursor-not-allowed disabled:opacity-70"
                                  : "rounded-xl border border-line bg-[#fbfcfa] px-3 py-2.5 text-left transition hover:border-accent hover:bg-accent-soft focus:outline-none focus:ring-2 focus:ring-accent disabled:cursor-not-allowed disabled:opacity-70"
                              }
                              data-testid={`package-review-edit-option-${item.item_public_id}-${option.label}`}
                              disabled={isBusy}
                              key={option.label}
                              onClick={() => onEditDraftChange({ ...currentDraft, selectedOption: option.label })}
                              type="button"
                            >
                              <span className="text-sm leading-6">
                                <span className="font-semibold">{option.label}.</span> {option.text}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div>
                      <label
                        className="text-xs font-semibold uppercase tracking-wide text-muted"
                        htmlFor={`package-review-edit-reasoning-${item.item_public_id}`}
                      >
                        Reason
                      </label>
                      <textarea
                        className="mt-2 min-h-20 w-full resize-none rounded-xl border border-line px-3 py-2 text-sm leading-6 text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft disabled:bg-[#f4f6f3]"
                        data-testid={`package-review-edit-reasoning-${item.item_public_id}`}
                        disabled={isBusy}
                        id={`package-review-edit-reasoning-${item.item_public_id}`}
                        maxLength={MAX_REASONING_LENGTH}
                        onChange={(event) =>
                          onEditDraftChange({ ...currentDraft, reasoningText: event.target.value })
                        }
                        value={currentDraft.reasoningText}
                      />
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted">Confidence</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {(["low", "medium", "high"] as ConfidenceRating[]).map((level) => (
                          <button
                            aria-pressed={currentDraft.confidenceRating === level}
                            className={
                              currentDraft.confidenceRating === level
                                ? "rounded-full border border-accent bg-accent-soft px-4 py-2 text-sm font-semibold text-ink ring-2 ring-accent-soft"
                                : "rounded-full border border-line bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:border-accent hover:bg-accent-soft"
                            }
                            data-testid={`package-review-edit-confidence-${item.item_public_id}-${level}`}
                            disabled={isBusy}
                            key={level}
                            onClick={() => onEditDraftChange({ ...currentDraft, confidenceRating: level })}
                            type="button"
                          >
                            {confidenceLabel(level)}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted">Tempting option</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {temptingOptionsFor(item, currentDraft.selectedOption).map((option) => (
                          <OptionChip
                            disabled={isBusy}
                            key={option.label}
                            label={option.label}
                            onSelect={() =>
                              onEditDraftChange({
                                ...currentDraft,
                                noTemptingOption: false,
                                temptingOption: option.label
                              })
                            }
                            testId={`package-review-edit-tempting-${item.item_public_id}-${option.label}`}
                          />
                        ))}
                        <button
                          className="rounded-full border border-line bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:border-accent hover:bg-accent-soft focus:outline-none focus:ring-2 focus:ring-accent-soft disabled:cursor-not-allowed disabled:opacity-60"
                          data-testid={`package-review-edit-no-tempting-${item.item_public_id}`}
                          disabled={isBusy}
                          onClick={() =>
                            onEditDraftChange({
                              ...currentDraft,
                              noTemptingOption: true,
                              temptingOption: "",
                              temptingOptionReason: ""
                            })
                          }
                          type="button"
                        >
                          No
                        </button>
                      </div>
                    </div>
                    {!currentDraft.noTemptingOption ? (
                      <div>
                        <label
                          className="text-xs font-semibold uppercase tracking-wide text-muted"
                          htmlFor={`package-review-edit-tempting-reason-${item.item_public_id}`}
                        >
                          What made it tempting
                        </label>
                        <textarea
                          className="mt-2 min-h-20 w-full resize-none rounded-xl border border-line px-3 py-2 text-sm leading-6 text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft disabled:bg-[#f4f6f3]"
                          data-testid={`package-review-edit-tempting-reason-${item.item_public_id}`}
                          disabled={isBusy}
                          id={`package-review-edit-tempting-reason-${item.item_public_id}`}
                          maxLength={MAX_REASONING_LENGTH}
                          onChange={(event) =>
                            onEditDraftChange({ ...currentDraft, temptingOptionReason: event.target.value })
                          }
                          value={currentDraft.temptingOptionReason}
                        />
                      </div>
                    ) : null}
                    <div className="flex flex-wrap gap-2">
                      <button
                        className="inline-flex items-center justify-center rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60"
                        data-testid={`package-review-save-${item.item_public_id}`}
                        disabled={isBusy || !reviewEditDraftIsComplete(currentDraft)}
                        onClick={onSaveEdit}
                        type="button"
                      >
                        Save edits
                      </button>
                      <button
                        className="inline-flex items-center justify-center rounded-full border border-line px-4 py-2 text-sm font-semibold text-ink transition hover:border-accent disabled:cursor-not-allowed disabled:opacity-60"
                        data-testid={`package-review-cancel-${item.item_public_id}`}
                        disabled={isBusy}
                        onClick={onCancelEdit}
                        type="button"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
      <button
        className="mt-4 inline-flex items-center justify-center rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60"
        data-testid="continue-to-feedback"
        disabled={isBusy || Boolean(editingItemId)}
        onClick={onContinue}
        type="button"
      >
        {isCompletingPackage ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            Reviewing responses...
          </>
        ) : (
          "Finish review"
        )}
      </button>
      {isCompletingPackage ? (
        <FormativeOpeningStatus status="preparing" />
      ) : null}
    </AgentMessage>
  );
}

function InFlowEditPanel({
  item,
  draft,
  isBusy,
  onCancel,
  onChange,
  onSave,
  onStart
}: {
  item: StudentSafeItem;
  draft: InFlowEditDraft | null;
  isBusy: boolean;
  onCancel: () => void;
  onChange: (draft: InFlowEditDraft) => void;
  onSave: () => void;
  onStart: (field: InFlowEditField) => void;
}) {
  const hasAnyResponse =
    Boolean(item.existing_selected_option) ||
    Boolean(item.existing_reasoning_text) ||
    Boolean(item.existing_confidence_rating) ||
    item.no_tempting_option ||
    Boolean(item.tempting_option);

  if (!hasAnyResponse) {
    return null;
  }

  return (
    <div className="flex justify-end" data-testid="in-flow-edit-panel">
      <div className="max-w-[82%] rounded-2xl rounded-br-md border border-line bg-white px-3 py-2.5 text-sm shadow-sm sm:max-w-[72%]">
      <p className="text-xs font-semibold text-muted">Edit latest response</p>
      {!draft ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {item.existing_selected_option ? (
            <button
              className="rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-ink hover:border-accent disabled:cursor-not-allowed disabled:opacity-60"
              data-testid="in-flow-edit-answer"
              disabled={isBusy}
              onClick={() => onStart("answer")}
              type="button"
            >
              Edit answer
            </button>
          ) : null}
          {item.existing_reasoning_text ? (
            <button
              className="rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-ink hover:border-accent disabled:cursor-not-allowed disabled:opacity-60"
              data-testid="in-flow-edit-reasoning"
              disabled={isBusy}
              onClick={() => onStart("reasoning")}
              type="button"
            >
              Edit reason
            </button>
          ) : null}
          {item.existing_confidence_rating ? (
            <button
              className="rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-ink hover:border-accent disabled:cursor-not-allowed disabled:opacity-60"
              data-testid="in-flow-edit-confidence"
              disabled={isBusy}
              onClick={() => onStart("confidence")}
              type="button"
            >
              Edit confidence
            </button>
          ) : null}
          {item.no_tempting_option || item.tempting_option ? (
            <button
              className="rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-ink hover:border-accent disabled:cursor-not-allowed disabled:opacity-60"
              data-testid="in-flow-edit-tempting"
              disabled={isBusy}
              onClick={() => onStart("tempting")}
              type="button"
            >
              Edit tempting option
            </button>
          ) : null}
        </div>
      ) : (
        <div className="mt-3 grid gap-3">
          {draft.field === "answer" ? (
            <div className="grid gap-2">
              {answerOptionsFor(item).map((option) => (
                <button
                  aria-pressed={draft.selectedOption === option.label}
                  className={
                    draft.selectedOption === option.label
                      ? "rounded-xl border border-accent bg-accent-soft px-3 py-2.5 text-left ring-2 ring-accent-soft"
                      : "rounded-xl border border-line bg-white px-3 py-2.5 text-left hover:border-accent hover:bg-accent-soft"
                  }
                  data-testid={`in-flow-edit-answer-option-${option.label}`}
                  disabled={isBusy}
                  key={option.label}
                  onClick={() => onChange({ ...draft, selectedOption: option.label })}
                  type="button"
                >
                  <span className="text-sm leading-6">
                    <span className="font-semibold">{option.label}.</span> {option.text}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
          {draft.field === "reasoning" ? (
            <textarea
              className="min-h-20 w-full resize-none rounded-xl border border-line px-3 py-2 text-sm leading-6 text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft disabled:bg-[#f4f6f3]"
              data-testid="in-flow-edit-reasoning-input"
              disabled={isBusy}
              maxLength={MAX_REASONING_LENGTH}
              onChange={(event) => onChange({ ...draft, reasoningText: event.target.value })}
              value={draft.reasoningText}
            />
          ) : null}
          {draft.field === "confidence" ? (
            <div className="flex flex-wrap gap-2">
              {(["low", "medium", "high"] as ConfidenceRating[]).map((level) => (
                <button
                  aria-pressed={draft.confidenceRating === level}
                  className={
                    draft.confidenceRating === level
                      ? "rounded-full border border-accent bg-accent-soft px-4 py-2 text-sm font-semibold text-ink ring-2 ring-accent-soft"
                      : "rounded-full border border-line bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:border-accent hover:bg-accent-soft"
                  }
                  data-testid={`in-flow-edit-confidence-${level}`}
                  disabled={isBusy}
                  key={level}
                  onClick={() => onChange({ ...draft, confidenceRating: level })}
                  type="button"
                >
                  {confidenceLabel(level)}
                </button>
              ))}
            </div>
          ) : null}
          {draft.field === "tempting" ? (
            <div className="grid gap-3">
              <div className="flex flex-wrap gap-2">
                {temptingOptionsFor(item, draft.selectedOption).map((option) => (
                  <OptionChip
                    disabled={isBusy}
                    key={option.label}
                    label={option.label}
                    onSelect={() =>
                      onChange({
                        ...draft,
                        noTemptingOption: false,
                        temptingOption: option.label
                      })
                    }
                    testId={`in-flow-edit-tempting-${option.label}`}
                  />
                ))}
                <button
                  className="rounded-full border border-line bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:border-accent hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-60"
                  data-testid="in-flow-edit-no-tempting"
                  disabled={isBusy}
                  onClick={() =>
                    onChange({
                      ...draft,
                      noTemptingOption: true,
                      temptingOption: "",
                      temptingOptionReason: ""
                    })
                  }
                  type="button"
                >
                  No
                </button>
              </div>
              {!draft.noTemptingOption ? (
                <textarea
                  className="min-h-20 w-full resize-none rounded-xl border border-line px-3 py-2 text-sm leading-6 text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft disabled:bg-[#f4f6f3]"
                  data-testid="in-flow-edit-tempting-reason-input"
                  disabled={isBusy}
                  maxLength={MAX_REASONING_LENGTH}
                  onChange={(event) => onChange({ ...draft, temptingOptionReason: event.target.value })}
                  placeholder="What made it tempting?"
                  value={draft.temptingOptionReason}
                />
              ) : null}
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button
              className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60"
              data-testid="in-flow-edit-save"
              disabled={isBusy}
              onClick={onSave}
              type="button"
            >
              Save edit
            </button>
            <button
              className="rounded-full border border-line px-4 py-2 text-sm font-semibold text-ink hover:border-accent disabled:cursor-not-allowed disabled:opacity-60"
              data-testid="in-flow-edit-cancel"
              disabled={isBusy}
              onClick={onCancel}
              type="button"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}

function FollowupControls({
  state,
  isBusy,
  followupDraft,
  setFollowupDraft,
  onSendFollowup,
  onStopFollowup,
  onRequestProgression,
  onProgressionChoice
}: {
  state: StudentSessionState;
  isBusy: boolean;
  followupDraft: string;
  setFollowupDraft: (value: string) => void;
  onSendFollowup: () => void;
  onStopFollowup: () => void;
  onRequestProgression: () => void;
  onProgressionChoice: (
    choice:
      | "continue_current_concept"
      | "next_concept"
      | "stay_in_final_concept"
      | "complete_assessment"
  ) => void;
}) {
  const maxChars = state.followup?.message_max_chars ?? 6000;
  const progression = state.progression ?? null;

  if (state.assessment_state === "SESSION_COMPLETE" || state.next_step === "session_completed") {
    return (
      <AgentMessage>
        <p className="font-medium text-ink">This assessment session is complete.</p>
      </AgentMessage>
    );
  }

  if (state.next_step === "followup_updating") {
    return (
      <AgentMessage>
        <p className="font-medium text-ink">Your response is being reviewed. This may take a moment.</p>
      </AgentMessage>
    );
  }

  if (state.next_step === "followup_stopped") {
    return (
      <AgentMessage>
        <p className="font-medium text-ink">The follow-up activity is paused.</p>
      </AgentMessage>
    );
  }

  return (
    <>
      {progression?.available ? (
        <AgentMessage>
          {progression.neutral_message ? (
            <p className="mb-3 text-sm leading-6 text-ink">{progression.neutral_message}</p>
          ) : null}
          {progression.progression_public_id ? (
            <div className="flex flex-wrap gap-2">
              {progression.is_final_concept ? (
                <>
                  <button
                    className="rounded-md border border-line px-4 py-2 text-sm font-semibold text-ink hover:border-accent disabled:cursor-not-allowed disabled:opacity-60"
                    data-testid="stay-in-final-concept"
                    disabled={isBusy || progression.processing}
                    onClick={() => onProgressionChoice("stay_in_final_concept")}
                    type="button"
                  >
                    Stay here
                  </button>
                  <button
                    className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60"
                    data-testid="complete-assessment"
                    disabled={isBusy || progression.processing}
                    onClick={() => onProgressionChoice("complete_assessment")}
                    type="button"
                  >
                    Complete assessment
                  </button>
                </>
              ) : (
                <>
                  <button
                    className="rounded-md border border-line px-4 py-2 text-sm font-semibold text-ink hover:border-accent disabled:cursor-not-allowed disabled:opacity-60"
                    data-testid="continue-current-concept"
                    disabled={isBusy || progression.processing}
                    onClick={() => onProgressionChoice("continue_current_concept")}
                    type="button"
                  >
                    Keep working here
                  </button>
                  <button
                    className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60"
                    data-testid="next-concept"
                    disabled={isBusy || progression.processing}
                    onClick={() => onProgressionChoice("next_concept")}
                    type="button"
                  >
                    Move to next concept
                  </button>
                </>
              )}
            </div>
          ) : (
            <button
              className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60"
              data-testid="request-progression"
              disabled={isBusy || progression.processing}
              onClick={onRequestProgression}
              type="button"
            >
              See my next choice
            </button>
          )}
        </AgentMessage>
      ) : null}
      <TextComposer
        disabled={isBusy || !state.followup?.can_send}
        label="Follow-up response"
        maxLength={maxChars}
        onChange={setFollowupDraft}
        onSend={onSendFollowup}
        placeholder="Write your response..."
        sendTestId="send-followup-message"
        testId="followup-message-input"
        value={followupDraft}
      />
      <div className="flex justify-end">
        <button
          className="rounded-md border border-line px-4 py-2 text-sm font-semibold text-ink hover:border-accent disabled:cursor-not-allowed disabled:opacity-60"
          data-testid="stop-followup"
          disabled={isBusy || !state.followup?.can_stop}
          onClick={onStopFollowup}
          type="button"
        >
          Pause follow-up
        </button>
      </div>
    </>
  );
}

function FormativeActivityControls({
  activityRuntime,
  isBusy,
  formativeActivityDraft,
  setFormativeActivityDraft,
  onChooseActivityRuntimeAction,
  onRequestEndAssessment,
  onSendFormativeActivityResponse
}: {
  activityRuntime: StudentActivityRuntimeProjection | null | undefined;
  isBusy: boolean;
  formativeActivityDraft: string;
  setFormativeActivityDraft: (value: string) => void;
  onChooseActivityRuntimeAction: (choiceState:
    | "skip_activity_to_transfer"
    | "skip_activity_to_next_concept"
    | "finish_assessment"
  ) => void;
  onRequestEndAssessment: () => void;
  onSendFormativeActivityResponse: () => void;
}) {
  const runtime = activityRuntime ?? null;

  if (!runtime || runtime.ui_state === "not_started") {
    return (
      <AgentMessage>
        <p className="font-medium text-ink">The next activity is not available yet.</p>
      </AgentMessage>
    );
  }

  const choiceButtons = (
    <div className="mt-4 flex flex-wrap gap-2">
      {runtime.can_move_on ? (
        <button
          className="rounded-full border border-line bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:border-accent hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-60"
          data-testid="activity-runtime-end-assessment"
          disabled={isBusy}
          onClick={onRequestEndAssessment}
          type="button"
        >
          End assessment
        </button>
      ) : null}
    </div>
  );
  const canContinueToTransfer = runtime.feedback?.next_options.includes("continue to transfer item") ?? false;
  const canContinueToNextConcept = runtime.feedback?.next_options.includes("continue to next concept") ?? false;
  const destinationButtons = (
    <div className="mt-4 flex flex-wrap gap-2">
      {runtime.can_continue && canContinueToTransfer ? (
        <button
          className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60"
          data-testid="activity-runtime-continue-transfer"
          disabled={isBusy}
          onClick={() => onChooseActivityRuntimeAction("skip_activity_to_transfer")}
          type="button"
        >
          Continue to transfer item
        </button>
      ) : null}
      {runtime.can_continue && canContinueToNextConcept ? (
        <button
          className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60"
          data-testid="activity-runtime-continue-next-concept"
          disabled={isBusy}
          onClick={() => onChooseActivityRuntimeAction("skip_activity_to_next_concept")}
          type="button"
        >
          Continue to next concept
        </button>
      ) : null}
      {runtime.can_move_on ? (
        <button
          className="rounded-full border border-line bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:border-accent hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-60"
          data-testid="activity-runtime-end-assessment"
          disabled={isBusy}
          onClick={onRequestEndAssessment}
          type="button"
        >
          End assessment
        </button>
      ) : null}
    </div>
  );

  if (
    runtime.ui_state === "could_not_prepare_activity_safely" ||
    runtime.ui_state === "could_not_review_response_safely"
  ) {
    return (
      <AgentMessage>
        <p className="font-medium text-ink">{runtime.feedback?.message ?? runtime.status_message}</p>
        {choiceButtons}
      </AgentMessage>
    );
  }

  if (
    runtime.topic_dialogue?.state === "awaiting_response" ||
    runtime.topic_dialogue?.state === "final_support"
  ) {
    return (
      <>
        {!runtime.latest_reply_visible_in_transcript ? (
          <AgentMessage>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">
              Topic support
            </p>
            <p className="mt-2 whitespace-pre-wrap text-[0.95rem] leading-7 text-ink">
              {runtime.topic_dialogue.tutor_message ?? runtime.feedback?.message ?? runtime.status_message}
            </p>
            {runtime.topic_dialogue.response_prompt ? (
              <p className="mt-3 text-sm font-medium text-ink">
                {runtime.topic_dialogue.response_prompt}
              </p>
            ) : null}
            {runtime.topic_dialogue.state === "final_support" ? destinationButtons : choiceButtons}
          </AgentMessage>
        ) : runtime.topic_dialogue.state === "final_support" ? (
          destinationButtons
        ) : (
          choiceButtons
        )}
        {runtime.topic_dialogue.state === "awaiting_response" ? (
          <TextComposer
            disabled={isBusy || !runtime.can_submit_response}
            label="Topic response"
            maxLength={runtime.message_max_chars}
            onChange={setFormativeActivityDraft}
            onSend={onSendFormativeActivityResponse}
            placeholder="Write your response..."
            sendLabel="Send"
            sendTestId="send-topic-dialogue-response"
            testId="topic-dialogue-response-input"
            value={formativeActivityDraft}
          />
        ) : null}
      </>
    );
  }

  if (runtime.ui_state === "reviewing_your_response") {
    return (
      <AgentMessage>
        <p className="font-medium text-ink">I am reviewing your response.</p>
      </AgentMessage>
    );
  }

  if (
    runtime.ui_state === "feedback_ready" ||
    runtime.ui_state === "alternative_requested" ||
    runtime.ui_state === "moved_on"
  ) {
    if (runtime.latest_reply_visible_in_transcript) {
      return destinationButtons;
    }
    return (
      <AgentMessage>
        {runtime.focus_label ? (
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">{runtime.focus_label}</p>
        ) : null}
        <p className="mt-2 whitespace-pre-wrap font-medium text-ink">
          {runtime.feedback?.message ?? runtime.status_message}
        </p>
        {runtime.next_recommendation_label ? (
          <p className="mt-3 text-sm text-muted">{runtime.next_recommendation_label}</p>
        ) : null}
        {destinationButtons}
      </AgentMessage>
    );
  }

  return (
    <>
      {!runtime.first_turn_visible_in_transcript ? (
        <AgentMessage>
          {runtime.focus_label ? (
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">{runtime.focus_label}</p>
          ) : null}
          <p className="mt-2 whitespace-pre-wrap text-[0.95rem] leading-7 text-ink">
            {runtime.first_turn_message ?? runtime.status_message}
          </p>
          {runtime.response_prompt ? (
            <p className="mt-3 text-sm font-medium text-ink">{runtime.response_prompt}</p>
          ) : null}
          {choiceButtons}
        </AgentMessage>
      ) : (
        choiceButtons
      )}
      <TextComposer
        disabled={isBusy || !runtime.can_submit_response}
        label="Activity response"
        maxLength={runtime.message_max_chars}
        onChange={setFormativeActivityDraft}
        onSend={onSendFormativeActivityResponse}
        placeholder="Write your response..."
        sendLabel="Submit response"
        sendTestId="send-formative-activity-response"
        testId="formative-activity-response-input"
        value={formativeActivityDraft}
      />
    </>
  );
}

function RevisionControls({
  state,
  isBusy,
  revisionDraft,
  setRevisionDraft,
  onSendRevision
}: {
  state: StudentSessionState;
  isBusy: boolean;
  revisionDraft: string;
  setRevisionDraft: (value: string) => void;
  onSendRevision: () => void;
}) {
  return (
    <TextComposer
      disabled={isBusy}
      label="Revision"
      maxLength={state.followup?.message_max_chars ?? 5000}
      onChange={setRevisionDraft}
      onSend={onSendRevision}
      placeholder="Write your revision..."
      sendTestId="send-revision-response"
      testId="revision-response-input"
      value={revisionDraft}
    />
  );
}

function NextChoiceControls({
  isBusy,
  onNextChoice
}: {
  isBusy: boolean;
  onNextChoice: (choice: "move_next" | "try_another") => void;
}) {
  return (
    <AgentMessage>
      <p className="whitespace-pre-line font-medium text-ink">
        Choose one:{"\n"}A. Move to the next concept.{"\n"}B. Try another question on the same idea.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60"
          data-testid="next-choice-move-next"
          disabled={isBusy}
          onClick={() => onNextChoice("move_next")}
          type="button"
        >
          A
        </button>
        <button
          className="rounded-full border border-line bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:border-accent hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-60"
          data-testid="next-choice-try-another"
          disabled={isBusy}
          onClick={() => onNextChoice("try_another")}
          type="button"
        >
          B
        </button>
      </div>
    </AgentMessage>
  );
}

function PackageResultsChatCard({
  packageResults
}: {
  packageResults?: StudentSessionState["package_results"] | null;
}) {
  if (!packageResults) {
    return null;
  }

  return (
    <AgentMessage>
      <details
        className="rounded-xl border border-line bg-[#fbfcfa] px-3 py-3"
        data-testid="package-results-chat-card"
        open
      >
        <summary className="cursor-pointer list-none text-sm font-semibold text-ink focus:outline-none focus:ring-2 focus:ring-accent-soft">
          Review your answers
        </summary>
        <div className="mt-3 rounded-xl bg-[#f7f9f6] px-3 py-3 text-sm leading-5 text-ink">
          <div data-testid="package-results-summary">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Total correct</p>
            <p className="mt-1 font-semibold text-ink">{packageResults.result_summary}</p>
            <div className="mt-3 space-y-2" data-testid="initial-answer-review-list">
              {packageResults.items.map((item) => (
                <details
                  key={item.item_public_id}
                  className="rounded-xl border border-line bg-white px-3 py-2"
                  data-testid="initial-answer-review-item"
                  open
                >
                  <summary className="cursor-pointer list-none text-sm font-semibold text-ink focus:outline-none focus:ring-2 focus:ring-accent-soft">
                    Item {item.item_position ?? "?"} — {item.status_label}
                  </summary>
                  <div className="mt-2 space-y-1 text-sm text-muted">
                    <p>
                      <span className="font-semibold text-ink">Your answer:</span>{" "}
                      {item.student_answer ?? item.selected_option ?? "No answer recorded"}
                    </p>
                    <p>
                      <span className="font-semibold text-ink">Confidence:</span>{" "}
                      {item.confidence ? confidenceLabel(item.confidence) : "Not recorded"}
                    </p>
                    <p>
                      <span className="font-semibold text-ink">Correct answer:</span>{" "}
                      {item.answer_revealed && item.revealed_answer
                        ? item.revealed_answer
                        : "Not shown"}
                    </p>
                    {item.answer_explanation_revealed && item.answer_explanation ? (
                      <p>
                        <span className="font-semibold text-ink">Why:</span>{" "}
                        {item.answer_explanation}
                      </p>
                    ) : null}
                    {item.distractor_boundary ? (
                      <p>
                        <span className="font-semibold text-ink">Boundary to notice:</span>{" "}
                        {item.distractor_boundary}
                      </p>
                    ) : null}
                  </div>
                </details>
              ))}
            </div>
          </div>
        </div>
      </details>
    </AgentMessage>
  );
}

function StudentAssessmentChatShell({
  state,
  isBusy,
  readOnlyReview,
  onBackToAssessments,
  onExit,
  onEndAttempt,
  children
}: {
  state: StudentSessionState;
  isBusy: boolean;
  readOnlyReview: boolean;
  onBackToAssessments: () => void;
  onExit: () => void;
  onEndAttempt: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="mx-auto flex min-h-[calc(100vh-7rem)] w-full max-w-6xl flex-col px-4 py-5 sm:px-6 lg:px-8"
      data-testid="student-assessment-chat-shell"
    >
      <header className="mb-4 flex flex-col gap-3 border-b border-line/70 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">
            {state.assessment.title}
          </p>
          <h1 className="mt-1 text-lg font-semibold text-ink">
            {readOnlyReview
              ? state.session?.attempt_number
                ? `Attempt ${state.session.attempt_number} review`
                : "Past attempt review"
              : state.current_concept_unit?.title ?? "Assessment"}
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {readOnlyReview ? (
            <button
              className="inline-flex w-fit items-center justify-center gap-2 rounded-full border border-line bg-white px-3 py-2 text-sm font-semibold text-ink transition hover:border-accent"
              data-testid="back-to-assessments"
              onClick={onBackToAssessments}
              type="button"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Back to assessments
            </button>
          ) : (
            <>
              <button
                className="inline-flex w-fit items-center justify-center gap-2 rounded-full border border-line bg-white px-3 py-2 text-sm font-semibold text-ink transition hover:border-accent disabled:cursor-not-allowed disabled:opacity-60"
                data-testid="save-exit"
                disabled={isBusy || !state.can_exit}
                onClick={onExit}
                type="button"
              >
                <LogOut className="h-4 w-4" aria-hidden="true" />
                Pause and leave
              </button>
              <button
                className="inline-flex w-fit items-center justify-center rounded-full border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800 transition hover:border-red-300 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                data-testid="end-attempt"
                disabled={isBusy || !state.can_end_attempt}
                onClick={onEndAttempt}
                type="button"
              >
                End attempt
              </button>
            </>
          )}
        </div>
      </header>
      {children}
    </div>
  );
}

function ChatTranscript({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-0 flex-1 rounded-[1.75rem] bg-[#f7f9f6] px-3 py-4 sm:px-5">
      <div
        className="mx-auto flex w-full max-w-3xl flex-col gap-3"
        data-testid="chat-transcript"
      >
        {children}
      </div>
    </main>
  );
}

function stateIsTransferItemFlow(state: StudentSessionState) {
  return (
    state.assessment_state === "TRANSFER_ITEM" ||
    state.next_step === "transfer_item" ||
    state.effective_phase === "followup_stopped" ||
    state.current_phase === "followup_stopped"
  );
}

function shouldShowLearningProfile(state: StudentSessionState) {
  return [
    "PACKAGE_REVIEW",
    "PACKAGE_ANALYSIS",
    "FORMATIVE_ACTIVITY",
    "FOLLOWUP_RESPONSE",
    "TARGETED_FEEDBACK",
    "REVISION",
    "NEXT_CHOICE",
    "TRANSFER_ITEM",
    "SESSION_COMPLETE"
  ].includes(state.assessment_state);
}

function splitTranscriptForPackageResults(
  entries: StudentTranscriptEntry[],
  showPackageResults: boolean
) {
  if (!showPackageResults) {
    return {
      beforePackageResults: entries,
      afterPackageResults: [] as StudentTranscriptEntry[]
    };
  }

  const postPackageBoundary = entries.findIndex((entry) =>
    entry.interaction_type === "package_feedback" ||
    entry.interaction_type === "formative_activity"
  );

  if (postPackageBoundary < 0) {
    return {
      beforePackageResults: entries,
      afterPackageResults: [] as StudentTranscriptEntry[]
    };
  }

  return {
    beforePackageResults: entries.slice(0, postPackageBoundary),
    afterPackageResults: entries.slice(postPackageBoundary)
  };
}

function activeItemPrompt(input: {
  state: StudentSessionState;
  activityRuntime: StudentActivityRuntimeProjection | null;
  review: StudentReviewResponse | null;
  isBusy: boolean;
  isCompletingPackage: boolean;
  reasoningDraft: string;
  temptingReasonDraft: string;
  followupDraft: string;
  formativeActivityDraft: string;
  revisionDraft: string;
  inFlowEditDraft: InFlowEditDraft | null;
  editingReviewItemId: string | null;
  reviewEditDraft: PackageReviewEditDraft | null;
  setReasoningDraft: (value: string) => void;
  setTemptingReasonDraft: (value: string) => void;
  setFollowupDraft: (value: string) => void;
  setFormativeActivityDraft: (value: string) => void;
  setRevisionDraft: (value: string) => void;
  setInFlowEditDraft: (value: InFlowEditDraft) => void;
  setReviewEditDraft: (value: PackageReviewEditDraft) => void;
  onBeginConceptUnit: () => void;
  onCancelReviewEdit: () => void;
  onSelectOption: (label: string) => void;
  onSendReasoning: () => void;
  onSelectConfidence: (confidence: ConfidenceRating) => void;
  onSelectTemptingOption: (label: string) => void;
  onNoTemptingOption: () => void;
  onSendTemptingReason: () => void;
  onStartInFlowEdit: (field: InFlowEditField) => void;
  onCancelInFlowEdit: () => void;
  onSaveInFlowEdit: () => void;
  onContinuePackage: () => void;
  onSaveReviewEdit: () => void;
  onStartReviewEdit: (item: StudentReviewItem) => void;
  onChooseActivityRuntimeAction: (choiceState:
    | "skip_activity_to_transfer"
    | "skip_activity_to_next_concept"
    | "finish_assessment"
  ) => void;
  onRequestEndAssessment: () => void;
  onSendFormativeActivityResponse: () => void;
  onStartActivityRuntime: () => void;
  onSendRevision: () => void;
  onNextChoice: (choice: "move_next" | "try_another") => void;
  onSendFollowup: () => void;
  onStopFollowup: () => void;
  onRequestProgression: () => void;
  onProgressionChoice: (
    choice:
      | "continue_current_concept"
      | "next_concept"
      | "stay_in_final_concept"
      | "complete_assessment"
  ) => void;
}) {
  const { state, isBusy } = input;
  const item = state.current_item;
  const isTransferItem = stateIsTransferItemFlow(state);
  const inFlowEditPanel =
    item && state.assessment_state !== "PACKAGE_REVIEW" && state.assessment_state !== "PACKAGE_ANALYSIS" ? (
      <InFlowEditPanel
        draft={input.inFlowEditDraft}
        isBusy={isBusy}
        item={item}
        onCancel={input.onCancelInFlowEdit}
        onChange={input.setInFlowEditDraft}
        onSave={input.onSaveInFlowEdit}
        onStart={input.onStartInFlowEdit}
      />
    ) : null;

  if (state.assessment_state === "SESSION_START") {
    const initialItemCount = state.progress.initial_item_count;
    return (
      <AgentMessage>
        <p className="font-medium text-ink">
          We will start with {initialItemCount} initial {initialItemCount === 1 ? "question" : "questions"}. I will ask for your answer, your reason,
          your confidence, and whether another option was tempting.
        </p>
        {state.current_concept_unit ? (
          <button
            className="mt-4 inline-flex items-center justify-center rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60"
            data-testid="begin-concept-unit"
            disabled={isBusy}
            onClick={input.onBeginConceptUnit}
            type="button"
          >
            Start questions
          </button>
        ) : null}
      </AgentMessage>
    );
  }

  if (
    (state.assessment_state === "ITEM_PRESENTED" ||
      state.assessment_state === "AWAIT_ANSWER" ||
      state.assessment_state === "TRANSFER_ITEM") &&
    item
  ) {
    return (
      <AgentItemMessage
        disabled={isBusy}
        isTransferItem={isTransferItem}
        item={item}
        onSelect={input.onSelectOption}
      />
    );
  }

  if (state.assessment_state === "AWAIT_REASON" && item) {
    const reasoningPrompt = buildInitialAdminPrompt({
      kind: "reasoning_prompt",
      assessmentState: "AWAIT_REASON",
      itemPublicId: item.item_public_id,
      itemOrder: item.item_order,
      itemRole: isTransferItem ? "transfer" : "initial",
      selectedOption: item.existing_selected_option
    });

    return (
      <>
        <AgentMessage>
          <p className="font-medium text-ink">{reasoningPrompt.prompt_text}</p>
        </AgentMessage>
        <TextComposer
          disabled={isBusy}
          label="Reason for answer"
          maxLength={MAX_REASONING_LENGTH}
          onChange={input.setReasoningDraft}
          onSend={input.onSendReasoning}
          placeholder="Type your reason..."
          testId="reasoning-input"
          value={input.reasoningDraft}
        />
        {inFlowEditPanel}
      </>
    );
  }

  if (state.assessment_state === "AWAIT_CONFIDENCE") {
    return (
      <>
        <ConfidenceMessage
          disabled={isBusy}
          isTransferItem={isTransferItem}
          item={item ?? null}
          onSelect={input.onSelectConfidence}
        />
        {inFlowEditPanel}
      </>
    );
  }

  if (state.assessment_state === "AWAIT_TEMPTING_OPTION" && item) {
    return (
      <>
        <TemptingOptionMessage
          disabled={isBusy}
          isTransferItem={isTransferItem}
          item={item}
          onNo={input.onNoTemptingOption}
          onSelect={input.onSelectTemptingOption}
        />
        {inFlowEditPanel}
      </>
    );
  }

  if (state.assessment_state === "AWAIT_TEMPTING_REASON") {
    const temptingReasonPrompt = buildInitialAdminPrompt({
      kind: "tempting_reason_prompt",
      assessmentState: "AWAIT_TEMPTING_REASON",
      itemPublicId: item?.item_public_id ?? null,
      itemOrder: item?.item_order ?? null,
      itemRole: isTransferItem ? "transfer" : "initial",
      selectedOption: item?.tempting_option ?? null
    });

    return (
      <>
        <AgentMessage>
          <p className="font-medium text-ink">{temptingReasonPrompt.prompt_text}</p>
        </AgentMessage>
        <TextComposer
          disabled={isBusy}
          label="Tempting option reason"
          maxLength={MAX_REASONING_LENGTH}
          onChange={input.setTemptingReasonDraft}
          onSend={input.onSendTemptingReason}
          placeholder="Type what made it tempting..."
          testId="tempting-reason-input"
          value={input.temptingReasonDraft}
        />
        {inFlowEditPanel}
      </>
    );
  }

  if (state.assessment_state === "ITEM_COMPLETE") {
    return (
      <AgentMessage>
        <p className="font-medium text-ink">Thanks. I am opening the next question.</p>
      </AgentMessage>
    );
  }

  if (state.assessment_state === "PACKAGE_REVIEW") {
    return (
      <PackageReviewMessage
        editDraft={input.reviewEditDraft}
        editingItemId={input.editingReviewItemId}
        isBusy={isBusy}
        isCompletingPackage={input.isCompletingPackage}
        onCancelEdit={input.onCancelReviewEdit}
        onContinue={input.onContinuePackage}
        onEditDraftChange={input.setReviewEditDraft}
        onSaveEdit={input.onSaveReviewEdit}
        onStartEdit={input.onStartReviewEdit}
        review={input.review}
      />
    );
  }

  if (state.assessment_state === "PACKAGE_ANALYSIS" || state.next_step === "awaiting_profiling") {
    return (
      <AgentMessage>
        <p className="font-medium text-ink">
          Your initial responses have been reviewed. The next support step is not available yet in this prototype.
        </p>
      </AgentMessage>
    );
  }

  if (
    state.assessment_state === "FORMATIVE_ACTIVITY" ||
    state.next_step === "formative_activity" ||
    state.next_step === "formative_response_saved"
  ) {
    return (
      <FormativeActivityControls
        activityRuntime={input.activityRuntime}
        formativeActivityDraft={input.formativeActivityDraft}
        isBusy={isBusy}
        onChooseActivityRuntimeAction={input.onChooseActivityRuntimeAction}
        onRequestEndAssessment={input.onRequestEndAssessment}
        onSendFormativeActivityResponse={input.onSendFormativeActivityResponse}
        setFormativeActivityDraft={input.setFormativeActivityDraft}
      />
    );
  }

  if (state.assessment_state === "REVISION" || state.next_step === "revision_requested") {
    return (
      <RevisionControls
        isBusy={isBusy}
        onSendRevision={input.onSendRevision}
        revisionDraft={input.revisionDraft}
        setRevisionDraft={input.setRevisionDraft}
        state={state}
      />
    );
  }

  if (state.assessment_state === "NEXT_CHOICE") {
    return (
      <NextChoiceControls
        isBusy={isBusy}
        onNextChoice={input.onNextChoice}
      />
    );
  }

  if (
    state.assessment_state === "FOLLOWUP_RESPONSE" ||
    state.assessment_state === "TARGETED_FEEDBACK" ||
    state.assessment_state === "TRANSFER_ITEM" ||
    state.next_step === "followup_active" ||
    state.next_step === "followup_updating" ||
    state.next_step === "followup_stopped"
  ) {
    return (
      <FollowupControls
        followupDraft={input.followupDraft}
        isBusy={isBusy}
        onProgressionChoice={input.onProgressionChoice}
        onRequestProgression={input.onRequestProgression}
        onSendFollowup={input.onSendFollowup}
        onStopFollowup={input.onStopFollowup}
        setFollowupDraft={input.setFollowupDraft}
        state={state}
      />
    );
  }

  if (state.assessment_state === "SESSION_COMPLETE" || state.next_step === "session_completed") {
    return (
      <AgentMessage>
        <p className="font-medium text-ink">This assessment session is complete.</p>
      </AgentMessage>
    );
  }

  return (
    <AgentMessage>
      <p className="font-medium text-ink">The assessment is preparing the next step.</p>
    </AgentMessage>
  );
}

export function AssessmentSessionClient({
  assessmentPublicId,
  initialSessionPublicId,
  readOnlyReview = false,
  sessionPublicId
}: {
  assessmentPublicId?: string;
  initialSessionPublicId?: string;
  readOnlyReview?: boolean;
  sessionPublicId?: string;
}) {
  const router = useRouter();
  const resolvedInitialSessionPublicId = initialSessionPublicId ?? sessionPublicId;
  const [state, setState] = useState<StudentSessionState | null>(null);
  const [activityRuntime, setActivityRuntime] = useState<StudentActivityRuntimeProjection | null>(null);
  const [transcript, setTranscript] = useState<StudentTranscriptEntry[]>([]);
  const [review, setReview] = useState<StudentReviewResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isBusy, setIsBusy] = useState(false);
  const [isCompletingPackage, setIsCompletingPackage] = useState(false);
  const [isRetryingOpening, setIsRetryingOpening] = useState(false);
  const [isAwaitingFormativeTutorResponse, setIsAwaitingFormativeTutorResponse] =
    useState(false);
  const [error, setError] = useState<StructuredStudentApiError | null>(null);
  const [failedAction, setFailedAction] = useState<FailedAction | null>(null);
  const [reasoningDraft, setReasoningDraft] = useState("");
  const [temptingReasonDraft, setTemptingReasonDraft] = useState("");
  const [followupDraft, setFollowupDraft] = useState("");
  const [formativeActivityDraft, setFormativeActivityDraft] = useState("");
  const [formativeConversationDraft, setFormativeConversationDraft] =
    useState("");
  const [revisionDraft, setRevisionDraft] = useState("");
  const [inFlowEditDraft, setInFlowEditDraft] = useState<InFlowEditDraft | null>(null);
  const [editingReviewItemId, setEditingReviewItemId] = useState<string | null>(null);
  const [reviewEditDraft, setReviewEditDraft] = useState<PackageReviewEditDraft | null>(null);
  const [endConversationDialogOpen, setEndConversationDialogOpen] =
    useState(false);
  const [endAssessmentDialogOpen, setEndAssessmentDialogOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const packageResultsRef = useRef<HTMLDivElement | null>(null);
  const displayAcknowledgementRef = useRef<Set<string>>(new Set());
  const formativeMessageIdRef = useRef<string | null>(null);
  const formativeTypingStartedAtRef = useRef<Date | null>(null);
  const formativeEditCountRef = useRef(0);
  const formativeBackspaceCountRef = useRef(0);
  const formativePasteCountRef = useRef(0);
  const formativePasteCharacterCountRef = useRef(0);
  const formativeClientInstanceIdRef = useRef<string | null>(null);
  const formativeConversationPublicId =
    state?.formative_conversation?.conversation_public_id ?? null;
  const activeSessionPublicId =
    state?.session_public_id ?? resolvedInitialSessionPublicId ?? null;

  useStudentProcessEvents({
    sessionPublicId: state?.session_public_id ?? resolvedInitialSessionPublicId ?? "pending-session",
    currentItemPublicId: state?.current_item?.item_public_id,
    enabled: !readOnlyReview
  });

  useEffect(() => {
    if (readOnlyReview || !activeSessionPublicId || !formativeConversationPublicId) {
      return;
    }
    formativeClientInstanceIdRef.current ??=
      newClientActionId("formative-conversation-client");
    const clientInstanceId = formativeClientInstanceIdRef.current;
    const record = (
      eventType:
        | "page_visible"
        | "page_hidden"
        | "refreshed"
        | "left"
        | "reentered"
        | "disconnected"
        | "reconnected",
      keepalive = false
    ) => {
      const occurredAt = new Date();
      void sendFormativeConversationEvent({
        sessionPublicId: activeSessionPublicId,
        conversationPublicId: formativeConversationPublicId,
        clientEventId: newClientActionId(`formative-${eventType}`),
        eventType,
        occurredAt: occurredAt.toISOString(),
        clientInstanceId,
        keepalive
      }).catch(() => undefined);
    };
    const navigationEntry = performance
      .getEntriesByType("navigation")
      .at(0) as PerformanceNavigationTiming | undefined;
    const visitKey = `formative-conversation-visited:${formativeConversationPublicId}`;
    const hasVisited =
      window.sessionStorage.getItem(visitKey) === "true";
    if (navigationEntry?.type === "reload") {
      record("refreshed");
    } else if (hasVisited) {
      record("reentered");
    } else {
      record("page_visible");
    }
    window.sessionStorage.setItem(visitKey, "true");
    const onVisibilityChange = () =>
      record(document.visibilityState === "hidden" ? "page_hidden" : "page_visible");
    const onPageHide = () => record("left", true);
    const onOffline = () => record("disconnected");
    const onOnline = () => record("reconnected");
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
    };
  }, [
    activeSessionPublicId,
    formativeConversationPublicId,
    readOnlyReview
  ]);

  async function refreshSecondaryData(sessionPublicId: string) {
    const [transcriptResult, reviewResult] = await Promise.allSettled([
      fetchStudentTranscript(sessionPublicId),
      fetchStudentReview(sessionPublicId)
    ]);

    if (transcriptResult.status === "fulfilled") {
      setTranscript(transcriptResult.value.transcript);
    }

    if (reviewResult.status === "fulfilled") {
      setReview(reviewResult.value);
    }
  }

  function handleError(errorValue: unknown, label: string, retry: () => void) {
    const apiError =
      errorValue && typeof errorValue === "object" && "code" in errorValue && "message" in errorValue
        ? (errorValue as StructuredStudentApiError)
        : {
            code: "request_failed",
            message: "The request could not be completed.",
            status: 500
          };

    setError(apiError);
    setFailedAction({ label, retry });
  }

  function handleFormativeConversationDraft(value: string) {
    if (!formativeTypingStartedAtRef.current && value.length > 0) {
      formativeTypingStartedAtRef.current = new Date();
    }
    if (formativeConversationDraft.length > 0) {
      formativeEditCountRef.current += 1;
    }
    setFormativeConversationDraft(value);
  }

  function resetFormativeInputTelemetry() {
    formativeTypingStartedAtRef.current = null;
    formativeEditCountRef.current = 0;
    formativeBackspaceCountRef.current = 0;
    formativePasteCountRef.current = 0;
    formativePasteCharacterCountRef.current = 0;
  }

  async function handleSendFormativeConversationMessage() {
    const conversation = state?.formative_conversation;
    const message = formativeConversationDraft.trim();
    if (!state || !conversation || !conversation.can_send || !message || isBusy) {
      return;
    }
    const clientMessageId =
      formativeMessageIdRef.current ??
      newClientActionId("formative-conversation-message");
    formativeMessageIdRef.current = clientMessageId;
    const submittedAt = new Date();
    const typingStartedAt = formativeTypingStartedAtRef.current;
    setIsBusy(true);
    setIsAwaitingFormativeTutorResponse(true);
    setError(null);
    setFailedAction(null);
    try {
      const nextConversation = await sendFormativeConversationMessage({
        sessionPublicId: state.session_public_id,
        conversationPublicId: conversation.conversation_public_id,
        messageText: message,
        clientMessageId,
        observableInputTelemetry: {
          turn_started_at: typingStartedAt?.toISOString() ?? null,
          submitted_at: submittedAt.toISOString(),
          response_time_ms: typingStartedAt
            ? Math.max(0, submittedAt.getTime() - typingStartedAt.getTime())
            : null,
          typing_started_at: typingStartedAt?.toISOString() ?? null,
          typing_ended_at: submittedAt.toISOString(),
          typing_duration_ms: typingStartedAt
            ? Math.max(0, submittedAt.getTime() - typingStartedAt.getTime())
            : null,
          typing_duration_method: typingStartedAt
            ? "elapsed_first_input_to_submit"
            : null,
          edit_count: formativeEditCountRef.current,
          backspace_count: formativeBackspaceCountRef.current,
          paste_event_count: formativePasteCountRef.current,
          paste_character_count:
            formativePasteCharacterCountRef.current
        }
      });
      setState((current) =>
        current
          ? { ...current, formative_conversation: nextConversation }
          : current
      );
      setFormativeConversationDraft("");
      formativeMessageIdRef.current = null;
      resetFormativeInputTelemetry();
    } catch (errorValue) {
      handleError(errorValue, "message", () => {
        void handleSendFormativeConversationMessage();
      });
    } finally {
      setIsAwaitingFormativeTutorResponse(false);
      setIsBusy(false);
    }
  }

  async function handleRetryFormativeConversationOpening() {
    const conversation = state?.formative_conversation;
    if (!state || !conversation?.can_retry_opening || isBusy) {
      return;
    }
    setIsBusy(true);
    setIsRetryingOpening(true);
    setError(null);
    setFailedAction(null);
    try {
      const nextConversation = await retryFormativeConversationOpening({
        sessionPublicId: state.session_public_id,
        conversationPublicId: conversation.conversation_public_id
      });
      setState((current) =>
        current
          ? { ...current, formative_conversation: nextConversation }
          : current
      );
    } catch (errorValue) {
      handleError(errorValue, "learning conversation", () => {
        void handleRetryFormativeConversationOpening();
      });
      setFailedAction(null);
    } finally {
      setIsRetryingOpening(false);
      setIsBusy(false);
    }
  }

  async function handleRetryFormativeConversationResponse() {
    const conversation = state?.formative_conversation;
    const response = conversation?.assistant_response;
    if (
      !state ||
      !conversation ||
      !response?.can_retry ||
      isBusy
    ) {
      return;
    }
    setIsBusy(true);
    setIsAwaitingFormativeTutorResponse(true);
    setError(null);
    setFailedAction(null);
    try {
      const nextConversation =
        await retryFormativeConversationResponse({
          sessionPublicId: state.session_public_id,
          conversationPublicId:
            conversation.conversation_public_id,
          receiptPublicId: response.receipt_public_id
        });
      setState((current) =>
        current
          ? { ...current, formative_conversation: nextConversation }
          : current
      );
    } catch (errorValue) {
      handleError(errorValue, "tutor response", () => {
        void handleRetryFormativeConversationResponse();
      });
    } finally {
      setIsAwaitingFormativeTutorResponse(false);
      setIsBusy(false);
    }
  }

  async function handleFormativeConversationLifecycle(
    action: "pause" | "resume" | "end"
  ) {
    if (!state || isBusy) {
      return;
    }
    setIsBusy(true);
    setError(null);
    setFailedAction(null);
    try {
      const nextConversation = await updateFormativeConversationLifecycle({
        sessionPublicId: state.session_public_id,
        action
      });
      setState((current) =>
        current
          ? { ...current, formative_conversation: nextConversation }
          : current
      );
    } catch (errorValue) {
      handleError(errorValue, action, () => {
        void handleFormativeConversationLifecycle(action);
      });
    } finally {
      setIsBusy(false);
    }
  }

  async function runAction(label: string, action: () => Promise<StudentSessionState>) {
    setIsBusy(true);
    setError(null);
    setFailedAction(null);

    try {
      const nextState = await action();
      setState(nextState);
      setActivityRuntime(nextState.activity_runtime ?? null);
      await refreshSecondaryData(nextState.session_public_id);
    } catch (errorValue) {
      handleError(errorValue, label, () => {
        void runAction(label, action);
      });
    } finally {
      setIsBusy(false);
    }
  }

  useEffect(() => {
    let mounted = true;

    async function load() {
      setIsLoading(true);
      setError(null);
      setFailedAction(null);

      try {
        let nextState: StudentSessionState;

        if (resolvedInitialSessionPublicId) {
          nextState = await fetchSessionState(resolvedInitialSessionPublicId);
        } else if (assessmentPublicId) {
          const started = await startAssessmentSession(assessmentPublicId);
          nextState =
            started.state ??
            await fetchSessionState(started.session.session_public_id);
        } else {
          throw {
            code: "missing_session",
            message: "No assessment session was provided.",
            status: 400
          } satisfies StructuredStudentApiError;
        }

        if (!mounted) {
          return;
        }

        setState(nextState);
        setActivityRuntime(nextState.activity_runtime ?? null);
        await refreshSecondaryData(nextState.session_public_id);
      } catch (errorValue) {
        if (mounted) {
          handleError(errorValue, "Load assessment", () => {
            void load();
          });
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    }

    void load();

    return () => {
      mounted = false;
    };
  }, [assessmentPublicId, readOnlyReview, resolvedInitialSessionPublicId]);

  useEffect(() => {
    if (readOnlyReview) {
      return;
    }
    scrollRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [
    isCompletingPackage,
    isAwaitingFormativeTutorResponse,
    readOnlyReview,
    transcript.length,
    state?.assessment_state,
    state?.current_item?.item_public_id
  ]);

  useEffect(() => {
    setReasoningDraft("");
    setTemptingReasonDraft("");
    setInFlowEditDraft(null);
  }, [state?.assessment_state, state?.current_item?.item_public_id]);

  useEffect(() => {
    if (state?.next_step !== "formative_activity") {
      setFormativeActivityDraft("");
    }
  }, [state?.next_step]);

  useEffect(() => {
    setActivityRuntime(state?.activity_runtime ?? null);
  }, [state?.activity_runtime]);

  useEffect(() => {
    if (
      readOnlyReview ||
      !state ||
      state.assessment_state !== "FORMATIVE_ACTIVITY" ||
      state.formative_conversation
    ) {
      return;
    }

    const activityAttemptPublicId =
      activityRuntime?.activity_attempt_public_id ??
      state.activity_runtime?.activity_attempt_public_id ??
      null;
    const contentId = [
      state.session_public_id,
      state.current_concept_unit?.concept_unit_public_id ?? "no_concept",
      activityAttemptPublicId ?? "no_activity",
      PACKAGE_FEEDBACK_PRESENTER_VERSION
    ].join(":");
    const basePayload = {
      display_event_contract_version: DISPLAY_EVENT_CONTRACT_VERSION,
      presenter_version: PACKAGE_FEEDBACK_PRESENTER_VERSION,
      rendered_state: state.assessment_state,
      canonical_runtime_state: state.canonical_runtime_state ?? state.assessment_state,
      content_id: contentId,
      activity_attempt_public_id: activityAttemptPublicId,
      next_step: state.next_step
    };
    const eventTypes: Array<
      | "package_results_shown"
      | "item_correctness_status_shown"
      | "profile_feedback_shown"
      | "next_interaction_shown"
      | "distractor_activity_shown"
      | "formative_activity_shown"
      | "student_communication_shown"
      | "topic_dialogue_prompt_shown"
      | "topic_dialogue_response_shown"
      | "progression_choices_shown"
    > = [
      "package_results_shown",
      "item_correctness_status_shown",
      "profile_feedback_shown",
      "next_interaction_shown",
      "distractor_activity_shown",
      "formative_activity_shown",
      "student_communication_shown",
      ...(state.activity_runtime?.topic_dialogue?.state === "awaiting_response"
        ? ["topic_dialogue_prompt_shown" as const]
        : []),
      ...(state.activity_runtime?.topic_dialogue?.state === "ready_to_advance" ||
      state.activity_runtime?.topic_dialogue?.state === "final_support"
        ? ["progression_choices_shown" as const]
        : [])
    ];
    const unsent = eventTypes.filter((eventType) => {
      const key = `${eventType}:${contentId}`;
      if (displayAcknowledgementRef.current.has(key)) {
        return false;
      }
      displayAcknowledgementRef.current.add(key);
      return true;
    });

    if (unsent.length === 0) {
      return;
    }

    void sendProcessEvents(
      state.session_public_id,
      unsent.map((eventType) => ({
        event_type: eventType,
        event_category:
          eventType === "package_results_shown" || eventType === "item_correctness_status_shown"
            ? "package_results"
            : eventType === "profile_feedback_shown"
              ? "package_feedback"
              : eventType.startsWith("topic_dialogue") || eventType === "progression_choices_shown"
                ? "topic_dialogue"
              : "formative_routing",
        client_occurred_at: new Date().toISOString(),
        payload: basePayload
      }))
    ).catch(() => undefined);
  }, [
    activityRuntime?.activity_attempt_public_id,
    state?.activity_runtime?.activity_attempt_public_id,
    state?.assessment_state,
    state?.canonical_runtime_state,
    state?.current_concept_unit?.concept_unit_public_id,
    state?.next_step,
    readOnlyReview,
    state,
    state?.session_public_id
  ]);

  useEffect(() => {
    if (state?.assessment_state !== "REVISION") {
      setRevisionDraft("");
    }
  }, [state?.assessment_state]);

  useEffect(() => {
    if (state?.assessment_state !== "PACKAGE_REVIEW") {
      setEditingReviewItemId(null);
      setReviewEditDraft(null);
    }
  }, [state?.assessment_state]);

  const currentItem = state?.current_item ?? null;

  function handleBeginConceptUnit() {
    if (!state?.current_concept_unit) {
      return;
    }

    void runAction("Start questions", () =>
      beginConceptUnit(state.session_public_id, state.current_concept_unit?.concept_unit_public_id ?? "")
    );
  }

  function handleOption(label: string) {
    if (!state?.current_item) {
      return;
    }

    void runAction("Record answer", () =>
      saveOption({
        sessionPublicId: state.session_public_id,
        itemPublicId: state.current_item?.item_public_id ?? "",
        selectedOption: label
      })
    );
  }

  function handleReasoning() {
    const trimmed = reasoningDraft.trim();

    if (!state?.current_item || !trimmed) {
      return;
    }

    void runAction("Record reason", () =>
      saveReasoning({
        sessionPublicId: state.session_public_id,
        itemPublicId: state.current_item?.item_public_id ?? "",
        reasoningText: trimmed
      })
    );
  }

  function handleConfidence(confidence: ConfidenceRating) {
    if (!state?.current_item) {
      return;
    }

    void runAction("Record confidence", () =>
      saveConfidence({
        sessionPublicId: state.session_public_id,
        itemPublicId: state.current_item?.item_public_id ?? "",
        confidenceRating: confidence
      })
    );
  }

  function handleTemptingOption(label: string) {
    if (!state?.current_item) {
      return;
    }

    void runAction("Record tempting option", () =>
      saveTemptingOption({
        sessionPublicId: state.session_public_id,
        itemPublicId: state.current_item?.item_public_id ?? "",
        temptingOption: label
      })
    );
  }

  function handleNoTemptingOption() {
    if (!state?.current_item) {
      return;
    }

    void runAction("Record no tempting option", () =>
      saveTemptingOption({
        sessionPublicId: state.session_public_id,
        itemPublicId: state.current_item?.item_public_id ?? "",
        noTemptingOption: true
      })
    );
  }

  function handleTemptingReason() {
    const trimmed = temptingReasonDraft.trim();

    if (!state?.current_item || !trimmed) {
      return;
    }

    void runAction("Record tempting reason", () =>
      saveTemptingOption({
        sessionPublicId: state.session_public_id,
        itemPublicId: state.current_item?.item_public_id ?? "",
        temptingOptionReason: trimmed
      })
    );
  }

  function handleStartInFlowEdit(field: InFlowEditField) {
    if (!state?.current_item) {
      return;
    }

    setInFlowEditDraft(buildInFlowEditDraft(state.current_item, field));
  }

  function handleCancelInFlowEdit() {
    setInFlowEditDraft(null);
  }

  function handleSaveInFlowEdit() {
    if (!state?.current_item || !inFlowEditDraft) {
      return;
    }

    const draft = inFlowEditDraft;

    if (draft.field === "answer" && !draft.selectedOption) {
      return;
    }

    if (draft.field === "reasoning" && !draft.reasoningText.trim()) {
      return;
    }

    if (draft.field === "confidence" && !draft.confidenceRating) {
      return;
    }

    if (draft.field === "tempting" && !draft.noTemptingOption && !draft.temptingOption) {
      return;
    }

    void runAction("Save response edit", async () => {
      const nextState = await updateInFlowItem({
        sessionPublicId: state.session_public_id,
        itemPublicId: state.current_item?.item_public_id ?? "",
        selectedOption: draft.field === "answer" ? draft.selectedOption : undefined,
        reasoningText: draft.field === "reasoning" ? draft.reasoningText.trim() : undefined,
        confidenceRating:
          draft.field === "confidence" && draft.confidenceRating
            ? (draft.confidenceRating as ConfidenceRating)
            : undefined,
        noTemptingOption: draft.field === "tempting" ? draft.noTemptingOption : undefined,
        temptingOption:
          draft.field === "tempting"
            ? draft.noTemptingOption
              ? null
              : draft.temptingOption
            : undefined,
        temptingOptionReason:
          draft.field === "tempting"
            ? draft.noTemptingOption
              ? null
              : draft.temptingOptionReason.trim()
            : undefined
      });

      setInFlowEditDraft(null);
      return nextState;
    });
  }

  function handleCompletePackage() {
    if (!state?.current_concept_unit) {
      return;
    }

    const sessionPublicId = state.session_public_id;
    const conceptUnitPublicId = state.current_concept_unit.concept_unit_public_id;

    void (async () => {
      setIsBusy(true);
      setIsCompletingPackage(true);
      setError(null);
      setFailedAction(null);

      try {
        const result = await completeInitialConceptUnit({
          sessionPublicId,
          conceptUnitPublicId
        });
        setState(result.state);
        setActivityRuntime(result.state.activity_runtime ?? null);
        await refreshSecondaryData(result.state.session_public_id);
      } catch (errorValue) {
        try {
          const canonicalState = await fetchSessionState(sessionPublicId);
          const recovered =
            canonicalState.assessment_state !== "PACKAGE_REVIEW" &&
            (
              canonicalState.assessment_state === "FORMATIVE_ACTIVITY" ||
              canonicalState.next_step === "formative_activity" ||
              canonicalState.next_step === "formative_conversation" ||
              Boolean(canonicalState.formative_conversation) ||
              Boolean(canonicalState.package_results) ||
              Boolean(canonicalState.activity_runtime?.activity_attempt_public_id)
            );

          if (recovered) {
            setState(canonicalState);
            setActivityRuntime(canonicalState.activity_runtime ?? null);
            await refreshSecondaryData(canonicalState.session_public_id);
            return;
          }
        } catch {
          // Fall through to the ordinary retry UI when canonical state cannot be read.
        }

        handleError(errorValue, "Finish review", () => {
          void handleCompletePackage();
        });
      } finally {
        setIsCompletingPackage(false);
        setIsBusy(false);
      }
    })();
  }

  function handleStartReviewEdit(item: StudentReviewItem) {
    setEditingReviewItemId(item.item_public_id);
    setReviewEditDraft(buildReviewEditDraft(item));
  }

  function handleCancelReviewEdit() {
    setEditingReviewItemId(null);
    setReviewEditDraft(null);
  }

  function handleSaveReviewEdit() {
    if (!state || !reviewEditDraft || !reviewEditDraftIsComplete(reviewEditDraft)) {
      return;
    }

    const draft = reviewEditDraft;

    void runAction("Save response edits", async () => {
      const nextState = await updatePackageReviewItem({
        sessionPublicId: state.session_public_id,
        itemPublicId: draft.itemPublicId,
        selectedOption: draft.selectedOption,
        reasoningText: draft.reasoningText.trim(),
        confidenceRating: draft.confidenceRating as ConfidenceRating,
        noTemptingOption: draft.noTemptingOption,
        temptingOption: draft.noTemptingOption ? null : draft.temptingOption,
        temptingOptionReason: draft.noTemptingOption ? null : draft.temptingOptionReason.trim()
      });

      setEditingReviewItemId(null);
      setReviewEditDraft(null);

      return nextState;
    });
  }

  async function handleExit() {
    if (!activeSessionPublicId) {
      return;
    }

    setIsBusy(true);
    setError(null);
    setFailedAction(null);

    try {
      await exitSession(activeSessionPublicId);
      router.push("/student/assessment");
    } catch (errorValue) {
      handleError(errorValue, "Pause assessment", () => {
        void handleExit();
      });
    } finally {
      setIsBusy(false);
    }
  }

  async function handleEndAttempt() {
    if (!activeSessionPublicId) {
      return;
    }

    const confirmed = window.confirm(
      "End this attempt?\n\nYou can end this attempt now. You can come back only if your instructor allows another attempt."
    );

    if (!confirmed) {
      return;
    }

    setIsBusy(true);
    setError(null);
    setFailedAction(null);

    try {
      await endAssessmentAttempt(activeSessionPublicId);
      router.push("/student/assessment");
    } catch (errorValue) {
      handleError(errorValue, "End attempt", () => {
        void handleEndAttempt();
      });
    } finally {
      setIsBusy(false);
    }
  }

  async function handleSendFollowup() {
    const trimmed = followupDraft.trim();

    if (!state || !trimmed) {
      return;
    }

    if (state.followup && trimmed.length > state.followup.message_max_chars) {
      setError({
        code: "message_too_long",
        message: `Keep the message under ${state.followup.message_max_chars} characters.`,
        status: 400
      });
      return;
    }

    setIsBusy(true);
    setError(null);
    setFailedAction(null);

    try {
      const result = await sendFollowupMessage({
        sessionPublicId: state.session_public_id,
        message: trimmed,
        clientMessageId: newClientActionId("followup-message")
      });
      setFollowupDraft("");
      const nextState = await fetchSessionState(result.state.session_public_id);
      setState(nextState);
      setActivityRuntime(nextState.activity_runtime ?? null);
      await refreshSecondaryData(nextState.session_public_id);
    } catch (errorValue) {
      handleError(errorValue, "Send follow-up response", () => {
        void handleSendFollowup();
      });
    } finally {
      setIsBusy(false);
    }
  }

  async function handleStartActivityRuntime() {
    if (!state) {
      return;
    }

    setIsBusy(true);
    setError(null);
    setFailedAction(null);

    try {
      const nextActivityRuntime = await startStudentActivityRuntime(state.session_public_id);
      setActivityRuntime(nextActivityRuntime);
      const nextState = await fetchSessionState(state.session_public_id);
      setState(nextState);
      await refreshSecondaryData(nextState.session_public_id);
    } catch (errorValue) {
      handleError(errorValue, "Prepare activity", () => {
        void handleStartActivityRuntime();
      });
    } finally {
      setIsBusy(false);
    }
  }

  async function handleChooseActivityRuntimeAction(choiceState:
    | "skip_activity_to_transfer"
    | "skip_activity_to_next_concept"
    | "finish_assessment"
  ) {
    if (!state) {
      return;
    }

    setIsBusy(true);
    setError(null);
    setFailedAction(null);

    try {
      const nextActivityRuntime = await chooseStudentActivityRuntimeAction({
        sessionPublicId: state.session_public_id,
        activityAttemptPublicId: activityRuntime?.activity_attempt_public_id ?? null,
        choiceState
      });
      setActivityRuntime(nextActivityRuntime);
      const nextState = await fetchSessionState(state.session_public_id);
      setState(nextState);
      await refreshSecondaryData(nextState.session_public_id);
      if (choiceState === "finish_assessment") {
        setEndAssessmentDialogOpen(false);
      }
    } catch (errorValue) {
      const label = choiceState === "finish_assessment"
        ? "End assessment"
        : choiceState === "skip_activity_to_transfer"
          ? "Continue to transfer item"
          : choiceState === "skip_activity_to_next_concept"
            ? "Continue to next concept"
            : "Continue activity";
      handleError(errorValue, label, () => {
        void handleChooseActivityRuntimeAction(choiceState);
      });
    } finally {
      setIsBusy(false);
    }
  }

  async function handleSendFormativeActivityResponse() {
    const trimmed = formativeActivityDraft.trim();

    if (!state || !trimmed) {
      return;
    }

    const maxChars = activityRuntime?.message_max_chars ?? 5000;

    if (trimmed.length > maxChars) {
      setError({
        code: "message_too_long",
        message: `Keep the message under ${maxChars} characters.`,
        status: 400
      });
      return;
    }

    setIsBusy(true);
    setError(null);
    setFailedAction(null);

    try {
      if (activityRuntime?.topic_dialogue?.state === "awaiting_response") {
        const nextActivityRuntime = await submitTopicDialogueResponse({
          sessionPublicId: state.session_public_id,
          dialoguePublicId: activityRuntime.topic_dialogue.dialogue_public_id,
          studentMessage: trimmed,
          clientOperationId: newClientActionId("topic-dialogue")
        });
        setFormativeActivityDraft("");
        setActivityRuntime(nextActivityRuntime);
        const nextState = await fetchSessionState(state.session_public_id);
        setState(nextState);
        await refreshSecondaryData(nextState.session_public_id);
        return;
      }

      if (!activityRuntime?.activity_attempt_public_id) {
        throw {
          code: "activity_not_ready",
          message: "Prepare the activity before sending a response.",
          status: 409
        } satisfies StructuredStudentApiError;
      }
      const nextActivityRuntime = await submitStudentActivityRuntimeResponse({
        sessionPublicId: state.session_public_id,
        activityAttemptPublicId: activityRuntime.activity_attempt_public_id,
        responseText: trimmed,
        clientMessageId: newClientActionId("formative-activity")
      });
      setFormativeActivityDraft("");
      setActivityRuntime(nextActivityRuntime);
      const nextState = await fetchSessionState(state.session_public_id);
      setState(nextState);
      await refreshSecondaryData(nextState.session_public_id);
    } catch (errorValue) {
      handleError(errorValue, "Send activity response", () => {
        void handleSendFormativeActivityResponse();
      });
    } finally {
      setIsBusy(false);
    }
  }

  async function handleSendRevision() {
    const trimmed = revisionDraft.trim();

    if (!state || !trimmed) {
      return;
    }

    const maxChars = state.followup?.message_max_chars ?? 5000;

    if (trimmed.length > maxChars) {
      setError({
        code: "message_too_long",
        message: `Keep the revision under ${maxChars} characters.`,
        status: 400
      });
      return;
    }

    setIsBusy(true);
    setError(null);
    setFailedAction(null);

    try {
      const result = await sendRevisionResponse({
        sessionPublicId: state.session_public_id,
        message: trimmed,
        clientMessageId: newClientActionId("revision")
      });
      setRevisionDraft("");
      setState(result.state);
      setActivityRuntime(result.state.activity_runtime ?? null);
      await refreshSecondaryData(result.state.session_public_id);
    } catch (errorValue) {
      handleError(errorValue, "Send revision", () => {
        void handleSendRevision();
      });
    } finally {
      setIsBusy(false);
    }
  }

  async function handleNextChoice(choice: "move_next" | "try_another") {
    if (!state) {
      return;
    }

    setIsBusy(true);
    setError(null);
    setFailedAction(null);

    try {
      const result = await selectNextChoice({
        sessionPublicId: state.session_public_id,
        choice,
        clientActionId: newClientActionId(`next-choice-${choice}`)
      });
      setState(result.state);
      setActivityRuntime(result.state.activity_runtime ?? null);
      await refreshSecondaryData(result.state.session_public_id);
    } catch (errorValue) {
      handleError(errorValue, "Choose next step", () => {
        void handleNextChoice(choice);
      });
    } finally {
      setIsBusy(false);
    }
  }

  function handleStopFollowup() {
    if (!state) {
      return;
    }

    void runAction("Pause follow-up", async () => {
      const result = await stopFollowup(state.session_public_id);
      return fetchSessionState(result.state.session_public_id);
    });
  }

  async function handleRequestProgression() {
    if (!state) {
      return;
    }

    setIsBusy(true);
    setError(null);
    setFailedAction(null);

    try {
      await requestProgression(state.session_public_id);
      const nextState = await fetchSessionState(state.session_public_id);
      setState(nextState);
      setActivityRuntime(nextState.activity_runtime ?? null);
      await refreshSecondaryData(nextState.session_public_id);
    } catch (errorValue) {
      handleError(errorValue, "Show next choice", () => {
        void handleRequestProgression();
      });
    } finally {
      setIsBusy(false);
    }
  }

  async function handleProgressionChoice(
    choice:
      | "continue_current_concept"
      | "next_concept"
      | "stay_in_final_concept"
      | "complete_assessment"
  ) {
    const progressionPublicId = state?.progression?.progression_public_id;

    if (!state || !progressionPublicId) {
      return;
    }

    setIsBusy(true);
    setError(null);
    setFailedAction(null);

    try {
      await chooseProgression({
        sessionPublicId: state.session_public_id,
        progressionPublicId,
        choice
      });
      const nextState = await fetchSessionState(state.session_public_id);
      setState(nextState);
      setActivityRuntime(nextState.activity_runtime ?? null);
      await refreshSecondaryData(nextState.session_public_id);
    } catch (errorValue) {
      handleError(errorValue, "Choose next step", () => {
        void handleProgressionChoice(choice);
      });
    } finally {
      setIsBusy(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-accent" aria-hidden="true" />
        <span className="ml-3 text-sm text-muted">Loading assessment...</span>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="mx-auto max-w-2xl rounded-lg border border-line bg-white p-6 shadow-soft">
        <ErrorNotice error={error} />
        {failedAction ? (
          <button
            className="mt-4 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white"
            data-testid="retry-save-action"
            onClick={failedAction.retry}
            type="button"
          >
            Retry {failedAction.label}
          </button>
        ) : null}
      </div>
    );
  }

  const isReviewablePastAttempt =
    readOnlyReview && state.attempt_lifecycle?.terminal === true;
  const activePrompt = readOnlyReview ? null : state.formative_conversation ? (
    <FormativeConversationControls
      conversation={state.formative_conversation}
      draft={formativeConversationDraft}
      isAwaitingTutorResponse={isAwaitingFormativeTutorResponse}
      isBusy={isBusy}
      isRetryingOpening={isRetryingOpening}
      onBackspace={() => {
        formativeBackspaceCountRef.current += 1;
      }}
      onChange={handleFormativeConversationDraft}
      onEnd={() => setEndConversationDialogOpen(true)}
      onPaste={(pastedCharacterCount) => {
        formativePasteCountRef.current += 1;
        formativePasteCharacterCountRef.current +=
          pastedCharacterCount;
      }}
      onPause={() => void handleFormativeConversationLifecycle("pause")}
      onRetryOpening={() => void handleRetryFormativeConversationOpening()}
      onRetryResponse={() => void handleRetryFormativeConversationResponse()}
      onReviewAnswers={
        state.package_results
          ? () =>
              packageResultsRef.current?.scrollIntoView({
                behavior: "smooth",
                block: "start"
              })
          : undefined
      }
      onResume={() => void handleFormativeConversationLifecycle("resume")}
      onSend={() => void handleSendFormativeConversationMessage()}
    />
  ) : activeItemPrompt({
    state,
    activityRuntime,
    review,
    isBusy,
    isCompletingPackage,
    reasoningDraft,
    temptingReasonDraft,
    followupDraft,
    formativeActivityDraft,
    revisionDraft,
    inFlowEditDraft,
    editingReviewItemId,
    reviewEditDraft,
    setReasoningDraft,
    setTemptingReasonDraft,
    setFollowupDraft,
    setFormativeActivityDraft,
    setRevisionDraft,
    setInFlowEditDraft,
    setReviewEditDraft,
    onBeginConceptUnit: handleBeginConceptUnit,
    onCancelReviewEdit: handleCancelReviewEdit,
    onSelectOption: handleOption,
    onSendReasoning: handleReasoning,
    onSelectConfidence: handleConfidence,
    onSelectTemptingOption: handleTemptingOption,
    onNoTemptingOption: handleNoTemptingOption,
    onSendTemptingReason: handleTemptingReason,
    onStartInFlowEdit: handleStartInFlowEdit,
    onCancelInFlowEdit: handleCancelInFlowEdit,
    onSaveInFlowEdit: handleSaveInFlowEdit,
    onContinuePackage: handleCompletePackage,
    onSaveReviewEdit: handleSaveReviewEdit,
    onStartReviewEdit: handleStartReviewEdit,
    onChooseActivityRuntimeAction: handleChooseActivityRuntimeAction,
    onRequestEndAssessment: () => setEndAssessmentDialogOpen(true),
    onSendFormativeActivityResponse: handleSendFormativeActivityResponse,
    onStartActivityRuntime: handleStartActivityRuntime,
    onSendRevision: handleSendRevision,
    onNextChoice: handleNextChoice,
    onSendFollowup: handleSendFollowup,
    onStopFollowup: handleStopFollowup,
    onRequestProgression: handleRequestProgression,
    onProgressionChoice: handleProgressionChoice
  });
  const formativeTurnIds = new Set(
    state.formative_conversation?.transcript.map((turn) => turn.turn_id) ?? []
  );
  const visibleTranscript = transcript.filter(
    (entry) =>
      !formativeTurnIds.has(entry.turn_id) &&
      !shouldHideActiveAgentTranscriptEntry(entry, state)
  );
  const showPackageResults =
    (isReviewablePastAttempt || shouldShowLearningProfile(state)) &&
    Boolean(state.package_results);
  const {
    beforePackageResults,
    afterPackageResults
  } = splitTranscriptForPackageResults(visibleTranscript, showPackageResults);

  return (
    <StudentAssessmentChatShell
      isBusy={isBusy}
      onBackToAssessments={() => router.push("/student/assessment")}
      onEndAttempt={() => void handleEndAttempt()}
      onExit={() => void handleExit()}
      readOnlyReview={readOnlyReview}
      state={state}
    >
      <div className="flex flex-1">
        <ChatTranscript>
          <ErrorNotice error={error} />
          {readOnlyReview ? (
            <AgentMessage>
              <p className="font-medium text-ink">
                {isReviewablePastAttempt
                  ? "Past attempt review"
                  : "This attempt is not available as a past attempt."}
              </p>
              <p className="mt-2 text-sm leading-6 text-muted">
                {isReviewablePastAttempt
                  ? "This is a read-only view. You can look back through your answers and learning conversation."
                  : "Return to assessments to resume or manage this attempt."}
              </p>
            </AgentMessage>
          ) : null}
          {!readOnlyReview && failedAction ? (
            <button
              className="w-fit rounded-full border border-line bg-white px-4 py-2 text-sm font-semibold text-ink hover:border-accent"
              data-testid="retry-save-action"
              disabled={isBusy}
              onClick={failedAction.retry}
              type="button"
            >
              Retry {failedAction.label}
            </button>
          ) : null}
          {beforePackageResults.map((entry) => (
            <ChatBubble entry={entry} key={entry.turn_id} />
          ))}
          {showPackageResults ? (
            <div ref={packageResultsRef}>
              <PackageResultsChatCard packageResults={state.package_results} />
            </div>
          ) : null}
          {afterPackageResults.map((entry) => (
            <ChatBubble entry={entry} key={entry.turn_id} />
          ))}
          {state.formative_conversation?.transcript.map((turn) => (
            <FormativeConversationBubble key={turn.turn_id} turn={turn} />
          ))}
          {activePrompt}
          {!readOnlyReview &&
          isBusy &&
          !isCompletingPackage &&
          !isRetryingOpening &&
          !isAwaitingFormativeTutorResponse ? (
            <div className="flex justify-start">
              <div className="rounded-full border border-line bg-white px-4 py-2 text-sm text-muted shadow-sm">
                <Loader2 className="mr-2 inline h-4 w-4 animate-spin" aria-hidden="true" />
                Working...
              </div>
            </div>
          ) : null}
          <div ref={scrollRef} />
        </ChatTranscript>
      </div>
      {!readOnlyReview && endConversationDialogOpen ? (
        <div
          aria-labelledby="end-conversation-dialog-title"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/35 px-4"
          data-testid="end-conversation-dialog"
          role="dialog"
        >
          <div className="w-full max-w-md rounded-2xl border border-line bg-white p-5 shadow-xl">
            <h2
              className="text-lg font-semibold text-ink"
              id="end-conversation-dialog-title"
            >
              End the learning conversation?
            </h2>
            <p className="mt-3 text-sm leading-6 text-muted">
              You will not be able to send more messages here. This does not
              end the assessment attempt.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                className="rounded-full border border-line bg-white px-4 py-2 text-sm font-semibold text-ink hover:border-accent disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isBusy}
                onClick={() => setEndConversationDialogOpen(false)}
                type="button"
              >
                Keep talking
              </button>
              <button
                className="rounded-full bg-[#c99700] px-4 py-2 text-sm font-semibold text-ink hover:bg-[#d6aa1c] disabled:cursor-not-allowed disabled:opacity-60"
                data-testid="confirm-end-conversation"
                disabled={isBusy}
                onClick={() => {
                  setEndConversationDialogOpen(false);
                  void handleFormativeConversationLifecycle("end");
                }}
                type="button"
              >
                End conversation
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {!readOnlyReview && endAssessmentDialogOpen ? (
        <div
          aria-labelledby="end-assessment-dialog-title"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/35 px-4"
          data-testid="end-assessment-dialog"
          role="dialog"
        >
          <div className="w-full max-w-md rounded-2xl border border-line bg-white p-5 shadow-xl">
            <h2 id="end-assessment-dialog-title" className="text-lg font-semibold text-ink">
              End the assessment?
            </h2>
            <p className="mt-3 text-sm leading-6 text-muted">
              This will end the current assessment conversation.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                className="rounded-full border border-line bg-white px-4 py-2 text-sm font-semibold text-ink hover:border-accent disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isBusy}
                onClick={() => setEndAssessmentDialogOpen(false)}
                type="button"
              >
                Keep working
              </button>
              <button
                className="rounded-full bg-[#c99700] px-4 py-2 text-sm font-semibold text-ink hover:bg-[#d6aa1c] disabled:cursor-not-allowed disabled:opacity-60"
                data-testid="confirm-end-assessment"
                disabled={isBusy}
                onClick={() => void handleChooseActivityRuntimeAction("finish_assessment")}
                type="button"
              >
                End assessment
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {!readOnlyReview && currentItem ? (
        <p className="sr-only" aria-live="polite">
          Current question {currentItem.item_order}
        </p>
      ) : null}
    </StudentAssessmentChatShell>
  );
}
