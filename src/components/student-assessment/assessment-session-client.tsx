"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, LogOut, MessageSquareText, Send } from "lucide-react";
import type {
  ConfidenceRating,
  StructuredStudentApiError,
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
  requestProgression,
  saveConfidence,
  saveOption,
  saveReasoning,
  saveTemptingOption,
  selectNextChoice,
  sendFormativeActivityResponse,
  sendFollowupMessage,
  sendRevisionResponse,
  startAssessmentSession,
  stopFollowup
} from "./api";
import { useStudentProcessEvents } from "./process-events";

const MAX_REASONING_LENGTH = 5000;

type FailedAction = {
  label: string;
  retry: () => void;
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

function displayTranscriptText(entry: StudentTranscriptEntry) {
  if (entry.actor !== "student") {
    return entry.message_text;
  }

  if (entry.interaction_type === "option_selected" || entry.interaction_type === "transfer_option_selected") {
    const selected = entry.message_text.match(/^Selected option\s+(.+)\.$/i)?.[1]?.trim();
    return selected || entry.message_text;
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

function ChatBubble({ entry }: { entry: StudentTranscriptEntry }) {
  const isAssistant = entry.actor === "assistant";

  return (
    <div className={isAssistant ? "flex justify-start" : "flex justify-end"}>
      <div
        className={
          isAssistant
            ? "max-w-3xl rounded-lg rounded-bl-sm border border-line bg-white p-4 shadow-soft"
            : "max-w-2xl rounded-lg rounded-br-sm bg-[#23312d] p-4 text-white"
        }
        data-testid={isAssistant ? "agent-chat-message" : "student-chat-message"}
      >
        <div className={isAssistant ? "flex gap-3" : ""}>
          {isAssistant ? (
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent">
              <MessageSquareText className="h-4 w-4" aria-hidden="true" />
            </div>
          ) : null}
          <div>
            <p className="whitespace-pre-wrap text-sm leading-6">{displayTranscriptText(entry)}</p>
            <p className={isAssistant ? "mt-2 text-xs text-muted" : "mt-2 text-xs text-white/70"}>
              {new Date(entry.created_at).toLocaleString()}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function shouldHideActiveAgentTranscriptEntry(entry: StudentTranscriptEntry, state: StudentSessionState) {
  if (entry.actor !== "assistant") {
    return false;
  }

  const currentItemPublicId = state.current_item?.item_public_id ?? null;
  const sameCurrentItem = Boolean(currentItemPublicId && entry.item_public_id === currentItemPublicId);
  const text = entry.message_text;

  if (
    (state.assessment_state === "ITEM_PRESENTED" || state.assessment_state === "AWAIT_ANSWER") &&
    sameCurrentItem
  ) {
    return text.startsWith(`Question ${state.current_item?.item_order ?? ""} of 3`);
  }

  if (state.assessment_state === "TRANSFER_ITEM" && sameCurrentItem) {
    return text.startsWith("Additional question");
  }

  if (state.assessment_state === "AWAIT_REASON" && sameCurrentItem) {
    return text.startsWith("What is your reason for choosing");
  }

  if (state.assessment_state === "AWAIT_CONFIDENCE" && sameCurrentItem) {
    return text.startsWith("How confident are you");
  }

  if (state.assessment_state === "AWAIT_TEMPTING_OPTION" && sameCurrentItem) {
    return text.startsWith("Was another option tempting?");
  }

  if (state.assessment_state === "AWAIT_TEMPTING_REASON" && sameCurrentItem) {
    return text.startsWith("What made that option seem tempting?");
  }

  if (state.assessment_state === "PACKAGE_REVIEW") {
    return text.startsWith("I have your three responses.");
  }

  return false;
}

function AgentMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex justify-start">
      <div
        className="max-w-3xl rounded-lg rounded-bl-sm border border-line bg-white p-4 shadow-soft"
        data-testid="agent-chat-message"
      >
        <div className="flex gap-3">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent">
            <MessageSquareText className="h-4 w-4" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1 text-sm leading-6 text-ink">{children}</div>
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
  return (
    <AgentMessage>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">
        {isTransferItem ? "Additional question" : `Question ${item.item_order} of 3`}
      </p>
      <p className="mt-2 whitespace-pre-wrap text-base leading-7 text-ink">{item.item_stem}</p>
      <div className="mt-4 grid gap-2">
        {item.options.map((option) => (
          <div className="rounded-md border border-line bg-[#fbfcfa] p-3" key={option.label}>
            <p className="text-sm leading-6">
              <span className="font-semibold">{option.label}.</span> {option.text}
            </p>
          </div>
        ))}
      </div>
      <p className="mt-4 font-medium text-ink">What is your answer?</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {item.options.map((option) => (
          <OptionChip
            disabled={disabled}
            key={option.label}
            label={option.label}
            onSelect={() => onSelect(option.label)}
            testId={`chat-option-${item.item_public_id}-${option.label}`}
          />
        ))}
      </div>
    </AgentMessage>
  );
}

function ConfidenceMessage({
  disabled,
  onSelect
}: {
  disabled: boolean;
  onSelect: (confidence: ConfidenceRating) => void;
}) {
  const levels: ConfidenceRating[] = ["low", "medium", "high"];

  return (
    <AgentMessage>
      <p className="font-medium text-ink">How confident are you: Low, Medium, or High?</p>
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
  onNo,
  onSelect
}: {
  item: StudentSafeItem;
  disabled: boolean;
  onNo: () => void;
  onSelect: (label: string) => void;
}) {
  return (
    <AgentMessage>
      <p className="font-medium text-ink">
        Was another option tempting? If yes, which one, and what made it tempting? You can also
        say No.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {item.options.map((option) => (
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
  onSend
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
}) {
  return (
    <div className="rounded-lg border border-line bg-white p-3 shadow-soft">
      <label className="sr-only" htmlFor={testId}>
        {label}
      </label>
      <textarea
        className="min-h-24 w-full resize-none rounded-md border border-line px-3 py-2 text-sm leading-6 text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft disabled:bg-[#f4f6f3]"
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
      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="text-xs text-muted">
          Press Enter to send; Shift+Enter adds a new line. {value.length} / {maxLength}
        </p>
        <button
          className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60"
          data-testid={sendTestId ?? `${testId}-send`}
          disabled={disabled || !value.trim()}
          onClick={onSend}
          type="button"
        >
          <Send className="h-4 w-4" aria-hidden="true" />
          Send
        </button>
      </div>
    </div>
  );
}

function PackageReviewMessage({
  review,
  isBusy,
  onContinue
}: {
  review: StudentReviewResponse | null;
  isBusy: boolean;
  onContinue: () => void;
}) {
  return (
    <AgentMessage>
      <p className="font-medium text-ink">
        I have your three responses. You can review them or continue to feedback.
      </p>
      {review ? (
        <div className="mt-4 grid gap-3" data-testid="package-review-list">
          {review.items.map((item) => (
            <div className="rounded-md border border-line bg-[#fbfcfa] p-3" key={item.item_public_id}>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                Question {item.item_order}
              </p>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-ink">{item.item_stem}</p>
              <dl className="mt-3 grid gap-2 text-sm">
                <div>
                  <dt className="font-semibold text-ink">Answer</dt>
                  <dd className="text-muted">{item.existing_selected_option ?? "Not answered"}</dd>
                </div>
                <div>
                  <dt className="font-semibold text-ink">Reason</dt>
                  <dd className="whitespace-pre-wrap text-muted">
                    {item.existing_reasoning_text ?? "No reason provided"}
                  </dd>
                </div>
                <div>
                  <dt className="font-semibold text-ink">Confidence</dt>
                  <dd className="text-muted">
                    {item.existing_confidence_rating
                      ? confidenceLabel(item.existing_confidence_rating)
                      : "Not provided"}
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
          ))}
        </div>
      ) : null}
      <button
        className="mt-4 inline-flex items-center justify-center rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60"
        data-testid="continue-to-feedback"
        disabled={isBusy}
        onClick={onContinue}
        type="button"
      >
        Continue to feedback
      </button>
    </AgentMessage>
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
  state,
  isBusy,
  formativeActivityDraft,
  setFormativeActivityDraft,
  onSendFormativeActivityResponse
}: {
  state: StudentSessionState;
  isBusy: boolean;
  formativeActivityDraft: string;
  setFormativeActivityDraft: (value: string) => void;
  onSendFormativeActivityResponse: () => void;
}) {
  if (state.next_step === "formative_response_saved") {
    return (
      <AgentMessage>
        <p className="font-medium text-ink">
          Thanks. Your response has been recorded. Targeted feedback is not available yet in this prototype.
        </p>
      </AgentMessage>
    );
  }

  return (
    <TextComposer
      disabled={isBusy || !state.formative_activity?.can_send}
      label="Formative activity response"
      maxLength={state.formative_activity?.message_max_chars ?? 5000}
      onChange={setFormativeActivityDraft}
      onSend={onSendFormativeActivityResponse}
      placeholder="Write your response..."
      sendTestId="send-formative-activity-response"
      testId="formative-activity-response-input"
      value={formativeActivityDraft}
    />
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

function activeItemPrompt(input: {
  state: StudentSessionState;
  review: StudentReviewResponse | null;
  isBusy: boolean;
  reasoningDraft: string;
  temptingReasonDraft: string;
  followupDraft: string;
  formativeActivityDraft: string;
  revisionDraft: string;
  setReasoningDraft: (value: string) => void;
  setTemptingReasonDraft: (value: string) => void;
  setFollowupDraft: (value: string) => void;
  setFormativeActivityDraft: (value: string) => void;
  setRevisionDraft: (value: string) => void;
  onBeginConceptUnit: () => void;
  onSelectOption: (label: string) => void;
  onSendReasoning: () => void;
  onSelectConfidence: (confidence: ConfidenceRating) => void;
  onSelectTemptingOption: (label: string) => void;
  onNoTemptingOption: () => void;
  onSendTemptingReason: () => void;
  onContinuePackage: () => void;
  onSendFormativeActivityResponse: () => void;
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

  if (state.assessment_state === "SESSION_START") {
    return (
      <AgentMessage>
        <p className="font-medium text-ink">
          We will start with three questions. I will ask for your answer, your reason,
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
        isTransferItem={state.assessment_state === "TRANSFER_ITEM" || state.next_step === "transfer_item"}
        item={item}
        onSelect={input.onSelectOption}
      />
    );
  }

  if (state.assessment_state === "AWAIT_REASON" && item) {
    return (
      <>
        <AgentMessage>
          <p className="font-medium text-ink">
            What is your reason for choosing {item.existing_selected_option ?? "that option"}?
          </p>
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
      </>
    );
  }

  if (state.assessment_state === "AWAIT_CONFIDENCE") {
    return <ConfidenceMessage disabled={isBusy} onSelect={input.onSelectConfidence} />;
  }

  if (state.assessment_state === "AWAIT_TEMPTING_OPTION" && item) {
    return (
      <TemptingOptionMessage
        disabled={isBusy}
        item={item}
        onNo={input.onNoTemptingOption}
        onSelect={input.onSelectTemptingOption}
      />
    );
  }

  if (state.assessment_state === "AWAIT_TEMPTING_REASON") {
    return (
      <>
        <AgentMessage>
          <p className="font-medium text-ink">What made that option seem tempting?</p>
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
        isBusy={isBusy}
        onContinue={input.onContinuePackage}
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
        formativeActivityDraft={input.formativeActivityDraft}
        isBusy={isBusy}
        onSendFormativeActivityResponse={input.onSendFormativeActivityResponse}
        setFormativeActivityDraft={input.setFormativeActivityDraft}
        state={state}
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
  sessionPublicId
}: {
  assessmentPublicId?: string;
  initialSessionPublicId?: string;
  sessionPublicId?: string;
}) {
  const router = useRouter();
  const resolvedInitialSessionPublicId = initialSessionPublicId ?? sessionPublicId;
  const [state, setState] = useState<StudentSessionState | null>(null);
  const [transcript, setTranscript] = useState<StudentTranscriptEntry[]>([]);
  const [review, setReview] = useState<StudentReviewResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<StructuredStudentApiError | null>(null);
  const [failedAction, setFailedAction] = useState<FailedAction | null>(null);
  const [reasoningDraft, setReasoningDraft] = useState("");
  const [temptingReasonDraft, setTemptingReasonDraft] = useState("");
  const [followupDraft, setFollowupDraft] = useState("");
  const [formativeActivityDraft, setFormativeActivityDraft] = useState("");
  const [revisionDraft, setRevisionDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useStudentProcessEvents({
    sessionPublicId: state?.session_public_id ?? resolvedInitialSessionPublicId ?? "pending-session",
    currentItemPublicId: state?.current_item?.item_public_id
  });

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

  async function runAction(label: string, action: () => Promise<StudentSessionState>) {
    setIsBusy(true);
    setError(null);
    setFailedAction(null);

    try {
      const nextState = await action();
      setState(nextState);
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
          nextState = started.state;
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
  }, [assessmentPublicId, resolvedInitialSessionPublicId]);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [transcript.length, state?.assessment_state, state?.current_item?.item_public_id]);

  useEffect(() => {
    setReasoningDraft("");
    setTemptingReasonDraft("");
  }, [state?.assessment_state, state?.current_item?.item_public_id]);

  useEffect(() => {
    if (state?.next_step !== "formative_activity") {
      setFormativeActivityDraft("");
    }
  }, [state?.next_step]);

  useEffect(() => {
    if (state?.assessment_state !== "REVISION") {
      setRevisionDraft("");
    }
  }, [state?.assessment_state]);

  const activeSessionPublicId = state?.session_public_id ?? resolvedInitialSessionPublicId;
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

  function handleCompletePackage() {
    if (!state?.current_concept_unit) {
      return;
    }

    void runAction("Continue to feedback", () =>
      completeInitialConceptUnit({
        sessionPublicId: state.session_public_id,
        conceptUnitPublicId: state.current_concept_unit?.concept_unit_public_id ?? ""
      })
    );
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
      router.push("/student");
    } catch (errorValue) {
      handleError(errorValue, "Save and exit", () => {
        void handleExit();
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
      await refreshSecondaryData(nextState.session_public_id);
    } catch (errorValue) {
      handleError(errorValue, "Send follow-up response", () => {
        void handleSendFollowup();
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

    const maxChars = state.formative_activity?.message_max_chars ?? 5000;

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
      const result = await sendFormativeActivityResponse({
        sessionPublicId: state.session_public_id,
        message: trimmed,
        clientMessageId: newClientActionId("formative-activity")
      });
      setFormativeActivityDraft("");
      setState(result.state);
      await refreshSecondaryData(result.state.session_public_id);
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

  const activePrompt = activeItemPrompt({
    state,
    review,
    isBusy,
    reasoningDraft,
    temptingReasonDraft,
    followupDraft,
    formativeActivityDraft,
    revisionDraft,
    setReasoningDraft,
    setTemptingReasonDraft,
    setFollowupDraft,
    setFormativeActivityDraft,
    setRevisionDraft,
    onBeginConceptUnit: handleBeginConceptUnit,
    onSelectOption: handleOption,
    onSendReasoning: handleReasoning,
    onSelectConfidence: handleConfidence,
    onSelectTemptingOption: handleTemptingOption,
    onNoTemptingOption: handleNoTemptingOption,
    onSendTemptingReason: handleTemptingReason,
    onContinuePackage: handleCompletePackage,
    onSendFormativeActivityResponse: handleSendFormativeActivityResponse,
    onSendRevision: handleSendRevision,
    onNextChoice: handleNextChoice,
    onSendFollowup: handleSendFollowup,
    onStopFollowup: handleStopFollowup,
    onRequestProgression: handleRequestProgression,
    onProgressionChoice: handleProgressionChoice
  });
  const visibleTranscript = transcript.filter(
    (entry) => !shouldHideActiveAgentTranscriptEntry(entry, state)
  );

  return (
    <div className="mx-auto flex min-h-[calc(100vh-7rem)] w-full max-w-5xl flex-col px-4 py-6 sm:px-6 lg:px-8">
      <header className="mb-4 rounded-lg border border-line bg-white p-4 shadow-soft">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">
              {state.assessment.title}
            </p>
            <h1 className="mt-1 text-xl font-semibold text-ink">
              {state.current_concept_unit?.title ?? "Assessment"}
            </h1>
            <p className="mt-2 text-sm text-muted" data-testid="student-flow-stage">
              {state.assessment_state.replaceAll("_", " ").toLowerCase()}
            </p>
          </div>
          <button
            className="inline-flex items-center justify-center gap-2 rounded-md border border-line px-3 py-2 text-sm font-semibold text-ink transition hover:border-accent disabled:cursor-not-allowed disabled:opacity-60"
            data-testid="save-exit"
            disabled={isBusy || !state.can_exit}
            onClick={() => void handleExit()}
            type="button"
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
            Save and exit
          </button>
        </div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-[#edf1ec]" aria-hidden="true">
          <div
            className="h-full rounded-full bg-accent"
            style={{
              width: `${Math.min(
                100,
                Math.max(
                  0,
                  (state.progress.completed_item_count / Math.max(1, state.progress.total_item_count)) * 100
                )
              )}%`
            }}
          />
        </div>
      </header>

      <main className="flex flex-1 flex-col rounded-lg border border-line bg-[#f7f9f6] p-4 shadow-soft">
        <ErrorNotice error={error} />
        {failedAction ? (
          <button
            className="mt-3 w-fit rounded-md border border-line px-4 py-2 text-sm font-semibold text-ink hover:border-accent"
            data-testid="retry-save-action"
            disabled={isBusy}
            onClick={failedAction.retry}
            type="button"
          >
            Retry {failedAction.label}
          </button>
        ) : null}
        <div className="mt-4 flex flex-1 flex-col gap-4" data-testid="chat-transcript">
          {visibleTranscript.map((entry) => (
            <ChatBubble entry={entry} key={`${entry.created_at}-${entry.actor}-${entry.message_text}`} />
          ))}
          {activePrompt}
          {isBusy ? (
            <div className="flex justify-start">
              <div className="rounded-full border border-line bg-white px-4 py-2 text-sm text-muted shadow-soft">
                <Loader2 className="mr-2 inline h-4 w-4 animate-spin" aria-hidden="true" />
                Working...
              </div>
            </div>
          ) : null}
          <div ref={scrollRef} />
        </div>
      </main>
      <p className="mt-3 text-xs leading-5 text-muted">
        During the first three questions, the assessment records your answer, reasoning,
        confidence, and tempting-option evidence without showing correctness feedback.
      </p>
      {currentItem ? (
        <p className="sr-only" aria-live="polite">
          Current question {currentItem.item_order}
        </p>
      ) : null}
    </div>
  );
}
