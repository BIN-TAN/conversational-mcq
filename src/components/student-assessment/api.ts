"use client";

import {
  AvailableAssessmentsResponseSchema,
  ApiErrorSchema,
  StartSessionResponseSchema,
  StudentReviewResponseSchema,
  StudentSessionStateSchema,
  StudentTranscriptResponseSchema,
  type AvailableAssessmentsResponse,
  type ConfidenceRating,
  type StartSessionResponse,
  type StructuredStudentApiError,
  type StudentReviewResponse,
  type StudentSessionState,
  type StudentTranscriptResponse
} from "@/lib/student-assessment-ui/types";

export type FrontendProcessEvent = {
  event_type:
    | "page_hidden"
    | "page_visible"
    | "long_pause"
    | "inactivity_detected"
    | "navigation_event"
    | "refresh_recovery";
  event_category?: string;
  item_public_id?: string;
  visibility_duration_ms?: number;
  pause_duration_ms?: number;
  client_occurred_at?: string;
  payload?: Record<string, unknown>;
};

type StudentFollowupApiState = {
  session_public_id: string;
  current_phase: string;
  followup: {
    round_index: number;
    status: string;
    started_at: string | null;
    completed_at: string | null;
    turns: Array<{
      actor: "student" | "assistant";
      message_text: string;
      created_at: string | null;
    }>;
    can_send: boolean;
    can_stop: boolean;
    can_save_exit: boolean;
    message_max_chars: number;
  } | null;
  progression?: StudentSessionState["progression"];
};

export function newClientActionId(prefix: string) {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  return `${prefix}-${random}`;
}

async function parseResponse<T>(
  response: Response,
  parse: (value: unknown) => T
): Promise<T> {
  const text = await response.text();
  const json = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw normalizeStudentApiError(json, response.status);
  }

  return parse(json);
}

export function normalizeStudentApiError(
  value: unknown,
  status = 500
): StructuredStudentApiError {
  const parsed = ApiErrorSchema.safeParse(value);

  if (!parsed.success) {
    return {
      code: "request_failed",
      message: "The request could not be completed.",
      status
    };
  }

  if (typeof parsed.data.error === "string") {
    return {
      code: status === 401 ? "unauthorized" : "request_failed",
      message: parsed.data.error,
      status
    };
  }

  return {
    code: parsed.data.error.code,
    message: parsed.data.error.message,
    details: parsed.data.error.details,
    status
  };
}

async function get<T>(path: string, parse: (value: unknown) => T) {
  const response = await fetch(path, {
    method: "GET",
    headers: { Accept: "application/json" }
  });

  return parseResponse(response, parse);
}

async function post<T>(
  path: string,
  body: Record<string, unknown>,
  parse: (value: unknown) => T
) {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  return parseResponse(response, parse);
}

export function fetchAvailableAssessments(): Promise<AvailableAssessmentsResponse> {
  return get("/api/student/assessments/available", (value) =>
    AvailableAssessmentsResponseSchema.parse(value)
  );
}

export function startAssessmentSession(
  assessmentPublicId: string
): Promise<StartSessionResponse> {
  return post(
    `/api/student/assessments/${assessmentPublicId}/sessions/start`,
    {},
    (value) => StartSessionResponseSchema.parse(value)
  );
}

export function fetchSessionState(sessionPublicId: string): Promise<StudentSessionState> {
  return get(`/api/student/sessions/${sessionPublicId}/state`, (value) =>
    StudentSessionStateSchema.parse(value)
  );
}

export function fetchStudentTranscript(
  sessionPublicId: string
): Promise<StudentTranscriptResponse> {
  return get(`/api/student/sessions/${sessionPublicId}/transcript`, (value) =>
    StudentTranscriptResponseSchema.parse(value)
  );
}

export function fetchStudentReview(sessionPublicId: string): Promise<StudentReviewResponse> {
  return get(`/api/student/sessions/${sessionPublicId}/review`, (value) =>
    StudentReviewResponseSchema.parse(value)
  );
}

export function beginConceptUnit(
  sessionPublicId: string,
  conceptUnitPublicId: string
): Promise<StudentSessionState> {
  return post(
    `/api/student/sessions/${sessionPublicId}/concept-units/${conceptUnitPublicId}/start`,
    {},
    (value) => StudentSessionStateSchema.parse(value)
  );
}

export function saveOption(input: {
  sessionPublicId: string;
  itemPublicId: string;
  selectedOption: string;
}) {
  return post(
    `/api/student/sessions/${input.sessionPublicId}/items/${input.itemPublicId}/option`,
    {
      selected_option: input.selectedOption,
      client_action_id: newClientActionId("option")
    },
    (value) => StudentSessionStateSchema.parse((value as { state: unknown }).state)
  );
}

export function saveReasoning(input: {
  sessionPublicId: string;
  itemPublicId: string;
  reasoningText: string;
}) {
  return post(
    `/api/student/sessions/${input.sessionPublicId}/items/${input.itemPublicId}/reasoning`,
    {
      reasoning_text: input.reasoningText,
      client_action_id: newClientActionId("reasoning")
    },
    (value) => StudentSessionStateSchema.parse((value as { state: unknown }).state)
  );
}

export function saveConfidence(input: {
  sessionPublicId: string;
  itemPublicId: string;
  confidenceRating: ConfidenceRating;
}) {
  return post(
    `/api/student/sessions/${input.sessionPublicId}/items/${input.itemPublicId}/confidence`,
    {
      confidence_rating: input.confidenceRating,
      client_action_id: newClientActionId("confidence")
    },
    (value) => StudentSessionStateSchema.parse((value as { state: unknown }).state)
  );
}

export function saveTemptingOption(input: {
  sessionPublicId: string;
  itemPublicId: string;
  temptingOption?: string | null;
  temptingOptionReason?: string | null;
  noTemptingOption?: boolean;
}) {
  return post(
    `/api/student/sessions/${input.sessionPublicId}/items/${input.itemPublicId}/tempting-option`,
    {
      tempting_option: input.temptingOption ?? null,
      tempting_option_reason: input.temptingOptionReason ?? null,
      no_tempting_option: Boolean(input.noTemptingOption),
      client_action_id: newClientActionId("tempting-option")
    },
    (value) => StudentSessionStateSchema.parse((value as { state: unknown }).state)
  );
}

export function updatePackageReviewItem(input: {
  sessionPublicId: string;
  itemPublicId: string;
  selectedOption: string;
  reasoningText: string;
  confidenceRating: ConfidenceRating;
  noTemptingOption: boolean;
  temptingOption?: string | null;
  temptingOptionReason?: string | null;
}) {
  return post(
    `/api/student/sessions/${input.sessionPublicId}/items/${input.itemPublicId}/package-review-edit`,
    {
      selected_option: input.selectedOption,
      reasoning_text: input.reasoningText,
      confidence_rating: input.confidenceRating,
      no_tempting_option: input.noTemptingOption,
      tempting_option: input.temptingOption ?? null,
      tempting_option_reason: input.temptingOptionReason ?? null,
      client_action_id: newClientActionId("package-review-edit")
    },
    (value) => StudentSessionStateSchema.parse((value as { state: unknown }).state)
  );
}

export function updateInFlowItem(input: {
  sessionPublicId: string;
  itemPublicId: string;
  selectedOption?: string;
  reasoningText?: string;
  confidenceRating?: ConfidenceRating;
  noTemptingOption?: boolean;
  temptingOption?: string | null;
  temptingOptionReason?: string | null;
}) {
  return post(
    `/api/student/sessions/${input.sessionPublicId}/items/${input.itemPublicId}/edit`,
    {
      selected_option: input.selectedOption,
      reasoning_text: input.reasoningText,
      confidence_rating: input.confidenceRating,
      no_tempting_option: input.noTemptingOption,
      tempting_option: input.temptingOption,
      tempting_option_reason: input.temptingOptionReason,
      client_action_id: newClientActionId("in-flow-edit")
    },
    (value) => StudentSessionStateSchema.parse((value as { state: unknown }).state)
  );
}

export async function submitItem(input: {
  sessionPublicId: string;
  itemPublicId: string;
  confirmSkip?: boolean;
  skipItem?: boolean;
  skipReasoning?: boolean;
  skipConfidence?: boolean;
}) {
  const result = await post(
    `/api/student/sessions/${input.sessionPublicId}/items/${input.itemPublicId}/submit`,
    {
      confirm_skip: Boolean(input.confirmSkip),
      skip_item: Boolean(input.skipItem),
      skip_reasoning: Boolean(input.skipReasoning),
      skip_confidence: Boolean(input.skipConfidence),
      client_action_id: newClientActionId("submit")
    },
    (value) => value as { submission_status: string; missing_fields?: string[]; state: unknown }
  );

  return {
    submission_status: result.submission_status,
    missing_fields: result.missing_fields ?? [],
    state: StudentSessionStateSchema.parse(result.state)
  };
}

export function completeInitialConceptUnit(input: {
  sessionPublicId: string;
  conceptUnitPublicId: string;
}) {
  return post(
    `/api/student/sessions/${input.sessionPublicId}/concept-units/${input.conceptUnitPublicId}/complete-initial`,
    {},
    (value) => StudentSessionStateSchema.parse((value as { state: unknown }).state)
  );
}

export function exitSession(sessionPublicId: string) {
  return post(
    `/api/student/sessions/${sessionPublicId}/exit`,
    {},
    (value) => value as { exit_status: string; can_resume: boolean }
  );
}

export function sendFollowupMessage(input: {
  sessionPublicId: string;
  message: string;
  clientMessageId?: string;
}) {
  return post(
    `/api/student/sessions/${input.sessionPublicId}/followup/messages`,
    {
      message: input.message,
      client_message_id: input.clientMessageId ?? newClientActionId("followup-message")
    },
    (value) =>
      value as {
        message_status: string;
        assistant_message: string | null;
        student_safe_message?: string;
        state: StudentFollowupApiState;
      }
  );
}

export function sendFormativeActivityResponse(input: {
  sessionPublicId: string;
  message: string;
  clientMessageId?: string;
}) {
  return post(
    `/api/student/sessions/${input.sessionPublicId}/formative-activity/response`,
    {
      message: input.message,
      client_message_id: input.clientMessageId ?? newClientActionId("formative-activity")
    },
    (value) => {
      const result = value as {
        message_status: string;
        targeted_feedback_available: boolean;
        state: unknown;
      };

      return {
        message_status: result.message_status,
        targeted_feedback_available: result.targeted_feedback_available,
        state: StudentSessionStateSchema.parse(result.state)
      };
    }
  );
}

export function sendRevisionResponse(input: {
  sessionPublicId: string;
  message: string;
  clientMessageId?: string;
}) {
  return post(
    `/api/student/sessions/${input.sessionPublicId}/revision/response`,
    {
      message: input.message,
      client_message_id: input.clientMessageId ?? newClientActionId("revision")
    },
    (value) => {
      const result = value as {
        revision_status: string;
        next_choice_available: boolean;
        state: unknown;
      };

      return {
        revision_status: result.revision_status,
        next_choice_available: result.next_choice_available,
        state: StudentSessionStateSchema.parse(result.state)
      };
    }
  );
}

export function selectNextChoice(input: {
  sessionPublicId: string;
  choice: "move_next" | "try_another";
  clientActionId?: string;
}) {
  return post(
    `/api/student/sessions/${input.sessionPublicId}/next-choice`,
    {
      choice: input.choice,
      client_action_id: input.clientActionId ?? newClientActionId(`next-choice-${input.choice}`)
    },
    (value) => {
      const result = value as {
        choice_status: string;
        message?: string;
        state: unknown;
      };

      return {
        choice_status: result.choice_status,
        message: result.message,
        state: StudentSessionStateSchema.parse(result.state)
      };
    }
  );
}

export function sendInitialMessage(input: {
  sessionPublicId: string;
  message: string;
  clientMessageId?: string;
}) {
  return post(
    `/api/student/sessions/${input.sessionPublicId}/initial/messages`,
    {
      message: input.message,
      client_message_id: input.clientMessageId ?? newClientActionId("initial-message")
    },
    (value) => {
      const result = value as {
        message_status: string;
        assistant_message: string;
        reasoning_saved: boolean;
        state: unknown;
      };

      return {
        message_status: result.message_status,
        assistant_message: result.assistant_message,
        reasoning_saved: result.reasoning_saved,
        state: StudentSessionStateSchema.parse(result.state)
      };
    }
  );
}

export function stopFollowup(sessionPublicId: string) {
  return post(
    `/api/student/sessions/${sessionPublicId}/followup/stop`,
    {},
    (value) => value as { stop_status: string; state: StudentFollowupApiState }
  );
}

export function requestProgression(sessionPublicId: string) {
  return post(
    `/api/student/sessions/${sessionPublicId}/progression/request`,
    {
      client_action_id: newClientActionId("progression-request")
    },
    (value) => value as { request_status: string; progression: StudentSessionState["progression"] }
  );
}

export function chooseProgression(input: {
  sessionPublicId: string;
  progressionPublicId: string;
  choice:
    | "continue_current_concept"
    | "next_concept"
    | "stay_in_final_concept"
    | "complete_assessment";
}) {
  return post(
    `/api/student/sessions/${input.sessionPublicId}/progression/${input.progressionPublicId}/choice`,
    {
      choice: input.choice,
      client_action_id: newClientActionId(`progression-${input.choice}`)
    },
    (value) =>
      value as {
        choice_status: string;
        progression: StudentSessionState["progression"];
      }
  );
}

export function sendProcessEvents(
  sessionPublicId: string,
  events: FrontendProcessEvent[],
  useBeacon = false
) {
  if (events.length === 0) {
    return Promise.resolve();
  }

  const body = JSON.stringify({ events });
  const path = `/api/student/sessions/${sessionPublicId}/events`;

  if (useBeacon && typeof navigator !== "undefined" && "sendBeacon" in navigator) {
    const blob = new Blob([body], { type: "application/json" });
    navigator.sendBeacon(path, blob);
    return Promise.resolve();
  }

  return fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true
  }).then(() => undefined);
}
