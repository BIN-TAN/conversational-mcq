"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Check,
  ChevronRight,
  HelpCircle,
  Loader2,
  LogOut,
  MessageSquareText,
  PanelRightOpen,
  Save,
  Send,
  Square,
  X
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
  completeInitialConceptUnit,
  exitSession,
  fetchSessionState,
  fetchStudentReview,
  fetchStudentTranscript,
  newClientActionId,
  saveConfidence,
  saveOption,
  saveReasoning,
  sendFollowupMessage,
  startAssessmentSession,
  stopFollowup,
  submitItem
} from "./api";
import { useStudentProcessEvents } from "./process-events";

const MAX_REASONING_LENGTH = 5000;

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
            className={`flex min-h-12 items-start gap-3 rounded-md border px-3 py-3 text-left text-sm transition focus:outline-none focus:ring-2 focus:ring-accent-soft disabled:cursor-not-allowed disabled:opacity-60 ${
              selected
                ? "border-accent bg-accent-soft text-ink"
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
            <span className="leading-6">{option.text}</span>
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
            className={`min-h-11 rounded-md border px-3 py-2 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-accent-soft disabled:cursor-not-allowed disabled:opacity-60 ${
              selected
                ? "border-accent bg-accent-soft text-ink"
                : "border-line bg-white text-ink hover:border-accent"
            }`}
            data-testid={`${testIdPrefix}-${level}`}
            disabled={disabled}
            key={level}
            onClick={() => onSelect(level)}
            type="button"
          >
            {confidenceLabel(level)}
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

export function AssessmentSessionClient({ sessionPublicId }: { sessionPublicId: string }) {
  const router = useRouter();
  const [state, setState] = useState<StudentSessionState | null>(null);
  const [transcript, setTranscript] = useState<StudentTranscriptEntry[]>([]);
  const [review, setReview] = useState<StudentReviewResponse | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [error, setError] = useState<StructuredStudentApiError | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isBusy, setIsBusy] = useState(false);
  const [reasoningDraft, setReasoningDraft] = useState("");
  const [followupDraft, setFollowupDraft] = useState("");
  const [reviewDrafts, setReviewDrafts] = useState<Record<string, string>>({});
  const [skipConfirmation, setSkipConfirmation] = useState<MissingEvidenceField[] | null>(null);

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
    setReviewDrafts((existing) => {
      const next = { ...existing };

      for (const item of nextReview.items) {
        if (!(item.item_public_id in next)) {
          next[item.item_public_id] = item.existing_reasoning_text ?? "";
        }
      }

      return next;
    });
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

  async function runAction(
    action: () => Promise<StudentSessionState>,
    message: string
  ) {
    setError(null);
    setStatusMessage("");
    setIsBusy(true);

    try {
      const nextState = await action();
      setState(nextState);
      setSkipConfirmation(null);
      setStatusMessage(message);
      await refreshSecondaryData();
    } catch (caught) {
      const apiError = caught as StructuredStudentApiError;

      if (apiError.status === 401) {
        router.push("/student/login");
        return;
      }

      setError(apiError);
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
    await runAction(
      () =>
        saveOption({
          sessionPublicId,
          itemPublicId: item.item_public_id,
          selectedOption: label
        }),
      "Option saved."
    );
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

    await runAction(
      () =>
        saveReasoning({
          sessionPublicId,
          itemPublicId: item.item_public_id,
          reasoningText: trimmed
        }),
      "Reasoning saved."
    );
  }

  async function handleConfidence(item: StudentSafeItem, confidence: ConfidenceRating) {
    await runAction(
      () =>
        saveConfidence({
          sessionPublicId,
          itemPublicId: item.item_public_id,
          confidenceRating: confidence
        }),
      "Confidence saved."
    );
  }

  async function handleSubmit(item: StudentSafeItem) {
    await runAction(
      async () =>
        (
          await submitItem({
            sessionPublicId,
            itemPublicId: item.item_public_id
          })
        ).state,
      "Response submitted."
    );
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

  async function handleReviewReasoning(item: StudentReviewResponse["items"][number]) {
    const text = (reviewDrafts[item.item_public_id] ?? "").trim();

    if (!text) {
      setError({
        code: "validation_failed",
        message: "Enter reasoning before saving, or leave it unchanged.",
        status: 400
      });
      return;
    }

    await runAction(
      () =>
        saveReasoning({
          sessionPublicId,
          itemPublicId: item.item_public_id,
          reasoningText: text
        }),
      "Review change saved."
    );
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
  const locked =
    review?.locked ??
    ["awaiting_profiling", "followup_active", "followup_updating", "followup_stopped"].includes(
      state.next_step
    );
  const questionProgress =
    state.progress.total_item_count > 0
      ? `Question ${Math.min(
          state.progress.completed_item_count + 1,
          state.progress.total_item_count
        )} of ${state.progress.total_item_count}`
      : "Questions pending";

  return (
    <main className="min-h-screen bg-surface">
      <div className="mx-auto flex min-h-screen max-w-7xl flex-col px-4 py-4 md:px-6">
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
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-line bg-white px-4 text-sm font-semibold text-ink transition hover:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft"
              onClick={() => setReviewOpen(true)}
              type="button"
            >
              <PanelRightOpen className="h-4 w-4" aria-hidden="true" />
              Review responses
            </button>
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

        <div className="grid min-h-0 flex-1 gap-4 py-4 lg:grid-cols-[minmax(0,1fr)_340px]">
          <section className="flex min-h-[60vh] flex-col rounded-lg border border-line bg-[#eef3ef]">
            <div className="flex-1 space-y-4 overflow-y-auto p-4">
              {transcript.map((entry) => (
                <StudentBubble entry={entry} key={`${entry.created_at}-${entry.message_text}`} />
              ))}
              <AssistantBubble frame={frame} />
              {currentItem ? <ItemPrompt item={currentItem} /> : null}
            </div>

            <div className="border-t border-line bg-surface p-4">
              <ErrorNotice error={error} />
              {statusMessage ? (
                <p className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900" aria-live="polite">
                  {statusMessage}
                </p>
              ) : null}
              <div className="mt-4">
                <InteractionControls
                  currentItem={currentItem}
                  frame={frame}
                  isBusy={isBusy}
                  locked={locked}
                  followupDraft={followupDraft}
                  reasoningDraft={reasoningDraft}
                  state={state}
                  setFollowupDraft={setFollowupDraft}
                  setReasoningDraft={setReasoningDraft}
                  onBegin={() => void handleBegin()}
                  onCompleteConceptUnit={() => void handleCompleteConceptUnit()}
                  onConfirmMissingSkip={() => void handleConfirmMissingSkip()}
                  onOption={(item, label) => void handleOption(item, label)}
                  onReasoning={(item) => void handleReasoning(item)}
                  onSkipConfirmationCancel={() => setSkipConfirmation(null)}
                  onSkipEvidence={(item, field) => void handleSkipEvidence(item, field)}
                  onSkipItem={(item) => void handleSkipItem(item)}
                  onSubmit={(item) => void handleSubmit(item)}
                  onSendFollowup={() => void handleSendFollowup()}
                  onShowSkipConfirmation={(fields) => setSkipConfirmation(fields)}
                  onStopFollowup={() => void handleStopFollowup()}
                  onConfidence={(item, confidence) => void handleConfidence(item, confidence)}
                />
              </div>
              {state.next_step === "followup_active" ||
              state.next_step === "followup_updating" ||
              state.next_step === "followup_stopped" ? null : (
                <div className="mt-4">
                  <HelpDisclosure />
                </div>
              )}
            </div>
          </section>

          <aside className="hidden lg:block">
            <ReviewPanel
              currentItemPublicId={currentItem?.item_public_id ?? null}
              disabled={isBusy}
              locked={locked}
              onConfidence={(item, confidence) => void handleConfidence(item, confidence)}
              onOption={(item, label) => void handleOption(item, label)}
              onReasoning={(item) => void handleReviewReasoning(item)}
              review={review}
              reviewDrafts={reviewDrafts}
              setReviewDrafts={setReviewDrafts}
            />
          </aside>
        </div>
      </div>

      {reviewOpen ? (
        <div className="fixed inset-0 z-50 bg-black/25 lg:hidden" role="dialog" aria-modal="true">
          <div className="ml-auto h-full w-full max-w-md overflow-y-auto bg-surface p-4 shadow-soft">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-ink">Review responses</h2>
              <button
                className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-line bg-white text-ink"
                onClick={() => setReviewOpen(false)}
                type="button"
                aria-label="Close review"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <ReviewPanel
              currentItemPublicId={currentItem?.item_public_id ?? null}
              disabled={isBusy}
              locked={locked}
              onConfidence={(item, confidence) => void handleConfidence(item, confidence)}
              onOption={(item, label) => void handleOption(item, label)}
              onReasoning={(item) => void handleReviewReasoning(item)}
              review={review}
              reviewDrafts={reviewDrafts}
              setReviewDrafts={setReviewDrafts}
            />
          </div>
        </div>
      ) : null}
    </main>
  );
}

function InteractionControls({
  currentItem,
  frame,
  isBusy,
  locked,
  followupDraft,
  reasoningDraft,
  state,
  setFollowupDraft,
  setReasoningDraft,
  onBegin,
  onCompleteConceptUnit,
  onConfirmMissingSkip,
  onConfidence,
  onOption,
  onReasoning,
  onShowSkipConfirmation,
  onSendFollowup,
  onSkipConfirmationCancel,
  onSkipEvidence,
  onSkipItem,
  onSubmit,
  onStopFollowup
}: {
  currentItem: StudentSafeItem | null;
  frame: StudentConversationFrame;
  isBusy: boolean;
  locked: boolean;
  followupDraft: string;
  reasoningDraft: string;
  state: StudentSessionState;
  setFollowupDraft: (value: string) => void;
  setReasoningDraft: (value: string) => void;
  onBegin: () => void;
  onCompleteConceptUnit: () => void;
  onConfirmMissingSkip: () => void;
  onConfidence: (item: StudentSafeItem, confidence: ConfidenceRating) => void;
  onOption: (item: StudentSafeItem, label: string) => void;
  onReasoning: (item: StudentSafeItem) => void;
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

  if (frame.interaction_type === "present_item") {
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
      </div>
    );
  }

  if (frame.interaction_type === "request_reasoning") {
    return (
      <div className="space-y-3">
        <label className="flex flex-col gap-2 text-sm font-medium text-ink">
          Your reasoning
          <textarea
            className="min-h-28 resize-y rounded-md border border-line bg-white px-3 py-3 text-base outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
            data-testid="reasoning-input"
            maxLength={MAX_REASONING_LENGTH}
            onChange={(event) => setReasoningDraft(event.target.value)}
            value={reasoningDraft}
          />
          <span className="text-xs font-normal text-muted">
            {reasoningDraft.length} / {MAX_REASONING_LENGTH}
          </span>
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-accent px-4 text-sm font-semibold text-white transition hover:bg-[#176350] focus:outline-none focus:ring-2 focus:ring-accent-soft disabled:cursor-not-allowed disabled:opacity-60"
            data-testid="save-reasoning"
            disabled={isBusy || locked}
            onClick={() => onReasoning(currentItem)}
            type="button"
          >
            <Save className="h-4 w-4" aria-hidden="true" />
            Save reasoning
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
      </div>
    );
  }

  if (frame.interaction_type === "request_confidence") {
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
      </div>
    );
  }

  if (frame.interaction_type === "item_completed") {
    return (
      <button
        className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-accent px-4 text-sm font-semibold text-white transition hover:bg-[#176350] focus:outline-none focus:ring-2 focus:ring-accent-soft disabled:cursor-not-allowed disabled:opacity-60"
        data-testid="submit-item"
        disabled={isBusy || locked}
        onClick={() => onSubmit(currentItem)}
        type="button"
      >
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
        Submit response
      </button>
    );
  }

  return <p className="text-sm text-muted">Initial responses are saved.</p>;
}

function ReviewPanel({
  currentItemPublicId,
  disabled,
  locked,
  onConfidence,
  onOption,
  onReasoning,
  review,
  reviewDrafts,
  setReviewDrafts
}: {
  currentItemPublicId: string | null;
  disabled: boolean;
  locked: boolean;
  onConfidence: (item: StudentReviewResponse["items"][number], confidence: ConfidenceRating) => void;
  onOption: (item: StudentReviewResponse["items"][number], label: string) => void;
  onReasoning: (item: StudentReviewResponse["items"][number]) => void;
  review: StudentReviewResponse | null;
  reviewDrafts: Record<string, string>;
  setReviewDrafts: React.Dispatch<React.SetStateAction<Record<string, string>>>;
}) {
  if (!review) {
    return (
      <div className="rounded-lg border border-line bg-white p-4 text-sm text-muted">
        Review will be available after the session loads.
      </div>
    );
  }

  return (
    <section className="rounded-lg border border-line bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-ink">Review responses</h2>
          <p className="mt-1 text-sm text-muted">{locked ? "Read only" : "Editable before completion"}</p>
        </div>
      </div>
      <div className="mt-4 space-y-4">
        {review.items.map((item) => {
          const canEdit =
            !locked &&
            item.can_edit &&
            (item.submission_state !== "not_started" || item.item_public_id === currentItemPublicId);

          return (
            <article className="rounded-lg border border-line bg-[#fbfcfa] p-3" key={item.item_public_id}>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                Question {item.item_order} / {item.submission_state.replaceAll("_", " ")}
              </p>
              <p className="mt-2 text-sm leading-6 text-ink">{item.item_stem}</p>
              {item.missing_fields.length > 0 ? (
                <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-900">
                  Missing: {item.missing_fields.map(fieldLabel).join(", ")}
                </p>
              ) : null}
              <div className="mt-3 space-y-3">
                <OptionButtons
                  disabled={disabled || !canEdit}
                  item={item}
                  onSelect={(label) => onOption(item, label)}
                  testIdPrefix="review-option"
                />
                <label className="flex flex-col gap-2 text-sm font-medium text-ink">
                  Reasoning
                  <textarea
                    className="min-h-20 resize-y rounded-md border border-line bg-white px-3 py-2 text-sm outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft disabled:bg-slate-50"
                    data-testid={`review-reasoning-${item.item_public_id}`}
                    disabled={disabled || !canEdit}
                    maxLength={MAX_REASONING_LENGTH}
                    onChange={(event) =>
                      setReviewDrafts((current) => ({
                        ...current,
                        [item.item_public_id]: event.target.value
                      }))
                    }
                    value={reviewDrafts[item.item_public_id] ?? item.existing_reasoning_text ?? ""}
                  />
                </label>
                {canEdit ? (
                  <button
                    className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-line bg-white px-3 text-sm font-semibold text-ink transition hover:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft"
                    data-testid={`review-save-reasoning-${item.item_public_id}`}
                    disabled={disabled}
                    onClick={() => onReasoning(item)}
                    type="button"
                  >
                    <Save className="h-4 w-4" aria-hidden="true" />
                    Save reasoning
                  </button>
                ) : null}
                <ConfidenceButtons
                  disabled={disabled || !canEdit}
                  onSelect={(confidence) => onConfidence(item, confidence)}
                  testIdPrefix={`review-confidence-${item.item_public_id}`}
                  value={item.existing_confidence_rating}
                />
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
