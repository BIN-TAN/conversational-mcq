import assert from "node:assert/strict";
import type { Prisma } from "@prisma/client";
import { canFinishConversationAssessment } from "../src/lib/services/student-assessment/formative-conversation/finish-assessment";
import { v18r2TestContext } from "./formative-conversation-v18r2-test-fixtures";

const reason = "platform_turn_limit_after_tutor_reply:final_allowed_turn_reply_recorded";
const context = v18r2TestContext({ student_turn_count: 30, max_student_turns: 30,
  student_messages: Array.from({ length: 30 }, () => "I still need help. Please give a short recap.") });
const latestStudent = context.visible_transcript.at(-1)!;
const reply = "Here is the requested recap. Your remaining questions are still recorded.";
function fixture() {
  return {
    topics: [{ id: "topic" }],
    units: [{ initial_completed_at: new Date("2026-10-14T00:00:00Z"), response_packages: [{ id: "sealed-package" }],
      formative_conversation_session: {
        id: "conversation-db", conversation_public_id: context.conversation_public_id,
        status: "ended", lifecycle_reason: reason, last_processed_turn_sequence: latestStudent.sequence_index + 1,
        message_receipts: [{ id: "receipt", status: "assistant_turn_persisted", student_turn_db_id: "student-turn",
          assistant_turn_db_id: "tutor-turn", assistant_response_status: "completed" }],
        conversation_turns: [
          { id: "student-turn", actor_type: "student", sequence_index: latestStudent.sequence_index, message_text: latestStudent.message_text },
          { id: "tutor-turn", actor_type: "agent", sequence_index: latestStudent.sequence_index + 1, message_text: reply }
        ]
      } }],
    call: { input_payload: structuredClone(context), output_payload: {
      student_visible_message: reply, profile_transition_recommendation: null,
      teacher_assistance_recommendation: { recommended: false },
      conversation_review: { closure: { reason: "turn_limit", unresolved_need_ids: ["still-needs-help"] } }
    } }
  };
}
type Fixture = ReturnType<typeof fixture>;
let checks = 0;
async function verify(name: string, expected: boolean, change: (f: Fixture) => void = () => {}) {
  const data = fixture();
  change(data);
  const original = structuredClone(data);
  let callReads = 0;
  const db = {
    conceptUnit: { findMany: async () => data.topics },
    conceptUnitSession: { findMany: async () => data.units },
    conversationTurn: { findMany: async (query: { take: number }) => {
      assert.equal(query.take, 2, "only the final pair may fetch message text");
      return [...data.units[0].formative_conversation_session.conversation_turns]
        .sort((a, b) => b.sequence_index - a.sequence_index).slice(0, query.take);
    } },
    agentCall: { findFirst: async (query: { where: Record<string, unknown> }) => {
      callReads++;
      assert.deepEqual(query.where, { formative_conversation_session_db_id: "conversation-db",
        formative_conversation_message_receipt_db_id: "receipt", agent_name: "formative_conversation_agent",
        call_status: "succeeded", output_validated: true });
      return data.call;
    } }
  } as unknown as Prisma.TransactionClient;
  assert.equal(await canFinishConversationAssessment("session", "assessment", db), expected, name);
  assert.deepEqual(data, original, `${name}: eligibility must not rewrite profiles, needs, calls or lifecycle`);
  checks++;
  return callReads;
}
async function main() {
  await verify("saved final reply permits explicit Finish despite unresolved needs and null profile", true);
  await verify("active conversation still blocked", false, f => { f.units[0].formative_conversation_session.status = "active"; });
  await verify("paused conversation still blocked", false, f => { f.units[0].formative_conversation_session.status = "paused"; });
  await verify("every published topic required", false, f => { f.topics.push({ id: "other-topic" }); });
  await verify("no published topic cannot finish", false, f => { f.topics = []; f.units = []; });
  await verify("sealed package required", false, f => { f.units[0].response_packages = []; });
  await verify("initial administration required", false, f => { Reflect.set(f.units[0], "initial_completed_at", null); });
  for (const failure of ["platform_provider_failure", "platform_turn_limit_guard:failed", "platform_turn_limit_after_tutor_reply",
    `${reason}:unverified`, "platform_turn_limit_after_tutor_reply:assistant_response_failed"]) {
    const reads = await verify(`platform failure/partial reason ${failure} blocked`, false,
      f => { f.units[0].formative_conversation_session.lifecycle_reason = failure; });
    assert.equal(reads, 0);
  }
  for (const status of ["pending", "failed", "blocked"]) {
    await verify(`unsaved response ${status} blocked`, false, f => {
      f.units[0].formative_conversation_session.message_receipts[0].assistant_response_status = status;
    });
  }
  await verify("receipt must be persisted", false, f => { f.units[0].formative_conversation_session.message_receipts[0].status = "reserved"; });
  await verify("missing receipt blocked", false, f => { f.units[0].formative_conversation_session.message_receipts = []; });
  await verify("receipt cannot reference a different saved tutor", false, f => {
    f.units[0].formative_conversation_session.message_receipts[0].assistant_turn_db_id = "older-tutor";
  });
  await verify("receipt must bind latest student", false, f => {
    f.units[0].formative_conversation_session.message_receipts[0].student_turn_db_id = "older-student";
  });
  await verify("unanswered later student turn blocked", false, f => {
    f.units[0].formative_conversation_session.conversation_turns.push({ id: "new-student", actor_type: "student",
      sequence_index: latestStudent.sequence_index + 2, message_text: "Unanswered." });
  });
  await verify("last processed sequence must match final reply", false, f => { f.units[0].formative_conversation_session.last_processed_turn_sequence--; });
  await verify("no linked accepted call blocked", false, f => { Reflect.set(f, "call", null); });
  await verify("malformed original context blocked", false, f => { Reflect.set(f.call, "input_payload", {}); });
  await verify("ordinary earlier call not sufficient", false, f => { f.call.input_payload.formative_lifecycle.final_allowed_turn = false; });
  await verify("call from other conversation blocked", false, f => { f.call.input_payload.conversation_public_id = "another-conversation"; });
  await verify("different source student text blocked", false, f => { f.call.input_payload.visible_transcript.at(-1)!.message_text = "Different request."; });
  await verify("different source student sequence blocked", false, f => { f.call.input_payload.visible_transcript.at(-1)!.sequence_index--; });
  await verify("changed saved output blocked", false, f => { f.call.output_payload.student_visible_message = "Another reply."; });
  await verify("missing output blocked", false, f => { Reflect.set(f.call, "output_payload", null); });
  const legacyReads = await verify("ordinary student closure retains existing completion behavior", true,
    f => { f.units[0].formative_conversation_session.lifecycle_reason = "student_request:ended"; });
  assert.equal(legacyReads, 0, "historical student closure must not require a current final-turn contract");
  console.log(JSON.stringify({ status: "passed", checks, provider_calls: 0, database_writes: 0,
    scope: "Finish eligibility through the production service with isolated repository effects; no mastery or profile mutation." }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
