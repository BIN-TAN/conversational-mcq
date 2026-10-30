import type { Prisma } from "@prisma/client";
import { INTERPRETATION_RELABEL_INVOCATION_PREFIX } from "@/lib/services/student-assessment/interpretation-v8/contract";

/**
 * Model calls made by the instructor's one-time reinterpretation (release 27) are saved with the
 * attempt they reinterpret, so that deleting the attempt also deletes them. They are not part of
 * what happened during the attempt: attempt process data (call and token counts, retries, timing,
 * the context given to later attempts) leave them out with this filter. The interpretation v8
 * research tables and the AI call audit keep them, marked as reinterpretation.
 *
 * A null key is kept explicitly: NOT (key LIKE 'prefix%') is not true for a null key in SQL.
 */
export const attemptAgentCallWhere: Prisma.AgentCallWhereInput = {
  OR: [
    { agent_invocation_key: null },
    { NOT: { agent_invocation_key: { startsWith: INTERPRETATION_RELABEL_INVOCATION_PREFIX } } }
  ]
};

export function isReinterpretationCall(agentInvocationKey: string | null | undefined) {
  return typeof agentInvocationKey === "string" && agentInvocationKey.startsWith(INTERPRETATION_RELABEL_INVOCATION_PREFIX);
}

/**
 * True for a profile saved by the one-time reinterpretation (its stored interpretation carries a
 * relabel record). Such a profile is read only by instructor views and exports, through the
 * attempt's applied-reinterpretation pointer; everything the student sees or that drives the
 * attempt (answer review, conversation, context for later turns) leaves it out.
 */
export function isReinterpretationProfile(itemLevelEvidence: unknown) {
  if (!itemLevelEvidence || typeof itemLevelEvidence !== "object" || Array.isArray(itemLevelEvidence)) return false;
  const relabel = (itemLevelEvidence as Record<string, unknown>).relabel;
  return Boolean(relabel && typeof relabel === "object");
}
