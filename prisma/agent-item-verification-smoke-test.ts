import { PrismaClient } from "@prisma/client";
import { AgentName } from "../src/lib/agents/names";
import { ItemVerificationIssueCode } from "../src/lib/agents/contracts";
import {
  acknowledgeItemVerificationWarnings,
  buildCurrentItemVerificationContext,
  runConceptUnitVerification
} from "../src/lib/agents/item-verification/service";
import { validateConceptUnitPublishable } from "../src/lib/services/content/publishing";
import {
  cleanupItemVerificationFixture,
  createItemVerificationFixture
} from "./item-verification-smoke-fixture";
import itemVerificationCases from "../tests/fixtures/item-verification-cases.json";

const prisma = new PrismaClient();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function assertNoRewritePayload(value: unknown) {
  const text = JSON.stringify(value).toLowerCase();
  const forbidden = [
    "suggested_stem",
    "suggested_options",
    "suggested_correct_option",
    "generated_item",
    "rewritten_item",
    "rewrite as",
    "replace with"
  ];

  for (const key of forbidden) {
    assert(!text.includes(key), `Verification payload contained prohibited generation text: ${key}`);
  }
}

function collectIssueCodes(value: unknown) {
  const payload = value as {
    verification?: {
      output?: {
        set_level_findings?: Array<{ issue_code?: string }>;
        item_results?: Array<{ findings?: Array<{ issue_code?: string }> }>;
      } | null;
    } | null;
  };
  const output = payload.verification?.output;

  return [
    ...(output?.set_level_findings ?? []).map((finding) => finding.issue_code),
    ...(output?.item_results ?? []).flatMap((item) =>
      (item.findings ?? []).map((finding) => finding.issue_code)
    )
  ].filter((code): code is string => typeof code === "string");
}

async function main() {
  const prefix = `phase7d_item_verification_${Date.now()}`;
  process.env.LLM_PROVIDER = "mock";
  process.env.LLM_LIVE_CALLS_ENABLED = "false";
  process.env.OPERATIONAL_AGENT_MODE = "mock";
  await cleanupItemVerificationFixture(prisma, prefix);

  try {
    assert(AgentName.options.includes("item_verification_agent"), "Active registry missing item_verification_agent.");
    assert(!AgentName.options.includes("item_preparation_agent" as never), "Retired item_preparation_agent remains active.");
    assert(itemVerificationCases.length >= 15, "Synthetic verification cases should cover at least 15 cases.");

    for (const testCase of itemVerificationCases) {
      const serialized = JSON.stringify(testCase).toLowerCase();

      assert(!serialized.includes("student"), "Item verification fixture must not include student data.");
      assert(!serialized.includes("password"), "Item verification fixture must not include passwords.");
      assert(!serialized.includes("access_code"), "Item verification fixture must not include access codes.");

      for (const issueCode of testCase.expected_warning_issue_codes) {
        assert(
          ItemVerificationIssueCode.options.includes(issueCode as never),
          `Synthetic case ${testCase.case_id} uses an unknown issue code.`
        );
      }
    }

    const invalid = await createItemVerificationFixture({ prisma, prefix: `${prefix}_invalid`, itemCount: 1 });
    const invalidValidation = await validateConceptUnitPublishable({
      teacher_user_db_id: invalid.teacher.id,
      concept_unit_public_id: invalid.conceptUnit.concept_unit_public_id
    });
    assert(!invalidValidation.ok, "Structural failure should fail deterministic validation.");
    const invalidAgentCallsBefore = await prisma.agentCall.count({
      where: { agent_name: "item_verification_agent" }
    });
    const invalidRun = await runConceptUnitVerification({
      teacher_user_db_id: invalid.teacher.id,
      concept_unit_public_id: invalid.conceptUnit.concept_unit_public_id
    });
    assert(invalidRun.status === "deterministic_validation_failed", "Structural failure should block agent call.");
    const invalidAgentCalls = await prisma.agentCall.count({
      where: { agent_name: "item_verification_agent" }
    });
    assert(
      invalidAgentCalls === invalidAgentCallsBefore,
      "Structural failure should not create an agent call."
    );

    const clean = await createItemVerificationFixture({ prisma, prefix: `${prefix}_clean` });
    const cleanRun = await runConceptUnitVerification({
      teacher_user_db_id: clean.teacher.id,
      concept_unit_public_id: clean.conceptUnit.concept_unit_public_id,
      mock_mode: "item_verification_no_warnings"
    });
    assert(cleanRun.status === "verified", "No-warning fixture should verify.");
    assert(cleanRun.verification?.warning_count === 0, "No-warning fixture should have zero warnings.");
    assertNoRewritePayload(cleanRun.verification);

    const cleanReplay = await runConceptUnitVerification({
      teacher_user_db_id: clean.teacher.id,
      concept_unit_public_id: clean.conceptUnit.concept_unit_public_id,
      mock_mode: "item_verification_warning"
    });
    assert(cleanReplay.status === "already_verified", "Unchanged content should be idempotent.");

    const warning = await createItemVerificationFixture({ prisma, prefix: `${prefix}_warning` });
    const warningRun = await runConceptUnitVerification({
      teacher_user_db_id: warning.teacher.id,
      concept_unit_public_id: warning.conceptUnit.concept_unit_public_id,
      mock_mode: "item_verification_warning"
    });
    assert(warningRun.status === "verified", "Warning fixture should verify.");
    assert((warningRun.verification?.warning_count ?? 0) > 0, "Warning fixture should have findings.");
    assert(warningRun.verification?.teacher_review_required, "Warnings should require teacher review.");
    assertNoRewritePayload(warningRun.verification);

    for (const testCase of itemVerificationCases.filter(
      (candidate) =>
        candidate.expected_deterministic_validation_result === "pass" &&
        candidate.expected_semantic_validation_result !== "fail" &&
        candidate.expected_execution_result !== "failure" &&
        candidate.mock_mode !== "item_verification_no_warnings" &&
        candidate.mock_mode !== "item_verification_warning"
    )) {
      const fixture = await createItemVerificationFixture({
        prisma,
        prefix: `${prefix}_${testCase.case_id}`
      });
      const result = await runConceptUnitVerification({
        teacher_user_db_id: fixture.teacher.id,
        concept_unit_public_id: fixture.conceptUnit.concept_unit_public_id,
        mock_mode: testCase.mock_mode
      });

      assert(result.status === "verified", `${testCase.case_id} should produce a completed run.`);
      assert(
        result.verification?.teacher_review_required === testCase.expected_teacher_review_required,
        `${testCase.case_id} teacher-review requirement mismatch.`
      );

      for (const issueCode of testCase.expected_warning_issue_codes) {
        assert(
          collectIssueCodes(result).includes(issueCode),
          `${testCase.case_id} missing expected issue code ${issueCode}.`
        );
      }
      assertNoRewritePayload(result.verification);
    }

    const acknowledged = await acknowledgeItemVerificationWarnings({
      teacher_user_db_id: warning.teacher.id,
      concept_unit_public_id: warning.conceptUnit.concept_unit_public_id,
      verification_public_id: warningRun.verification!.verification_public_id
    });
    assert(acknowledged.acknowledged, "Acknowledgement should apply to current fingerprint.");

    await prisma.item.update({
      where: { id: warning.items[0].id },
      data: {
        item_stem: `${warning.items[0].item_stem} Edited for stale verification check.`,
        version: { increment: 1 }
      }
    });
    const stale = await buildCurrentItemVerificationContext({
      teacher_user_db_id: warning.teacher.id,
      concept_unit_public_id: warning.conceptUnit.concept_unit_public_id
    });
    assert(stale.latest_verification?.is_stale, "Content edit should make prior verification stale.");
    assert(!stale.latest_verification?.acknowledged, "Stale acknowledgement must not satisfy current publication.");

    const rerun = await runConceptUnitVerification({
      teacher_user_db_id: warning.teacher.id,
      concept_unit_public_id: warning.conceptUnit.concept_unit_public_id,
      mock_mode: "item_verification_no_warnings"
    });
    assert(rerun.status === "verified", "Changed fingerprint should permit a new run.");

    const bad = await createItemVerificationFixture({ prisma, prefix: `${prefix}_bad` });
    const badRun = await runConceptUnitVerification({
      teacher_user_db_id: bad.teacher.id,
      concept_unit_public_id: bad.conceptUnit.concept_unit_public_id,
      mock_mode: "item_verification_invalid_rewrite"
    });
    assert(badRun.status === "verified", "Rewrite-like output should fall back to deterministic verification.");

    const badGenerated = await createItemVerificationFixture({ prisma, prefix: `${prefix}_bad_generated` });
    const badGeneratedRun = await runConceptUnitVerification({
      teacher_user_db_id: badGenerated.teacher.id,
      concept_unit_public_id: badGenerated.conceptUnit.concept_unit_public_id,
      mock_mode: "item_verification_invalid_generated_option"
    });
    assert(
      badGeneratedRun.status === "verified",
      "Generated-option-like output should fall back to deterministic verification."
    );

    const contentRows = await prisma.item.findMany({
      where: { concept_unit_db_id: warning.conceptUnit.id },
      select: { item_stem: true, correct_option: true }
    });
    assert(
      contentRows.every((item) => item.correct_option === "A"),
      "Verification must not change correct options."
    );

    console.log("Item Verification Agent smoke test passed. No OpenAI network call was made.");
  } finally {
    await cleanupItemVerificationFixture(prisma, prefix);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
