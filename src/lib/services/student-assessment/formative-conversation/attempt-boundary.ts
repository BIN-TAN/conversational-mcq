import type { Prisma } from "@prisma/client";
import { resolveCanonicalAttemptLifecycle, type AttemptLifecycleSessionSnapshot } from "../attempt-lifecycle";

export function attemptAllowsConversation(session: AttemptLifecycleSessionSnapshot) {
  return resolveCanonicalAttemptLifecycle(session).canonical_status === "active";
}

// Parent first: ending an attempt and committing a conversation write must serialize.
// Never hold this lock while waiting for a provider.
export async function lockConversationAttempt(tx: Prisma.TransactionClient, conversationPublicId: string) {
  await tx.$queryRaw`
    SELECT a.id FROM assessment_sessions a
    JOIN formative_conversation_sessions c ON c.assessment_session_db_id = a.id
    WHERE c.conversation_public_id = ${conversationPublicId}
    FOR UPDATE OF a
  `;
}
