"use client";

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Check,
  ChevronRight,
  HelpCircle,
  Loader2,
  LogOut,
  MessageSquareText,
  Send,
  Square
} from "lucide-react";
import { buildSkipConfirmationFrame, buildStudentConversationFrame } from "@/lib/student-assessment-ui/presenter";
import type {
  ConfidenceRating,
  MissingEvidenceField,
  StructuredStudentApiError,
  StudentConversationFrame,
  StudentReviewResponse,
  StudentSafeItem,
  StudentSessionState,
  StudentTranscriptEntry
} from "@/lib/student-assessment-ui/types";
import {
  beginConceptUnit,
  chooseProgression,
  completeInitialConceptUnit,
  exitSession,
  fetchSessionState,
  fetchStudentReview,
  fetchStudentTranscript,
  newClientActionId,
  saveConfidence,
  saveOption,
  saveReasoning,
  sendInitialMessage,
  sendFollowupMessage,
  requestProgression,
  startAssessmentSession,
  stopFollowup,
  submitItem
} from "./api";
import { useStudentProcessEvents } from "./process-events";

const MAX_REASONING_LENGTH = 5000;

type InitialFlowStage =
  | "item_intro"
  | "option_selection"
  | "reasoning_prompt"
  | "confidence_prompt"
  | "review_before_submit"
  | "submitted"
  | "transition_next_item"
  | "initial_assessment_complete"
  | "followup_active";

type FailedAction = {
  label: string;
  retry: () => void;
};

function initialFlowStage(frame: StudentConversationFrame): InitialFlowStage {
  if (frame.interaction_type === "present_item") {
    return "option_selection";
  }

  if (frame.interaction_type === "request_reasoning") {
    return "reasoning_prompt";
  }

  if (frame.interaction_type === "request_confidence") {
    return "confidence_prompt";
  }

  if (frame.interaction_type === "item_completed") {
    return "review_before_submit";
  }

  if (frame.interaction_type === "concept_unit_completed") {
    return "initial_assessment_complete";
  }

  if (frame.interaction_type === "followup_active") {
    return "followup_active";
  }

  return "item_intro";
}

function stageLabel(stage: InitialFlowStage) {
  if (stage === "option_selection") {
    return "Choose your answer";
  }

  if (stage === "reasoning_prompt") {
    return "Tell me your reasoning";
  }

  if (stage === "confidence_prompt") {
    return "How confident are you?";
  }

  if (stage === "review_before_submit") {
    return "Review your response";
  }

  if (stage === "initial_assessment_complete") {
    return "Submit this section";
  }

  if (stage === "followup_active") {
    return "Follow-up conversation";
  }

  if (stage === "submitted" || stage === "transition_next_item") {
    return "Saved";
  }

  return "Start this section";
}

function fieldLabel(field: MissingEvidenceField) {
  if (field === "answer") {
    return "answer choice";
  }

  if (field === "reasoning") {
    return "reasoning";
  }

  return "confidence";
}

function confidenceLabel(confidence: ConfidenceRating) {
  if (confidence === "low") {
    return "Low confidence";
  }

  if (confidence === "medium") {
    return "Medium confidence";
  }

  return "High confidence";
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
          <p className="font-semibold">{error.message}</p>
          <p className="mt-1 text-xs uppercase tracking-wide text-red-700">{error.code}</p>
        </div>
      </div>
    </div>
  );
}

function AssistantBubble({ frame }: { frame: StudentConversationFrame }) {
  return (
    <div className="flex justify-start">
      <div className="max-w-3xl rounded-lg rounded-bl-sm border border-line bg-white p-4 shadow-soft">
        <div className="flex gap-3">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent">
            <MessageSquareText className="h-4 w-4" aria-hidden="true" />
          </div>
          <p className="text-sm leading-6 text-ink">{frame.assistant_message}</p>
        </div>
      </div>
    </div>
  );
}

function StudentBubble({ entry }: { entry: StudentTranscriptEntry }) {
  if (entry.actor === "assistant") {
    return (
      <div className="flex justify-start">
        <div className="max-w-3xl rounded-lg rounded-bl-sm border border-line bg-white p-4 shadow-soft">
          <div className="flex gap-3">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent">
              <MessageSquareText className="h-4 w-4" aria-hidden="true" />
            </div>
            <p className="whitespace-pre-wrap text-sm leading-6 text-ink">{entry.message_text}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-end">
      <div className="max-w-2xl rounded-lg rounded-br-sm bg-[#23312d] p-4 text-white">
        <p className="whitespace-pre-wrap text-sm leading-6">{entry.message_text}</p>
      </div>
    </div>
  );
}

function ItemPrompt({ item }: { item: StudentSafeItem }) {
  return (
    <section className="rounded-lg border border-line bg-[#fbfcfa] p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">
        Question {item.item_order}
      </p>
      <p className="mt-2 whitespace-pre-wrap text-base leading-7 text-ink">{item.item_stem}</p>
    </section>
  );
}

function OptionButtons({
  item,
  disabled,
  onSelect,
  testIdPrefix = "option"
}: {
  item: StudentSafeItem;
  disabled: boolean;
  onSelect: (label: string) => void;
  testIdPrefix?: string;
}) {
  return (
    <div className="grid gap-2">
      {item.options.map((option) => {
        const selected = item.existing_selected_option === option.label;

        return (
          <button
            aria-pressed={selected}
            className={`flex min-h-14 items-start gap-3 rounded-md border px-4 py-3 text-left text-sm transition focus:outline-none focus:ring-2 focus:ring-accent-soft disabled:cursor-not-allowed disabled:opacity-60 ${
              selected
                ? "border-accent bg-accent-soft text-ink shadow-sm"
                : "border-line bg-white text-ink hover:border-accent"
            }`}
            data-testid={`${testIdPrefix}-${item.item_public_id}-${option.label}`}
            disabled={disabled}
            key={option.label}
            onClick={() => onSelect(option.label)}
            type="button"
          >
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-current text-xs font-semibold">
              {option.label}
            </span>
            <span className="flex-1 leading-6">{option.text}</span>
            {selected ? (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-white px-2 py-1 text-xs font-semibold text-accent">
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
                Selected
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function ConfidenceButtons({
  value,
  disabled,
  onSelect,
  testIdPrefix = "confidence"
}: {
  value: ConfidenceRating | null;
  disabled: boolean;
  onSelect: (confidence: ConfidenceRating) => void;
  testIdPrefix?: string;
}) {
  const levels: ConfidenceRating[] = ["low", "medium", "high"];

  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {levels.map((level) => {
        const selected = value === level;

        return (
          <button
            aria-pressed={selected}
            className={`min-h-12 rounded-md border px-3 py-2 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-accent-soft disabled:cursor-not-allowed disabled:opacity-60 ${
              selected
                ? "border-accent bg-accent-soft text-ink shadow-sm"
                : "border-line bg-white text-ink hover:border-accent"
            }`}
            data-testid={`${testIdPrefix}-${level}`}
            disabled={disabled}
            key={level}
            onClick={() => onSelect(level)}
            type="button"
          >
            <span className="inline-flex items-center justify-center gap-2">
              {selected ? <Check className="h-4 w-4" aria-hidden="true" /> : null}
              {confidenceLabel(level)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function HelpDisclosure() {
  return (
    <details className="rounded-lg border border-line bg-white p-3 text-sm text-muted">
      <summary className="flex cursor-pointer items-center gap-2 font-semibold text-ink">
        <HelpCircle className="h-4 w-4" aria-hidden="true" />
        Why can&apos;t I ask for help yet?
      </summary>
      <p className="mt-2 leading-6">
        This initial part is collecting your current understanding. Hints, explanations, and
        support come after these initial questions.
      </p>
    </details>
  );
}

function SaveStateNotice({
  error,
  failedAction,
  isBusy,
  statusMessage
}: {
  error: StructuredStudentApiError | null;
  failedAction: FailedAction | null;
  isBusy: boolean;
  statusMessage: string;
}) {
  if (error && failedAction) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900" role="alert">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span>Not saved. {error.message}</span>
          <button
            className="inline-flex h-9 items-center justify-center rounded-md border border-red-200 bg-white px-3 text-sm font-semibold text-red-900"
            data-testid="retry-save-action"
            onClick={failedAction.retry}
            type="button"
          >
            Retry {failedAction.label}
          </button>
        </div>
      </div>
    );
  }

  if (isBusy) {
    return (
      <p className="inline-flex items-center gap-2 rounded-md border border-line bg-white px-3 py-2 text-sm text-muted" aria-live="polite">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        Saving...
      </p>
    );
  }

  if (statusMessage) {
    return (
      <p className="inline-flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900" aria-live="polite">
        <Check className="h-4 w-4" aria-hidden="true" />
        {statusMessage}
      </p>
    );
  }

  return null;
}

function CurrentAnswerSummary({
  item,
  reasoningDraft
}: {
  item: StudentSafeItem | null;
  reasoningDraft: string;
}) {
  if (!item) {
    return null;
  }

  const selectedOption = item.existing_selected_option;
  const reasoning = reasoningDraft.trim() || item.existing_reasoning_text || "";
  const confidence = item.existing_confidence_rating;

  if (!selectedOption && !reasoning && !confidence) {
    return null;
  }

  return (
    <section className="rounded-lg border border-line bg-white p-4" data-testid="current-answer-summary">
      <h2 className="text-sm font-semibold text-ink">Your current answer</h2>
      <dl className="mt-3 grid gap-3 text-sm">
        <div>
          <dt className="font-semibold text-muted">Answer</dt>
          <dd className="mt-1 text-ink">{selectedOption ? `Option ${selectedOption}` : "Not chosen yet"}</dd>
        </div>
        <div>
          <dt className="font-semibold text-muted">Reasoning</dt>
          <dd className="mt-1 whitespace-pre-wrap text-ink">{reasoning || "Not added yet"}</dd>
        </div>
        <div>
          <dt className="font-semibold text-muted">Confidence</dt>
          <dd className="mt-1 text-ink">{confidence ? confidenceLabel(confidence) : "Not selected yet"}</dd>
        </div>
      </dl>
    </section>
  );
}

function SavedResponseList({
  currentItemPublicId,
  review
}: {
  currentItemPublicId: string | null;
  review: StudentReviewResponse | null;
}) {
  if (!review) {
    return null;
  }

  const savedItems = review.items.filter(
    (item) => item.submission_state !== "not_started" && item.item_public_id !== currentItemPublicId
  );

  if (savedItems.length === 0) {
    return null;
  }

  return (
    <details className="rounded-lg border border-line bg-white p-4">
      <summary className="cursor-pointer text-sm font-semibold text-ink">
        Saved earlier responses
      </summary>
      <div className="mt-3 space-y-3">
        {savedItems.map((item) => (
          <article className="rounded-md border border-line bg-[#fbfcfa] p-3 text-sm" key={item.item_public_id}>
            <p className="font-semibold text-ink">Question {item.item_order}</p>
            <p className="mt-1 text-muted">
              {item.existing_selected_option ? `Option ${item.existing_selected_option}` : "No option"} /{" "}
              {item.existing_confidence_rating ? confidenceLabel(item.existing_confidence_rating) : "No confidence"}
            </p>
            {item.existing_reasoning_text ? (
              <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-ink">{item.existing_reasoning_text}</p>
            ) : null}
          </article>
        ))}
      </div>
    </details>
  );
}

export function AssessmentSessionClient({ sessionPublicId }: { sessionPublicId: string }) {
  const router = useRouter();
  const [state, setState] = useState<StudentSessionState | null>(null);
  const [transcript, setTranscript] = useState<StudentTranscriptEntry[]>([]);
  const [review, setReview] = useState<StudentReviewResponse | null>(null);
  const [error, setError] = useState<StructuredStudentApiError | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isBusy, setIsBusy] = useState(false);
  const [reasoningDraft, setReasoningDraft] = useState("");
  const [initialChatDraft, setInitialChatDraft] = useState("");
  const [followupDraft, setFollowupDraft] = useState("");
  const [skipConfirmation, setSkipConfirmation] = useState<MissingEvidenceField[] | null>(null);
  const [manualStage, setManualStage] = useState<InitialFlowStage | null>(null);
  const [optimisticOptions, setOptimisticOptions] = useState<Record<string, string>>({});
  const [optimisticConfidence, setOptimisticConfidence] = useState<Record<string, ConfidenceRating>>({});
  const [failedAction, setFailedAction] = useState<FailedAction | null>(null);
  const reasoningInputRef = useRef<HTMLTextAreaElement | null>(null);

  const frame = useMemo(() => {
    if (skipConfirmation) {
      return buildSkipConfirmationFrame(skipConfirmation);
    }

    return state ? buildStudentConversationFrame(state) : null;
  }, [skipConfirmation, state]);

  useStudentProcessEvents({
    sessionPublicId,
    currentItemPublicId: state?.current_item?.item_public_id ?? null
  });

  async function refreshSecondaryData() {
    const [nextTranscript, nextReview] = await Promise.all([
      fetchStudentTranscript(sessionPublicId),
      fetchStudentReview(sessionPublicId)
    ]);
    setTranscript(nextTranscript.transcript);
    setReview(nextReview);
  }

  async function loadSession() {
    setError(null);
    setIsLoading(true);

    try {
      let nextState = await fetchSessionState(sessionPublicId);

      if (nextState.current_phase === "student_exited") {
        const resumed = await startAssessmentSession(nextState.assessment.assessment_public_id);
        nextState = resumed.state;

        if (resumed.session.session_public_id !== sessionPublicId) {
          router.replace(`/student/assessment/${resumed.session.session_public_id}`);
        }
      }

      setState(nextState);
      setReasoningDraft(nextState.current_item?.existing_reasoning_text ?? "");
      await refreshSecondaryData();
    } catch (caught) {
      const apiError = caught as StructuredStudentApiError;

      if (apiError.status === 401) {
        router.push("/student/login");
        return;
      }

      if (apiError.status === 403) {
        router.push("/student/assessment");
        return;
      }

      setError(apiError);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionPublicId]);

  useEffect(() => {
    setReasoningDraft(state?.current_item?.existing_reasoning_text ?? "");
  }, [state?.current_item?.item_public_id, state?.current_item?.existing_reasoning_text]);

  useEffect(() => {
    setManualStage(null);
    setFailedAction(null);
  }, [state?.current_item?.item_public_id]);

  async function runAction(
    action: () => Promise<StudentSessionState>,
    message: string,
    retry?: FailedAction
  ): Promise<StudentSessionState | null> {
    setError(null);
    setStatusMessage("");
    setFailedAction(null);
    setIsBusy(true);

    try {
      const nextState = await action();
      setState(nextState);
      setSkipConfirmation(null);
      setStatusMessage(message);
      await refreshSecondaryData();
      return nextState;
    } catch (caught) {
      const apiError = caught as StructuredStudentApiError;

      if (apiError.status === 401) {
        router.push("/student/login");
        return null;
      }

      setError(apiError);
      setFailedAction(retry ?? null);
      return null;
    } finally {
      setIsBusy(false);
    }
  }

  async function handleBegin() {
    if (!state?.current_concept_unit) {
      return;
    }

    await runAction(
      () =>
        beginConceptUnit(
          sessionPublicId,
          state.current_concept_unit?.concept_unit_public_id ?? ""
        ),
      "Started."
    );
  }

  async function handleOption(item: StudentSafeItem, label: string) {
    setOptimisticOptions((current) => ({ ...current, [item.item_public_id]: label }));
    const previous = item.existing_selected_option;
    const nextState = await runAction(
      () =>
        saveOption({
          sessionPublicId,
          itemPublicId: item.item_public_id,
          selectedOption: label
        }),
      "Saved.",
      {
        label: "answer",
        retry: () => void handleOption(item, label)
      }
    );

    if (nextState) {
      setManualStage("option_selection");
      return;
    }

    setOptimisticOptions((current) => {
      const next = { ...current };
      if (previous) {
        next[item.item_public_id] = previous;
      } else {
        delete next[item.item_public_id];
      }
      return next;
    });
  }

  async function handleReasoning(item: StudentSafeItem) {
    const trimmed = reasoningDraft.trim();

    if (!trimmed) {
      setError({
        code: "validation_failed",
        message: "Enter reasoning or choose Skip reasoning.",
        status: 400
      });
      return;
    }

    const nextState = await runAction(
      () =>
        saveReasoning({
          sessionPublicId,
          itemPublicId: item.item_public_id,
          reasoningText: trimmed
        }),
      "Saved.",
      {
        label: "reasoning",
        retry: () => void handleReasoning(item)
      }
    );

    if (nextState) {
      setManualStage(null);
    }
  }

  async function handleConfidence(item: StudentSafeItem, confidence: ConfidenceRating) {
    setOptimisticConfidence((current) => ({ ...current, [item.item_public_id]: confidence }));
    const previous = item.existing_confidence_rating;
    const nextState = await runAction(
      () =>
        saveConfidence({
          sessionPublicId,
          itemPublicId: item.item_public_id,
          confidenceRating: confidence
        }),
      "Saved.",
      {
        label: "confidence",
        retry: () => void handleConfidence(item, confidence)
      }
    );

    if (nextState) {
      setManualStage("confidence_prompt");
      return;
    }

    setOptimisticConfidence((current) => {
      const next = { ...current };
      if (previous) {
        next[item.item_public_id] = previous;
      } else {
        delete next[item.item_public_id];
      }
      return next;
    });
  }

  async function handleSubmit(item: StudentSafeItem) {
    const nextState = await runAction(
      async () =>
        (
          await submitItem({
            sessionPublicId,
            itemPublicId: item.item_public_id
          })
        ).state,
      "Submitted.",
      {
        label: "submit",
        retry: () => void handleSubmit(item)
      }
    );

    if (nextState) {
      setManualStage(null);
    }
  }

  async function handleSkipItem(item: StudentSafeItem) {
    if (!window.confirm("Continue without answering this item? The system will have less evidence.")) {
      return;
    }

    await runAction(
      async () =>
        (
          await submitItem({
            sessionPublicId,
            itemPublicId: item.item_public_id,
            skipItem: true
          })
        ).state,
      "Item skipped."
    );
  }

  async function handleSkipEvidence(item: StudentSafeItem, field: "reasoning" | "confidence") {
    await runAction(
      async () =>
        (
          await submitItem({
            sessionPublicId,
            itemPublicId: item.item_public_id
          })
        ).state,
      `${fieldLabel(field)} needs confirmation.`
    );
  }

  async function handleConfirmMissingSkip() {
    if (!state?.current_item || !skipConfirmation) {
      return;
    }

    await runAction(
      async () =>
        (
          await submitItem({
            sessionPublicId,
            itemPublicId: state.current_item?.item_public_id ?? "",
            confirmSkip: true
          })
        ).state,
      "Missing evidence skipped."
    );
  }

  async function handleCompleteConceptUnit() {
    if (!state?.current_concept_unit) {
      return;
    }

    await runAction(
      () =>
        completeInitialConceptUnit({
          sessionPublicId,
          conceptUnitPublicId: state.current_concept_unit?.concept_unit_public_id ?? ""
        }),
      "Initial questions submitted."
    );
  }

  async function handleExit() {
    const currentReasoning = state?.current_item?.existing_reasoning_text ?? "";

    if (reasoningDraft.trim() && reasoningDraft.trim() !== currentReasoning.trim()) {
      const shouldExit = window.confirm(
        "You have unsaved reasoning text. Exit without saving it?"
      );

      if (!shouldExit) {
        return;
      }
    }

    if (state?.next_step === "followup_active" && followupDraft.trim()) {
      const shouldExit = window.confirm(
        "You have an unsent follow-up message. Save and exit without sending it?"
      );

      if (!shouldExit) {
        return;
      }
    }

    setIsBusy(true);

    try {
      await exitSession(sessionPublicId);
      router.push("/student/assessment");
    } catch (caught) {
      setError(caught as StructuredStudentApiError);
      setIsBusy(false);
    }
  }

  async function handleSendFollowup() {
    const trimmed = followupDraft.trim();

    if (!trimmed) {
      setError({
        code: "validation_failed",
        message: "Enter a message before sending.",
        status: 400
      });
      return;
    }

    if (state?.followup && trimmed.length > state.followup.message_max_chars) {
      setError({
        code: "validation_failed",
        message: "The follow-up message is too long.",
        status: 400
      });
      return;
    }

    setError(null);
    setStatusMessage("");
    setIsBusy(true);

    try {
      const result = await sendFollowupMessage({
        sessionPublicId,
        message: trimmed,
        clientMessageId: newClientActionId("followup-message")
      });
      const nextState = await fetchSessionState(sessionPublicId);

      setState(nextState);
      setFollowupDraft("");
      setStatusMessage(
        result.message_status === "assistant_replied"
          ? "Message sent."
          : result.student_safe_message ?? "Message saved."
      );
      await refreshSecondaryData();
    } catch (caught) {
      setError(caught as StructuredStudentApiError);
    } finally {
      setIsBusy(false);
    }
  }

  async function handleSendInitialMessage() {
    const trimmed = initialChatDraft.trim();

    if (!trimmed) {
      setError({
        code: "validation_failed",
        message: "Enter a message before sending.",
        status: 400
      });
      return;
    }

    const maxChars = state?.initial_chat.message_max_chars ?? 6000;

    if (trimmed.length > maxChars) {
      setError({
        code: "validation_failed",
        message: "The message is too long.",
        details: { max_chars: maxChars },
        status: 400
      });
      return;
    }

    setError(null);
    setStatusMessage("");
    setIsBusy(true);

    try {
      const result = await sendInitialMessage({
        sessionPublicId,
        message: trimmed,
        clientMessageId: newClientActionId("initial-message")
      });

      setState(result.state);
      setInitialChatDraft("");
      setStatusMessage(result.reasoning_saved ? "Message sent. Reasoning saved." : "Message sent.");
      await refreshSecondaryData();
    } catch (caught) {
      setError(caught as StructuredStudentApiError);
    } finally {
      setIsBusy(false);
    }
  }

  async function handleStopFollowup() {
    if (!window.confirm("Stop this follow-up round? Your conversation will be saved.")) {
      return;
    }

    setError(null);
    setStatusMessage("");
    setIsBusy(true);

    try {
      await stopFollowup(sessionPublicId);
      const nextState = await fetchSessionState(sessionPublicId);

      setState(nextState);
      setStatusMessage("Follow-up stopped.");
      await refreshSecondaryData();
    } catch (caught) {
      setError(caught as StructuredStudentApiError);
    } finally {
      setIsBusy(false);
    }
  }

  async function handleRequestProgression() {
    setError(null);
    setStatusMessage("");
    setIsBusy(true);

    try {
      await requestProgression(sessionPublicId);
      const nextState = await fetchSessionState(sessionPublicId);

      setState(nextState);
      setStatusMessage("Move-on options are available.");
      await refreshSecondaryData();
    } catch (caught) {
      setError(caught as StructuredStudentApiError);
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

    if (!progressionPublicId) {
      return;
    }

    setError(null);
    setStatusMessage("");
    setIsBusy(true);

    try {
      const result = await chooseProgression({
        sessionPublicId,
        progressionPublicId,
        choice
      });
      const nextState = await fetchSessionState(sessionPublicId);

      setState(nextState);
      setStatusMessage(
        result.choice_status === "final_update_pending"
          ? "Reviewing your latest response before continuing."
          : result.choice_status === "next_concept_ready"
            ? "Next concept is ready."
            : result.choice_status === "assessment_completed"
              ? "Assessment completed."
              : result.choice_status === "progression_cancelled"
                ? "Continuing this concept."
                : "Progression choice saved."
      );
      await refreshSecondaryData();
    } catch (caught) {
      setError(caught as StructuredStudentApiError);
    } finally {
      setIsBusy(false);
    }
  }

  if (isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-surface px-4">
        <div className="flex items-center gap-2 rounded-lg border border-line bg-white p-4 text-sm text-muted">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Loading session
        </div>
      </main>
    );
  }

  if (!state || !frame) {
    return (
      <main className="min-h-screen bg-surface px-4 py-6">
        <div className="mx-auto max-w-3xl">
          <ErrorNotice error={error} />
        </div>
      </main>
    );
  }

  const currentItem = state.current_item;
  const visibleCurrentItem = currentItem
    ? {
        ...currentItem,
        existing_selected_option:
          optimisticOptions[currentItem.item_public_id] ?? currentItem.existing_selected_option,
        existing_confidence_rating:
          optimisticConfidence[currentItem.item_public_id] ?? currentItem.existing_confidence_rating
      }
    : null;
  const displayStage = manualStage ?? initialFlowStage(frame);
  const locked =
    review?.locked ??
    [
      "awaiting_profiling",
      "followup_active",
      "followup_updating",
      "followup_stopped",
      "session_completed"
    ].includes(state.next_step);
  const questionProgress =
    state.progress.total_item_count > 0
      ? `Question ${Math.min(
          state.progress.completed_item_count + 1,
          state.progress.total_item_count
        )} of ${state.progress.total_item_count}`
      : "Questions pending";

  return (
    <main className="min-h-screen bg-surface">
      <div className="mx-auto flex min-h-screen max-w-4xl flex-col px-4 py-4 md:px-6">
        <header className="flex flex-col gap-3 border-b border-line pb-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-semibold uppercase tracking-wide text-accent">
              {state.assessment.title}
            </p>
            <h1 className="mt-1 text-2xl font-semibold text-ink">
              {state.current_concept_unit?.title ?? "Initial questions"}
            </h1>
            <div className="mt-2 flex flex-wrap gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
              <span>
                Concept {state.progress.concept_unit_index || 1} of{" "}
                {Math.max(state.progress.concept_unit_count, 1)}
              </span>
              <span aria-hidden="true">/</span>
              <span>{questionProgress}</span>
            </div>
            <p className="mt-2 text-sm font-medium text-ink" data-testid="student-flow-stage">
              {stageLabel(displayStage)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-line bg-white px-4 text-sm font-semibold text-ink transition hover:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isBusy || !state.can_exit}
              onClick={() => void handleExit()}
              type="button"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              Save and exit
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 py-4">
          <section className="flex min-h-[68vh] flex-col rounded-lg border border-line bg-[#eef3ef]">
            <div className="flex-1 space-y-4 overflow-y-auto p-4">
              {transcript.map((entry) => (
                <StudentBubble entry={entry} key={`${entry.created_at}-${entry.message_text}`} />
              ))}
              <AssistantBubble frame={frame} />
              {visibleCurrentItem && displayStage !== "followup_active" ? <ItemPrompt item={visibleCurrentItem} /> : null}
              <div className="rounded-lg border border-line bg-surface p-4">
                <ErrorNotice error={error} />
                <div className={error ? "mt-3" : ""}>
                  <SaveStateNotice
                    error={error}
                    failedAction={failedAction}
                    isBusy={isBusy}
                    statusMessage={statusMessage}
                  />
                </div>
                <div className="mt-4">
                  <InteractionControls
                    currentItem={visibleCurrentItem}
                    displayStage={displayStage}
                    frame={frame}
                    isBusy={isBusy}
                    locked={locked}
                    followupDraft={followupDraft}
                    initialChatDraft={initialChatDraft}
                    reasoningDraft={reasoningDraft}
                    reasoningInputRef={reasoningInputRef}
                    state={state}
                    setFollowupDraft={setFollowupDraft}
                    setInitialChatDraft={setInitialChatDraft}
                    setReasoningDraft={setReasoningDraft}
                    onBegin={() => void handleBegin()}
                    onCompleteConceptUnit={() => void handleCompleteConceptUnit()}
                    onConfirmMissingSkip={() => void handleConfirmMissingSkip()}
                    onContinueFromConfidence={() => setManualStage(null)}
                    onContinueFromOption={() => {
                      setManualStage(null);
                      window.setTimeout(() => reasoningInputRef.current?.focus(), 0);
                    }}
                    onEditCurrentAnswer={() => setManualStage("option_selection")}
                    onOption={(item, label) => void handleOption(item, label)}
                    onReasoning={(item) => void handleReasoning(item)}
                    onSkipConfirmationCancel={() => setSkipConfirmation(null)}
                    onSkipEvidence={(item, field) => void handleSkipEvidence(item, field)}
                    onSkipItem={(item) => void handleSkipItem(item)}
                    onSubmit={(item) => void handleSubmit(item)}
                    onSendInitialMessage={() => void handleSendInitialMessage()}
                    onSendFollowup={() => void handleSendFollowup()}
                    onShowSkipConfirmation={(fields) => setSkipConfirmation(fields)}
                    onStopFollowup={() => void handleStopFollowup()}
                    onRequestProgression={() => void handleRequestProgression()}
                    onProgressionChoice={(choice) => void handleProgressionChoice(choice)}
                    onSaveExit={() => void handleExit()}
                    onConfidence={(item, confidence) => void handleConfidence(item, confidence)}
                  />
                </div>
              </div>
              {displayStage === "review_before_submit" ? null : (
                <CurrentAnswerSummary item={visibleCurrentItem} reasoningDraft={reasoningDraft} />
              )}
              <SavedResponseList
                currentItemPublicId={visibleCurrentItem?.item_public_id ?? null}
                review={review}
              />
            </div>
            {state.next_step === "followup_active" ||
            state.next_step === "followup_updating" ||
            state.next_step === "followup_stopped" ? null : (
              <div className="border-t border-line bg-surface p-4">
                <HelpDisclosure />
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}

function InitialChatComposer({
  disabled,
  draft,
  maxChars,
  onChange,
  onSend
}: {
  disabled: boolean;
  draft: string;
  maxChars: number;
  onChange: (value: string) => void;
  onSend: () => void;
}) {
  return (
    <details className="rounded-lg border border-line bg-white p-3">
      <summary className="cursor-pointer text-sm font-semibold text-ink">
        Send a message
      </summary>
      <div className="mt-3">
      <textarea
        className="mt-2 min-h-24 w-full resize-y rounded-md border border-line bg-white px-3 py-2 text-sm leading-6 text-ink shadow-sm focus:outline-none focus:ring-2 focus:ring-accent-soft disabled:bg-slate-50 disabled:opacity-70"
        data-testid="initial-chat-message-input"
        disabled={disabled}
        maxLength={maxChars}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            onSend();
          }
        }}
        placeholder="Write your reasoning or ask a procedural question..."
        value={draft}
      />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted">
          Use the option buttons to choose an answer and the confidence buttons to report
          confidence. {draft.length} / {maxChars}
        </p>
        <button
          className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-accent px-4 text-sm font-semibold text-white transition hover:bg-[#176350] focus:outline-none focus:ring-2 focus:ring-accent-soft disabled:cursor-not-allowed disabled:opacity-60"
          data-testid="send-initial-chat-message"
          disabled={disabled || !draft.trim()}
          onClick={onSend}
          type="button"
        >
          {disabled ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
          Send
        </button>
      </div>
      </div>
    </details>
  );
}

function InteractionControls({
  currentItem,
  displayStage,
  frame,
  isBusy,
  locked,
  followupDraft,
  initialChatDraft,
  reasoningDraft,
  reasoningInputRef,
  state,
  setFollowupDraft,
  setInitialChatDraft,
  setReasoningDraft,
  onBegin,
  onCompleteConceptUnit,
  onConfirmMissingSkip,
  onConfidence,
  onContinueFromConfidence,
  onContinueFromOption,
  onEditCurrentAnswer,
  onOption,
  onReasoning,
  onRequestProgression,
  onProgressionChoice,
  onSaveExit,
  onShowSkipConfirmation,
  onSendInitialMessage,
  onSendFollowup,
  onSkipConfirmationCancel,
  onSkipEvidence,
  onSkipItem,
  onSubmit,
  onStopFollowup
}: {
  currentItem: StudentSafeItem | null;
  displayStage: InitialFlowStage;
  frame: StudentConversationFrame;
  isBusy: boolean;
  locked: boolean;
  followupDraft: string;
  initialChatDraft: string;
  reasoningDraft: string;
  reasoningInputRef: RefObject<HTMLTextAreaElement | null>;
  state: StudentSessionState;
  setFollowupDraft: (value: string) => void;
  setInitialChatDraft: (value: string) => void;
  setReasoningDraft: (value: string) => void;
  onBegin: () => void;
  onCompleteConceptUnit: () => void;
  onConfirmMissingSkip: () => void;
  onConfidence: (item: StudentSafeItem, confidence: ConfidenceRating) => void;
  onContinueFromConfidence: () => void;
  onContinueFromOption: () => void;
  onEditCurrentAnswer: () => void;
  onOption: (item: StudentSafeItem, label: string) => void;
  onReasoning: (item: StudentSafeItem) => void;
  onRequestProgression: () => void;
  onProgressionChoice: (
    choice:
      | "continue_current_concept"
      | "next_concept"
      | "stay_in_final_concept"
      | "complete_assessment"
  ) => void;
  onSaveExit: () => void;
  onSendInitialMessage: () => void;
  onSendFollowup: () => void;
  onShowSkipConfirmation: (fields: MissingEvidenceField[]) => void;
  onSkipConfirmationCancel: () => void;
  onSkipEvidence: (item: StudentSafeItem, field: "reasoning" | "confidence") => void;
  onSkipItem: (item: StudentSafeItem) => void;
  onSubmit: (item: StudentSafeItem) => void;
  onStopFollowup: () => void;
}) {
  if (frame.interaction_type === "followup_active") {
    const maxChars = state.followup?.message_max_chars ?? 6000;
    const progression = state.progression ?? null;
    const hasProgressionChoices = Boolean(progression?.progression_public_id);

    return (
      <div className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">
          Follow-up conversation · initial responses locked
        </p>
        <textarea
          className="min-h-28 w-full resize-y rounded-md border border-line bg-white px-3 py-2 text-sm leading-6 text-ink shadow-sm focus:outline-none focus:ring-2 focus:ring-accent-soft disabled:opacity-60"
          data-testid="followup-message-input"
          disabled={isBusy || !state.followup?.can_send}
          maxLength={maxChars}
          onChange={(event) => setFollowupDraft(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              onSendFollowup();
            }
          }}
          placeholder="Write your follow-up response..."
          value={followupDraft}
        />
        {progression?.available ? (
          <div className="rounded-lg border border-line bg-white p-3">
            {progression.neutral_message ? (
              <p className="mb-3 text-sm leading-6 text-ink">{progression.neutral_message}</p>
            ) : null}
            {hasProgressionChoices ? (
              <div className="flex flex-wrap gap-2">
                {progression.is_final_concept ? (
                  <>
                    <button
                      className="inline-flex h-10 items-center justify-center rounded-md border border-line bg-white px-4 text-sm font-semibold text-ink transition hover:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft disabled:cursor-not-allowed disabled:opacity-60"
                      data-testid="stay-in-final-concept"
                      disabled={isBusy || progression.processing}
                      onClick={() => onProgressionChoice("stay_in_final_concept")}
                      type="button"
                    >
                      Stay and continue follow-up
                    </button>
                    <button
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-accent px-4 text-sm font-semibold text-white transition hover:bg-[#176350] focus:outline-none focus:ring-2 focus:ring-accent-soft disabled:cursor-not-allowed disabled:opacity-60"
                      data-testid="complete-assessment"
                      disabled={isBusy || progression.processing}
                      onClick={() => onProgressionChoice("complete_assessment")}
                      type="button"
                    >
                      <Check className="h-4 w-4" aria-hidden="true" />
                      Complete assessment
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      className="inline-flex h-10 items-center justify-center rounded-md border border-line bg-white px-4 text-sm font-semibold text-ink transition hover:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft disabled:cursor-not-allowed disabled:opacity-60"
                      data-testid="continue-current-concept"
                      disabled={isBusy || progression.processing}
                      onClick={() => onProgressionChoice("continue_current_concept")}
                      type="button"
                    >
                      Continue this concept
                    </button>
                    <button
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-accent px-4 text-sm font-semibold text-white transition hover:bg-[#176350] focus:outline-none focus:ring-2 focus:ring-accent-soft disabled:cursor-not-allowed disabled:opacity-60"
                      data-testid="next-concept"
                      disabled={isBusy || progression.processing}
                      onClick={() => onProgressionChoice("next_concept")}
                      type="button"
                    >
                      <ChevronRight className="h-4 w-4" aria-hidden="true" />
                      Next concept
                    </button>
                  </>
                )}
                <button
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-line bg-white px-4 text-sm font-semibold text-ink transition hover:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft disabled:cursor-not-allowed disabled:opacity-60"
                  data-testid="progression-save-exit"
                  disabled={isBusy}
                  onClick={onSaveExit}
                  type="button"
                >
                  <LogOut className="h-4 w-4" aria-hidden="true" />
                  Save and exit
                </button>
              </div>
            ) : (
              <button
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-line bg-white px-4 text-sm font-semibold text-ink transition hover:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft disabled:cursor-not-allowed disabled:opacity-60"
                data-testid="request-progression"
                disabled={isBusy || progression.processing}
                onClick={onRequestProgression}
                type="button"
              >
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
                I&apos;m ready to move on
              </button>
            )}
          </div>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted">
            {followupDraft.length} / {maxChars}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-line bg-white px-4 text-sm font-semibold text-ink transition hover:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft disabled:cursor-not-allowed disabled:opacity-60"
              data-testid="stop-followup"
              disabled={isBusy || !state.followup?.can_stop}
              onClick={onStopFollowup}
              type="button"
            >
              <Square className="h-4 w-4" aria-hidden="true" />
              Stop follow-up
            </button>
            <button
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-accent px-4 text-sm font-semibold text-white transition hover:bg-[#176350] focus:outline-none focus:ring-2 focus:ring-accent-soft disabled:cursor-not-allowed disabled:opacity-60"
              data-testid="send-followup-message"
              disabled={isBusy || !followupDraft.trim() || !state.followup?.can_send}
              onClick={onSendFollowup}
              type="button"
            >
              {isBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
              Send
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (frame.interaction_type === "session_completed") {
    return (
      <p className="rounded-md border border-line bg-white px-3 py-2 text-sm text-muted">
        Your assessment is complete. You can review your saved responses.
      </p>
    );
  }

  if (frame.interaction_type === "followup_stopped") {
    return (
      <p className="rounded-md border border-line bg-white px-3 py-2 text-sm text-muted">
        This follow-up round is stopped. Your transcript is saved.
      </p>
    );
  }

  if (frame.interaction_type === "followup_updating") {
    return (
      <div className="space-y-3">
        <p className="rounded-md border border-line bg-white px-3 py-2 text-sm text-muted">
          Your latest response is saved. The message box is paused while the next step is prepared.
        </p>
        <button
          className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-line bg-white px-4 text-sm font-semibold text-ink transition hover:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft disabled:cursor-not-allowed disabled:opacity-60"
          data-testid="stop-followup"
          disabled={isBusy || !state.followup?.can_stop}
          onClick={onStopFollowup}
          type="button"
        >
          <Square className="h-4 w-4" aria-hidden="true" />
          Stop follow-up
        </button>
      </div>
    );
  }

  if (frame.interaction_type === "concept_unit_intro") {
    return (
      <button
        className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-accent px-4 text-sm font-semibold text-white transition hover:bg-[#176350] focus:outline-none focus:ring-2 focus:ring-accent-soft disabled:cursor-not-allowed disabled:opacity-60"
        data-testid="begin-concept-unit"
        disabled={isBusy}
        onClick={onBegin}
        type="button"
      >
        {isBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
        Begin
      </button>
    );
  }

  if (frame.interaction_type === "confirm_skip") {
    return (
      <div className="flex flex-wrap gap-2">
        <button
          className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-accent px-4 text-sm font-semibold text-white transition hover:bg-[#176350] focus:outline-none focus:ring-2 focus:ring-accent-soft disabled:cursor-not-allowed disabled:opacity-60"
          data-testid="confirm-skip-missing"
          disabled={isBusy}
          onClick={onConfirmMissingSkip}
          type="button"
        >
          Continue without it
        </button>
        <button
          className="inline-flex h-10 items-center justify-center rounded-md border border-line bg-white px-4 text-sm font-semibold text-ink transition hover:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft"
          data-testid="cancel-skip-missing"
          onClick={onSkipConfirmationCancel}
          type="button"
        >
          Add it now
        </button>
      </div>
    );
  }

  if (!currentItem) {
    if (frame.interaction_type === "concept_unit_completed") {
      return (
        <button
          className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-accent px-4 text-sm font-semibold text-white transition hover:bg-[#176350] focus:outline-none focus:ring-2 focus:ring-accent-soft disabled:cursor-not-allowed disabled:opacity-60"
          data-testid="complete-initial-concept-unit"
          disabled={isBusy}
          onClick={onCompleteConceptUnit}
          type="button"
        >
          <Check className="h-4 w-4" aria-hidden="true" />
          Submit initial questions
        </button>
      );
    }

    return <p className="text-sm text-muted">No action is needed right now.</p>;
  }

  const initialComposer = (
    <InitialChatComposer
      disabled={isBusy || locked}
      draft={initialChatDraft}
      maxChars={state.initial_chat.message_max_chars}
      onChange={setInitialChatDraft}
      onSend={onSendInitialMessage}
    />
  );

  if (displayStage === "option_selection") {
    const hasSelectedOption = Boolean(currentItem.existing_selected_option);

    return (
      <div className="space-y-3">
        <OptionButtons
          disabled={isBusy || locked}
          item={currentItem}
          onSelect={(label) => onOption(currentItem, label)}
          testIdPrefix="main-option"
        />
        <button
          className="inline-flex h-10 items-center justify-center rounded-md border border-line bg-white px-4 text-sm font-semibold text-ink transition hover:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft disabled:cursor-not-allowed disabled:opacity-60"
          data-testid="skip-item"
          disabled={isBusy || locked}
          onClick={() => onSkipItem(currentItem)}
          type="button"
        >
          Skip this item
        </button>
        <div className="flex justify-end">
          <button
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-accent px-4 text-sm font-semibold text-white transition hover:bg-[#176350] focus:outline-none focus:ring-2 focus:ring-accent-soft disabled:cursor-not-allowed disabled:opacity-60"
            data-testid="continue-after-option"
            disabled={isBusy || locked || !hasSelectedOption || state.next_step === "present_item"}
            onClick={onContinueFromOption}
            type="button"
          >
            Continue
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    );
  }

  if (displayStage === "reasoning_prompt") {
    const canContinue = Boolean(reasoningDraft.trim());

    return (
      <div className="space-y-3">
        <label className="flex flex-col gap-2 text-sm font-medium text-ink">
          Tell me your reasoning
          <textarea
            ref={reasoningInputRef}
            className="min-h-28 resize-y rounded-md border border-line bg-white px-3 py-3 text-base outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
            data-testid="reasoning-input"
            disabled={isBusy || locked}
            maxLength={MAX_REASONING_LENGTH}
            onChange={(event) => setReasoningDraft(event.target.value)}
            placeholder="Briefly explain why you chose that option."
            value={reasoningDraft}
          />
          <span className="text-xs font-normal text-muted">
            {reasoningDraft.length} / {MAX_REASONING_LENGTH}
          </span>
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-accent px-4 text-sm font-semibold text-white transition hover:bg-[#176350] focus:outline-none focus:ring-2 focus:ring-accent-soft disabled:cursor-not-allowed disabled:opacity-60"
            data-testid="continue-after-reasoning"
            disabled={isBusy || locked || !canContinue}
            onClick={() => onReasoning(currentItem)}
            type="button"
          >
            Continue
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            className="inline-flex h-10 items-center justify-center rounded-md border border-line bg-white px-4 text-sm font-semibold text-ink transition hover:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft disabled:cursor-not-allowed disabled:opacity-60"
            data-testid="skip-reasoning"
            disabled={isBusy || locked}
            onClick={() => onSkipEvidence(currentItem, "reasoning")}
            type="button"
          >
            Skip reasoning
          </button>
        </div>
        {initialComposer}
      </div>
    );
  }

  if (displayStage === "confidence_prompt") {
    const hasConfidence = Boolean(currentItem.existing_confidence_rating);

    return (
      <div className="space-y-3">
        <ConfidenceButtons
          disabled={isBusy || locked}
          onSelect={(confidence) => onConfidence(currentItem, confidence)}
          testIdPrefix="main-confidence"
          value={currentItem.existing_confidence_rating}
        />
        <button
          className="inline-flex h-10 items-center justify-center rounded-md border border-line bg-white px-4 text-sm font-semibold text-ink transition hover:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft disabled:cursor-not-allowed disabled:opacity-60"
          data-testid="skip-confidence"
          disabled={isBusy || locked}
          onClick={() => onSkipEvidence(currentItem, "confidence")}
          type="button"
        >
          Skip confidence
        </button>
        <div className="flex justify-end">
          <button
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-accent px-4 text-sm font-semibold text-white transition hover:bg-[#176350] focus:outline-none focus:ring-2 focus:ring-accent-soft disabled:cursor-not-allowed disabled:opacity-60"
            data-testid="continue-after-confidence"
            disabled={isBusy || locked || !hasConfidence || state.next_step === "request_confidence"}
            onClick={onContinueFromConfidence}
            type="button"
          >
            Continue
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    );
  }

  if (frame.interaction_type === "missing_evidence_repair") {
    return (
      <div className="space-y-4">
        {frame.missing_fields.includes("answer") ? (
          <OptionButtons
            disabled={isBusy || locked}
            item={currentItem}
            onSelect={(label) => onOption(currentItem, label)}
            testIdPrefix="repair-option"
          />
        ) : null}
        {frame.missing_fields.includes("reasoning") ? (
          <label className="flex flex-col gap-2 text-sm font-medium text-ink">
            Add reasoning
            <textarea
              className="min-h-24 resize-y rounded-md border border-line bg-white px-3 py-3 text-base outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
              data-testid="repair-reasoning-input"
              maxLength={MAX_REASONING_LENGTH}
              onChange={(event) => setReasoningDraft(event.target.value)}
              value={reasoningDraft}
            />
          </label>
        ) : null}
        {frame.missing_fields.includes("confidence") ? (
          <ConfidenceButtons
            disabled={isBusy || locked}
            onSelect={(confidence) => onConfidence(currentItem, confidence)}
            testIdPrefix="repair-confidence"
            value={currentItem.existing_confidence_rating}
          />
        ) : null}
        <div className="flex flex-wrap gap-2">
          <button
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-accent px-4 text-sm font-semibold text-white transition hover:bg-[#176350] focus:outline-none focus:ring-2 focus:ring-accent-soft disabled:cursor-not-allowed disabled:opacity-60"
            data-testid="repair-continue"
            disabled={isBusy || locked}
            onClick={() => {
              if (frame.missing_fields.includes("reasoning") && reasoningDraft.trim()) {
                onReasoning(currentItem);
                return;
              }

              onSubmit(currentItem);
            }}
            type="button"
          >
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
            Continue
          </button>
          <button
            className="inline-flex h-10 items-center justify-center rounded-md border border-line bg-white px-4 text-sm font-semibold text-ink transition hover:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft disabled:cursor-not-allowed disabled:opacity-60"
            data-testid="repair-continue-without"
            disabled={isBusy || locked}
            onClick={() => onShowSkipConfirmation(frame.missing_fields)}
            type="button"
          >
            Continue without it
          </button>
        </div>
        {initialComposer}
      </div>
    );
  }

  if (displayStage === "review_before_submit") {
    return (
      <div className="space-y-3">
        <CurrentAnswerSummary item={currentItem} reasoningDraft={reasoningDraft} />
        <button
          className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-accent px-4 text-sm font-semibold text-white transition hover:bg-[#176350] focus:outline-none focus:ring-2 focus:ring-accent-soft disabled:cursor-not-allowed disabled:opacity-60"
          data-testid="submit-item"
          disabled={isBusy || locked}
          onClick={() => onSubmit(currentItem)}
          type="button"
        >
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
          Submit and continue
        </button>
        <button
          className="inline-flex h-10 items-center justify-center rounded-md border border-line bg-white px-4 text-sm font-semibold text-ink transition hover:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft disabled:cursor-not-allowed disabled:opacity-60"
          data-testid="edit-current-answer"
          disabled={isBusy || locked}
          onClick={onEditCurrentAnswer}
          type="button"
        >
          Edit answer
        </button>
      </div>
    );
  }

  return <p className="text-sm text-muted">Initial responses are saved.</p>;
}
