import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveOpenAIModelConfigForRole } from "../src/lib/llm/config";
import { PrismaClient } from "@prisma/client";
import {
  assert,
  cleanupSmokeStudentSessions,
  createSmokeStudent
} from "./student-mvp-smoke-helpers";
import {
  recordReasoning,
  recordConfidence,
  recordTemptingOption,
  recordSelectedOption,
  startConceptUnitInitialAdministration,
  startOrResumeStudentAssessmentSession
} from "../src/lib/services/student-assessment/service";
import {
  ITEM_ADMINISTRATION_TUTOR_AGENT_NAME,
  ITEM_ADMINISTRATION_TUTOR_SCHEMA_VERSION,
  ItemAdministrationTutorOutputSchema,
  resolveItemAdministrationTutorRuntimeMode,
  withItemAdministrationTutorProviderForTest,
  type ItemAdministrationTutorOutput
} from "../src/lib/services/student-assessment/item-administration-tutor";
import {
  withAssessmentTutorAuthCheckForTest
} from "../src/lib/llm/assessment-tutor-readiness";
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
    "I can explain that after the initial question set. For now, give your best reason, or say 'I don't know the reason yet.'",
  next_expected_action: "defer_content_question"
};

const canonicalizedContentQuestionOutput: ItemAdministrationTutorOutput = {
  message_classification: "content_question",
  response_quality: "low_information",
  should_advance: false,
  should_store_deferred_concern: true,
  deferred_concern_summary: "Asked what theta means during item administration.",
  student_facing_message:
    "I can explain that after the initial question set. For now, give your best reason, or say 'I don't know the reason yet.'",
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
  const originalCwd = process.cwd();
  const isolatedCwd = mkdtempSync(join(tmpdir(), "cmcq-injected-item-admin-"));
  process.env.ALLOW_MANUAL_REVIEW_STUDENT_STARTS = "true";
  process.env.OPERATIONAL_AGENT_MODE = "disabled";
  await ensureDemoStudentAssessment(prisma);

  const prefix = `item_admin_audit_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const teacher = await prisma.user.findUniqueOrThrow({ where: { user_id_normalized: "teacher_demo" } });
  const student = await createSmokeStudent({
    prisma,
    prefix,
    teacherDbId: teacher.id,
    accessCode: `${prefix}_access`
  });
  const sessionPublicIds: string[] = [];

  try {
    // The injected provider uses a synthetic configuration, not the developer's
    // local credentials or production approval bundle. No external calls occur.
    process.chdir(isolatedCwd);
    await withTemporaryEnv(
      {
        NODE_ENV: "development",
        ITEM_ADMIN_TUTOR_MODE: "live",
        LLM_PROVIDER: "openai",
        LLM_LIVE_CALLS_ENABLED: "true",
        OPENAI_API_KEY: "sk-synthetic-test-key-not-used-000000000000",
        OPENAI_API_KEY_FILE: "",
        OPENAI_MODEL_ITEM_ADMIN: "synthetic-item-admin-model"
      },
      async () => {
        await withAssessmentTutorAuthCheckForTest(
          async () => ({
            auth_status: "valid",
            auth_checked_at: new Date().toISOString(),
            auth_check_error_code: null,
            http_status: 200,
            provider_request_id: "synthetic_auth_check"
          }),
          async () => {
        const runtime = await resolveItemAdministrationTutorRuntimeMode();
        assert(runtime.resolved_source === "live_llm", `Injected provider runtime blocked: ${runtime.blocking_reasons.join(",")}`);
        resolveOpenAIModelConfigForRole("item_administration_tutor_agent");
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
          fallbackAudit.output.message_classification === "incomplete",
          "Invalid live output should persist a non-advancing blocked effective output."
        );
        await assertTutorProcessEvidence({
          sessionPublicId: started.session.session_public_id,
          agentCallId: fallbackAudit.call.id,
          expectedSource: "safe_block_after_live_failure",
          expectedClassification: "incomplete"
        });

        const action = { student_user_db_id: student.id, session_public_id: started.session.session_public_id,
          item_public_id: item.item_public_id };
        const incomplete: ItemAdministrationTutorOutput = { ...invalidAdvanceOutput,
          message_classification: "incomplete", response_quality: "not_usable", should_advance: false,
          next_expected_action: "ask_repair",
          student_facing_message: "Focus on whether the scores use a reference group or a predefined standard." };
        await withItemAdministrationTutorProviderForTest(new SyntheticItemAdminProvider(incomplete), async () => {
          const first = await recordReasoning({ ...action, data: { reasoning_text: "That part", client_action_id: `${prefix}_fragment_1` } });
          assert(first.state.assessment_state === "AWAIT_REASON", "Content requests and failed calls must not count as a neutral clarification.");
          const shown = await prisma.conversationTurn.findFirstOrThrow({ where: {
            assessment_session: { session_public_id: action.session_public_id }, actor_type: "agent"
          }, orderBy: { sequence_index: "desc" } });
          assert(!shown.message_text?.includes("reference group"), "Do not show provider-authored content hints.");
          const second = await recordReasoning({ ...action, data: { reasoning_text: "B", client_action_id: `${prefix}_fragment_2` } });
          assert(second.state.assessment_state === "AWAIT_CONFIDENCE", "One neutral clarification must not become an indefinite rejection loop.");
          const stored = await prisma.itemResponse.findFirstOrThrow({ where: {
            item: { item_public_id: item.item_public_id }, concept_unit_session: { assessment_session: { session_public_id: action.session_public_id } }
          } });
          assert(stored.reasoning_text === "B", "Never replace a letter response with an invented unknown-reason admission.");
          const acceptedAudit = await latestTutorCall(action.session_public_id);
          assert(acceptedAudit.output.response_quality === "weak_but_usable", "Acceptance is not a mastery judgment.");
          const raw = await prisma.agentCall.findUniqueOrThrow({ where: { id: acceptedAudit.call.id }, select: { raw_output: true } });
          assert(JSON.stringify(raw.raw_output).includes('"message_classification":"incomplete"'), "Original classification remains in audit.");
          assert(JSON.stringify(raw.raw_output).includes('"prior_neutral_clarification_count":1'), "Bounded clarification is auditable.");
        });
        await recordConfidence({ ...action, data: { confidence_rating: "medium" } });
        const alternative = item.options.find(option => option.label !== selectedOption)!.label;
        await recordTemptingOption({ ...action, data: { tempting_option: alternative } });
        const confused: ItemAdministrationTutorOutput = { ...incomplete, message_classification: "affective_expression" };
        const finished = await withItemAdministrationTutorProviderForTest(new SyntheticItemAdminProvider(confused), () =>
          recordTemptingOption({ ...action, data: { tempting_option: alternative, tempting_option_reason: "This option confused me.", client_action_id: `${prefix}_tempting_confusion` } }));
        assert(finished.state.current_item?.item_public_id !== item.item_public_id, "Accepted tempting uncertainty must open the next item.");
        const submitted = await prisma.itemResponse.findFirstOrThrow({ where: { item: { item_public_id: item.item_public_id },
          concept_unit_session: { assessment_session: { session_public_id: action.session_public_id } } } });
        assert(submitted.item_submitted_at, "Progression requires a persisted submission timestamp.");
        for (const eventType of ["item_submitted", "item_completed"]) {
          assert(await prisma.processEvent.count({ where: { assessment_session: { session_public_id: action.session_public_id },
            item: { item_public_id: item.item_public_id }, event_type: eventType } }) === 1, `${eventType} must be recorded once.`);
        }
          }
        );
      }
    );

    console.log("Student item-admin audit smoke passed. No OpenAI call was made.");
  } finally {
    process.chdir(originalCwd);
    rmSync(isolatedCwd, { recursive: true, force: true });
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
