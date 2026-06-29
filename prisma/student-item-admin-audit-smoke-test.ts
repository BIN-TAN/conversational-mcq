import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import {
  assert,
  cleanupSmokeStudentSessions,
  createSmokeStudent
} from "./student-mvp-smoke-helpers";
import {
  recordReasoning,
  recordSelectedOption,
  startConceptUnitInitialAdministration,
  startOrResumeStudentAssessmentSession
} from "../src/lib/services/student-assessment/service";
import {
  ITEM_ADMINISTRATION_TUTOR_AGENT_NAME,
  ITEM_ADMINISTRATION_TUTOR_SCHEMA_VERSION,
  ItemAdministrationTutorOutputSchema,
  withItemAdministrationTutorProviderForTest,
  type ItemAdministrationTutorOutput
} from "../src/lib/services/student-assessment/item-administration-tutor";
import {
  demoAssessmentPublicId,
  ensureDemoStudentAssessment
} from "./demo-student-assessment-fixture";
import type {
  LlmProvider,
  StructuredAgentRequest,
  StructuredAgentResult
} from "../src/lib/llm/providers/types";

const prisma = new PrismaClient();

const validContentQuestionOutput: ItemAdministrationTutorOutput = {
  message_classification: "content_question",
  response_quality: "not_usable",
  should_advance: false,
  should_store_deferred_concern: true,
  deferred_concern_summary: "Asked what theta means during item administration.",
  student_facing_message:
    "I can explain that after the three-question set. For now, give your best reason, or say 'I don't know the reason yet.'",
  next_expected_action: "defer_content_question"
};

const canonicalizedContentQuestionOutput: ItemAdministrationTutorOutput = {
  message_classification: "content_question",
  response_quality: "low_information",
  should_advance: false,
  should_store_deferred_concern: true,
  deferred_concern_summary: "Asked what theta means during item administration.",
  student_facing_message:
    "I can explain that after the three-question set. For now, give your best reason, or say 'I don't know the reason yet.'",
  next_expected_action: "defer_content_question"
};

const invalidAdvanceOutput: ItemAdministrationTutorOutput = {
  message_classification: "usable_reasoning",
  response_quality: "adequate",
  should_advance: true,
  should_store_deferred_concern: false,
  deferred_concern_summary: null,
  student_facing_message: "Thanks.",
  next_expected_action: "advance"
};

class SyntheticItemAdminProvider implements LlmProvider {
  constructor(private readonly output: ItemAdministrationTutorOutput) {}

  async executeStructured<TInput, TOutput>(
    request: StructuredAgentRequest<TInput, TOutput>
  ): Promise<StructuredAgentResult<TOutput>> {
    return {
      provider: "openai",
      client_request_id: request.client_request_id,
      provider_request_id: `synthetic_req_${randomUUID()}`,
      provider_response_id: `synthetic_resp_${randomUUID()}`,
      status: "completed",
      parsed_output: this.output as TOutput,
      raw_output: {
        id: `synthetic_resp_${randomUUID()}`,
        status: "completed",
        output_parsed: this.output,
        usage: {
          input_tokens: 12,
          output_tokens: 8,
          total_tokens: 20
        }
      },
      usage: {
        input_tokens: 12,
        output_tokens: 8,
        total_tokens: 20
      },
      latency_ms: 1
    };
  }
}

function withTemporaryEnv<T>(values: Record<string, string>, callback: () => Promise<T>) {
  const previous = Object.fromEntries(
    Object.keys(values).map((key) => [key, process.env[key]])
  );

  return callbackWithEnv(values, callback).finally(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });
}

async function callbackWithEnv<T>(values: Record<string, string>, callback: () => Promise<T>) {
  for (const [key, value] of Object.entries(values)) {
    process.env[key] = value;
  }

  return callback();
}

function expectFailure(callback: () => void) {
  try {
    callback();
  } catch {
    return;
  }

  throw new Error("Expected missing audit evidence assertion to fail.");
}

function findMatchingCallOrThrow(
  calls: Array<{ output_payload: unknown }>,
  expectedClassification: string
) {
  const call = calls.find((entry) => {
    const parsed = ItemAdministrationTutorOutputSchema.safeParse(entry.output_payload);
    return parsed.success && parsed.data.message_classification === expectedClassification;
  });

  assert(call, `Missing item-admin audit evidence for ${expectedClassification}.`);
}

async function latestTutorCall(sessionPublicId: string) {
  const call = await prisma.agentCall.findFirstOrThrow({
    where: {
      assessment_session: { session_public_id: sessionPublicId },
      agent_name: ITEM_ADMINISTRATION_TUTOR_AGENT_NAME
    },
    orderBy: [{ created_at: "desc" }],
    select: {
      id: true,
      provider: true,
      provider_request_id: true,
      provider_response_id: true,
      schema_version: true,
      output_payload: true,
      output_validated: true,
      validation_error: true,
      call_status: true,
      live_call_allowed: true
    }
  });
  const parsed = ItemAdministrationTutorOutputSchema.safeParse(call.output_payload);
  assert(parsed.success, "Item-admin audit output should be schema-shaped.");

  return { call, output: parsed.data };
}

async function assertTutorProcessEvidence(input: {
  sessionPublicId: string;
  agentCallId: string;
  expectedSource: string;
  expectedClassification: string;
}) {
  const events = await prisma.processEvent.findMany({
    where: {
      assessment_session: { session_public_id: input.sessionPublicId },
      event_category: "response_quality"
    },
    select: { payload: true }
  });
  const serialized = JSON.stringify(events.map((event) => event.payload));

  assert(serialized.includes(input.agentCallId), "Process-event evidence should link to item-admin agent call.");
  assert(
    serialized.includes(`"item_admin_tutor_source":"${input.expectedSource}"`),
    `Process-event evidence should store ${input.expectedSource}.`
  );
  assert(
    serialized.includes(`"message_classification":"${input.expectedClassification}"`),
    `Process-event evidence should store ${input.expectedClassification}.`
  );
}

async function main() {
  process.env.ALLOW_MANUAL_REVIEW_STUDENT_STARTS = "true";
  process.env.OPERATIONAL_AGENT_MODE = "disabled";
  await ensureDemoStudentAssessment(prisma);

  const prefix = `item_admin_audit_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const student = await createSmokeStudent({
    prisma,
    prefix,
    accessCode: `${prefix}_access`
  });
  const sessionPublicIds: string[] = [];

  try {
    await withTemporaryEnv(
      {
        NODE_ENV: "development",
        ITEM_ADMIN_TUTOR_MODE: "live",
        LLM_PROVIDER: "openai",
        LLM_LIVE_CALLS_ENABLED: "true",
        OPENAI_API_KEY: "synthetic-test-key-not-used",
        OPENAI_MODEL_ITEM_ADMIN: "synthetic-item-admin-model"
      },
      async () => {
        expectFailure(() => findMatchingCallOrThrow([], "content_question"));

        const started = await startOrResumeStudentAssessmentSession({
          student_user_db_id: student.id,
          assessment_public_id: demoAssessmentPublicId
        });
        sessionPublicIds.push(started.session.session_public_id);
        let state = await startConceptUnitInitialAdministration({
          student_user_db_id: student.id,
          session_public_id: started.session.session_public_id,
          concept_unit_public_id: started.state.current_concept_unit?.concept_unit_public_id ?? ""
        });
        const item = state.current_item;
        assert(item, "Expected current item for item-admin audit smoke.");
        const selectedOption = item.options[0]?.label ?? "A";

        state = (
          await recordSelectedOption({
            student_user_db_id: student.id,
            session_public_id: started.session.session_public_id,
            item_public_id: item.item_public_id,
            data: {
              selected_option: selectedOption,
              client_action_id: `${prefix}_answer`
            }
          })
        ).state;
        assert(state.assessment_state === "AWAIT_REASON", "Answer should advance to reasoning.");

        state = await withItemAdministrationTutorProviderForTest(
          new SyntheticItemAdminProvider(validContentQuestionOutput),
          async () => (
            await recordReasoning({
              student_user_db_id: student.id,
              session_public_id: started.session.session_public_id,
              item_public_id: item.item_public_id,
              data: {
                reasoning_text: "What is theta?",
                client_action_id: `${prefix}_valid_content_question`
              }
            })
          ).state
        );
        assert(state.assessment_state === "AWAIT_REASON", "Content question should not advance.");
        const liveAudit = await latestTutorCall(started.session.session_public_id);
        assert(liveAudit.call.provider === "openai", "Simulated live call should be audited as OpenAI.");
        assert(liveAudit.call.call_status === "succeeded", "Valid simulated live output should succeed.");
        assert(liveAudit.call.output_validated, "Valid simulated live output should validate.");
        assert(!liveAudit.call.validation_error, "Valid simulated live output should not store validation error.");
        assert(liveAudit.call.live_call_allowed, "Live audit should store live_call_allowed=true.");
        assert(liveAudit.call.schema_version === ITEM_ADMINISTRATION_TUTOR_SCHEMA_VERSION, "Schema version mismatch.");
        assert(
          Boolean(liveAudit.call.provider_request_id || liveAudit.call.provider_response_id),
          "Simulated live audit should persist provider metadata."
        );
        assert(liveAudit.output.message_classification === "content_question", "Live output classification mismatch.");
        assert(
          liveAudit.output.response_quality === "not_usable",
          "Content-question live output should be canonicalized to not_usable."
        );
        await assertTutorProcessEvidence({
          sessionPublicId: started.session.session_public_id,
          agentCallId: liveAudit.call.id,
          expectedSource: "live_llm",
          expectedClassification: "content_question"
        });

        state = await withItemAdministrationTutorProviderForTest(
          new SyntheticItemAdminProvider(canonicalizedContentQuestionOutput),
          async () => (
            await recordReasoning({
              student_user_db_id: student.id,
              session_public_id: started.session.session_public_id,
              item_public_id: item.item_public_id,
              data: {
                reasoning_text: "What is theta?",
                client_action_id: `${prefix}_canonicalized_content_question`
              }
            })
          ).state
        );
        assert(state.assessment_state === "AWAIT_REASON", "Canonicalized content question should not advance.");
        const canonicalizedAudit = await latestTutorCall(started.session.session_public_id);
        assert(canonicalizedAudit.call.provider === "openai", "Canonicalized simulated call should be audited as OpenAI.");
        assert(
          canonicalizedAudit.call.call_status === "succeeded",
          "Canonicalized simulated live output should succeed."
        );
        assert(canonicalizedAudit.call.output_validated, "Canonicalized simulated live output should validate.");
        assert(!canonicalizedAudit.call.validation_error, "Canonicalized live output should not store validation error.");
        assert(
          Boolean(canonicalizedAudit.call.provider_request_id || canonicalizedAudit.call.provider_response_id),
          "Canonicalized live audit should persist provider metadata."
        );
        assert(
          canonicalizedAudit.output.response_quality === "not_usable",
          "Content-question live output needing canonicalization should persist not_usable."
        );
        await assertTutorProcessEvidence({
          sessionPublicId: started.session.session_public_id,
          agentCallId: canonicalizedAudit.call.id,
          expectedSource: "live_llm",
          expectedClassification: "content_question"
        });

        state = await withItemAdministrationTutorProviderForTest(
          new SyntheticItemAdminProvider(invalidAdvanceOutput),
          async () => (
            await recordReasoning({
              student_user_db_id: student.id,
              session_public_id: started.session.session_public_id,
              item_public_id: item.item_public_id,
              data: {
                reasoning_text: "What is theta?",
                client_action_id: `${prefix}_fallback_content_question`
              }
            })
          ).state
        );
        assert(state.assessment_state === "AWAIT_REASON", "Fallback content question should not advance.");
        const fallbackAudit = await latestTutorCall(started.session.session_public_id);
        assert(fallbackAudit.call.call_status === "invalid_output", "Invalid live output should be audited honestly.");
        assert(!fallbackAudit.call.output_validated, "Invalid live output should not be marked validated.");
        assert(fallbackAudit.call.validation_error, "Invalid live output should preserve validation error.");
        assert(
          fallbackAudit.output.message_classification === "content_question",
          "Effective fallback output should classify content question."
        );
        await assertTutorProcessEvidence({
          sessionPublicId: started.session.session_public_id,
          agentCallId: fallbackAudit.call.id,
          expectedSource: "safe_fallback_after_live_failure",
          expectedClassification: "content_question"
        });
      }
    );

    console.log("Student item-admin audit smoke passed. No OpenAI call was made.");
  } finally {
    await cleanupSmokeStudentSessions({
      prisma,
      userDbId: student.id,
      sessionPublicIds
    });
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exitCode = 1;
});
