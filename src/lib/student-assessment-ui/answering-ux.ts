/**
 * Display-only helpers for the student mini-test path. Nothing here changes what is
 * stored or recorded: stored turn texts, response content and process events stay as
 * they are; these functions only decide what the student sees and where focus goes.
 */

/**
 * Stored item-presentation turns begin with "Item N of M". The live question card says
 * "Question N of M", so the history bubble shows the same words. The stored text is unchanged.
 */
export function displayQuestionPositionLabel(text: string): string {
  return text.replace(/^Item (\d+) of (\d+)(?=\r?\n|$)/, "Question $1 of $2");
}

/**
 * Local draft identity for a written answer: the question and the stage only (the field
 * name is added by the caller). Changing the answer or the tempting option no longer
 * discards a reason the student is still typing. Drafts live in this browser tab only
 * (sessionStorage) and are never sent or recorded.
 */
export function studentDraftIdentity(item: { item_public_id: string } | null | undefined): string | null {
  return item?.item_public_id ?? null;
}

/**
 * Error codes that mean "the attempt has already moved past this step" (another tab,
 * a double click, or a reply that arrived after a timeout). Replaying the same request
 * would fail again, so the page reloads where the student left off instead.
 */
const STALE_STEP_ERROR_CODES = new Set([
  "invalid_phase_for_action",
  "item_not_in_current_concept_unit",
  "concept_unit_not_current",
  "concept_no_longer_current",
  "initial_response_locked_after_concept_completion",
  "item_not_included_in_published_set",
  "package_completion_conflict",
  "assessment_already_completed",
  "idempotency_conflict"
]);

export function isStaleStepError(error: { code?: string; status?: number } | null | undefined): boolean {
  if (!error?.code) return false;
  if (error.code === "conflict") return error.status === 409;
  return STALE_STEP_ERROR_CODES.has(error.code) && (error.status === undefined || error.status === 409);
}

export const STALE_STEP_NOTICE = "This step was already saved. Here is where you left off.";
export const STALE_STEP_REFRESH_FAILED_NOTICE =
  "Something changed since this page loaded. Select Try again to see where you left off.";

/** One plain sentence for a stale step, chosen from the state that was read back. */
export function staleStepNotice(refreshed?: { terminal?: boolean; paused?: boolean } | null): string {
  if (refreshed === null) return STALE_STEP_REFRESH_FAILED_NOTICE;
  if (refreshed?.terminal) return "This attempt has already ended. Your answers are saved.";
  if (refreshed?.paused) return "This attempt is paused. Select \"Resume attempt\" to continue.";
  return STALE_STEP_NOTICE;
}

/** The step the student is on; a result with the same key keeps them on the same step. */
export function answeringStageKey(state: {
  assessment_state?: string | null;
  current_item?: { item_public_id: string } | null;
} | null | undefined): string {
  return `${state?.assessment_state ?? ""}:${state?.current_item?.item_public_id ?? ""}`;
}

/** The first usable control of the active step (option, textarea or button). */
export const STAGE_FIRST_CONTROL_SELECTOR =
  "textarea:not(:disabled), button:not(:disabled), [tabindex='0']";

/**
 * Restore focus only when it was lost: nothing is focused, or the focused control sits in
 * the active step but cannot be used. Focus the student moved elsewhere is left alone.
 */
export function shouldRestoreStageFocus(input: {
  activeIsBody: boolean;
  activeInsideStage: boolean;
  activeUsable: boolean;
}): boolean {
  if (input.activeIsBody) return true;
  return input.activeInsideStage && !input.activeUsable;
}
