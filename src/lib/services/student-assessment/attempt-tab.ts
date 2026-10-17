import { z } from "zod";
import { prisma } from "@/lib/db";
import { logProcessEvent } from "@/lib/services/process-events";
import { StudentAssessmentServiceError } from "./errors";

/**
 * D11 (docs/DESIGN_ALIGNMENT_2026-10-17.md): one active browser tab per attempt.
 *
 * Opening an attempt claims it for that browser tab (a new tab, window, browser or
 * device, or a reload, claims it again). Saving requests carry the tab's claim in the
 * ATTEMPT_TAB_HEADER header; a request from a tab that is no longer the latest
 * claimant is refused with ATTEMPT_OPEN_ELSEWHERE_CODE, so an old tab cannot
 * overwrite work saved in a newer one. Requests without the header (older clients,
 * scripts and tests) are not checked. Each claim is recorded as an
 * "attempt_tab_claimed" process event, which also documents multi-tab use for research.
 */
export const ATTEMPT_TAB_HEADER = "x-cmcq-attempt-tab";
export const ATTEMPT_TAB_CLAIM_EVENT = "attempt_tab_claimed" as const;
export const ATTEMPT_SAVE_REFUSED_EVENT = "attempt_save_refused_other_tab" as const;
export const ATTEMPT_OPEN_ELSEWHERE_CODE = "attempt_open_elsewhere";
export const ATTEMPT_OPEN_ELSEWHERE_MESSAGE =
  "This attempt is now open in another tab or browser. Continue there, or choose \"Use this tab\" to continue here.";

const BrowserTabIdSchema = z.string().uuid();

/** Header value: "<session_public_id> <browser_tab_id>". */
export function formatAttemptTabHeader(sessionPublicId: string, browserTabId: string) {
  return `${sessionPublicId} ${browserTabId}`;
}

export function parseAttemptTabHeader(value: string | null | undefined) {
  if (!value) return null;
  const [sessionPublicId, browserTabId, extra] = value.trim().split(/\s+/);
  if (!sessionPublicId || !browserTabId || extra !== undefined || sessionPublicId.length > 200) return null;
  const tab = BrowserTabIdSchema.safeParse(browserTabId);
  return tab.success ? { session_public_id: sessionPublicId, browser_tab_id: tab.data } : null;
}

async function ownedSessionId(studentUserDbId: string, sessionPublicId: string) {
  const session = await prisma.assessmentSession.findFirst({
    where: { session_public_id: sessionPublicId, user_db_id: studentUserDbId },
    select: { id: true }
  });
  return session?.id ?? null;
}

export async function latestAttemptTabClaim(assessmentSessionDbId: string) {
  const claim = await prisma.processEvent.findFirst({
    where: { assessment_session_db_id: assessmentSessionDbId, event_type: ATTEMPT_TAB_CLAIM_EVENT },
    orderBy: [{ occurred_at: "desc" }, { created_at: "desc" }],
    select: { payload: true }
  });
  const payload = claim?.payload;
  const tabId = payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>).browser_tab_id
    : null;
  return typeof tabId === "string" ? tabId : null;
}

export async function claimAttemptTab(input: {
  student_user_db_id: string;
  session_public_id: string;
  browser_tab_id: unknown;
}) {
  const browserTabId = BrowserTabIdSchema.parse(input.browser_tab_id);
  const sessionDbId = await ownedSessionId(input.student_user_db_id, input.session_public_id);
  if (!sessionDbId) {
    throw new StudentAssessmentServiceError("not_found", "Session was not found.", 404);
  }
  const previous = await latestAttemptTabClaim(sessionDbId);
  if (previous !== browserTabId) {
    await logProcessEvent({
      assessment_session_db_id: sessionDbId,
      event_type: ATTEMPT_TAB_CLAIM_EVENT,
      event_category: "attempt_integrity",
      event_source: "backend",
      payload: { browser_tab_id: browserTabId, replaced_other_tab: previous !== null }
    });
  }
  return { browser_tab_id: browserTabId, current: true, replaced_other_tab: previous !== null && previous !== browserTabId };
}

export async function attemptTabStatus(input: {
  student_user_db_id: string;
  session_public_id: string;
  browser_tab_id: unknown;
}) {
  const browserTabId = BrowserTabIdSchema.parse(input.browser_tab_id);
  const sessionDbId = await ownedSessionId(input.student_user_db_id, input.session_public_id);
  if (!sessionDbId) {
    throw new StudentAssessmentServiceError("not_found", "Session was not found.", 404);
  }
  const latest = await latestAttemptTabClaim(sessionDbId);
  return { current: latest === null || latest === browserTabId };
}

/**
 * Returns false only when the header names a session this student owns whose latest
 * claim belongs to a different tab. Missing or malformed headers are not checked.
 */
export async function attemptTabHeaderIsCurrent(studentUserDbId: string, headerValue: string | null | undefined) {
  const parsed = parseAttemptTabHeader(headerValue);
  if (!parsed) return true;
  const sessionDbId = await ownedSessionId(studentUserDbId, parsed.session_public_id);
  if (!sessionDbId) return true;
  const latest = await latestAttemptTabClaim(sessionDbId);
  const current = latest === null || latest === parsed.browser_tab_id;
  if (!current) {
    // Research record of a refused save (multi-tab conflict or a reload whose claim
    // had not arrived yet). Best effort: logging never changes the refusal.
    try {
      await logProcessEvent({
        assessment_session_db_id: sessionDbId,
        event_type: ATTEMPT_SAVE_REFUSED_EVENT,
        event_category: "attempt_integrity",
        event_source: "backend",
        payload: { browser_tab_id: parsed.browser_tab_id }
      });
    } catch {
      // ignore
    }
  }
  return current;
}
