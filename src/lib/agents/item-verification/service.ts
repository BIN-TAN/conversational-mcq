import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { executeAgent } from "@/lib/agents/execute-agent";
import { getPromptForAgent } from "@/lib/agents/prompts/registry";
import { prisma } from "@/lib/db";
import { ContentServiceError } from "@/lib/services/content/errors";
import { serializeAssessmentContentState } from "@/lib/services/content/governance";
import { validateConceptUnitPublishable } from "@/lib/services/content/publishing";
import { generatePublicId } from "@/lib/services/ids";
import { toPrismaJson } from "@/lib/services/json";
import { buildItemVerificationFingerprintPayload, buildItemVerificationInput } from "./input-builder";
import { combineItemVerificationWithDeterministicDuplicates } from "./deterministic-duplicates";
import { hashVerificationContent, stableSerialize } from "./fingerprint";
import {
  countItemVerificationWarnings,
  validateItemVerificationOutputSemantics
} from "./semantic-validation";
import { serializeItemVerificationRun } from "./serializers";

function prismaJson(value: unknown) {
  return toPrismaJson(value) ?? Prisma.JsonNull;
}

function invocationKey(input: {
  conceptUnitDbId: string;
  contentFingerprint: string;
  promptVersion: string;
  schemaVersion: string;
  promptHash: string;
}) {
  return createHash("sha256")
    .update(
      stableSerialize({
        agent_name: "item_verification_agent",
        concept_unit_db_id: input.conceptUnitDbId,
        content_fingerprint: input.contentFingerprint,
        prompt_version: input.promptVersion,
        schema_version: input.schemaVersion,
        prompt_hash: input.promptHash
      })
    )
    .digest("hex");
}

async function loadConceptUnitForVerification(input: {
  teacher_user_db_id: string;
  concept_unit_public_id: string;
}) {
  const conceptUnit = await prisma.conceptUnit.findFirst({
    where: {
      concept_unit_public_id: input.concept_unit_public_id,
      assessment: { created_by_user_db_id: input.teacher_user_db_id }
    },
    include: {
      assessment: { include: { _count: { select: { assessment_sessions: true } } } },
      latest_item_verification_run: {
        include: {
          agent_call: {
            select: {
              provider: true,
              model_name: true,
              prompt_version: true,
              schema_version: true,
              call_status: true,
              live_call_allowed: true
            }
          },
          acknowledged_by: {
            select: { user_id: true, display_name: true }
          }
        }
      },
      items: {
        where: {
          status: { not: "archived" },
          included_in_published_set: true
        },
        orderBy: [{ item_order: "asc" }, { created_at: "asc" }]
      }
    }
  });

  if (!conceptUnit) {
    throw new ContentServiceError("not_found", "Concept unit was not found.", 404);
  }

  return conceptUnit;
}

export async function buildCurrentItemVerificationContext(input: {
  teacher_user_db_id: string;
  concept_unit_public_id: string;
}) {
  const conceptUnit = await loadConceptUnitForVerification(input);
  const fingerprintPayload = buildItemVerificationFingerprintPayload({
    conceptUnit,
    items: conceptUnit.items
  });
  const contentFingerprint = hashVerificationContent(fingerprintPayload);
  const deterministicValidation = await validateConceptUnitPublishable(input);
  const latest = conceptUnit.latest_item_verification_run
    ? serializeItemVerificationRun({
        run: conceptUnit.latest_item_verification_run,
        current_content_fingerprint: contentFingerprint
      })
    : null;

  return {
    conceptUnit,
    content_state: serializeAssessmentContentState(conceptUnit.assessment),
    content_fingerprint: contentFingerprint,
    deterministic_validation: deterministicValidation,
    latest_verification: latest
  };
}

export async function getConceptUnitVerification(input: {
  teacher_user_db_id: string;
  concept_unit_public_id: string;
}) {
  return buildCurrentItemVerificationContext(input);
}

export async function runConceptUnitVerification(input: {
  teacher_user_db_id: string;
  concept_unit_public_id: string;
  mock_mode?: string;
}) {
  const context = await buildCurrentItemVerificationContext(input);

  if (context.content_state.is_content_locked) {
    throw new ContentServiceError(
      "content_locked_after_student_session",
      "This content cannot be reverified because student data collection has started.",
      409,
      {
        concept_unit_public_id: input.concept_unit_public_id,
        lock_reason: "student_session_exists"
      }
    );
  }

  if (!context.deterministic_validation.ok) {
    return {
      status: "deterministic_validation_failed" as const,
      deterministic_validation: context.deterministic_validation,
      verification: null,
      content_fingerprint: context.content_fingerprint
    };
  }

  const existing = await prisma.itemVerificationRun.findFirst({
    where: {
      concept_unit_db_id: context.conceptUnit.id,
      content_fingerprint: context.content_fingerprint,
      status: "completed"
    },
    orderBy: { created_at: "desc" },
    include: {
      agent_call: {
        select: {
          provider: true,
          model_name: true,
          prompt_version: true,
          schema_version: true,
          call_status: true,
          live_call_allowed: true
        }
      },
      acknowledged_by: { select: { user_id: true, display_name: true } }
    }
  });

  if (existing) {
    return {
      status: "already_verified" as const,
      deterministic_validation: context.deterministic_validation,
      verification: serializeItemVerificationRun({
        run: existing,
        current_content_fingerprint: context.content_fingerprint
      }),
      content_fingerprint: context.content_fingerprint
    };
  }

  const providerInput = buildItemVerificationInput({
    conceptUnit: context.conceptUnit,
    items: context.conceptUnit.items
  });
  const prompt = getPromptForAgent("item_verification_agent");
  const agentInvocationKey = invocationKey({
    conceptUnitDbId: context.conceptUnit.id,
    contentFingerprint: context.content_fingerprint,
    promptVersion: prompt.prompt_version,
    schemaVersion: prompt.schema_version,
    promptHash: prompt.prompt_hash
  });
  const execution = await executeAgent({
    agent_name: "item_verification_agent",
    input: providerInput,
    agent_invocation_key: agentInvocationKey,
    metadata: input.mock_mode ? { mock_mode: input.mock_mode } : undefined
  });

  if (execution.status !== "succeeded") {
    const failed = await prisma.itemVerificationRun.create({
      data: {
        id: randomUUID(),
        verification_public_id: generatePublicId("item_verification"),
        concept_unit_db_id: context.conceptUnit.id,
        content_fingerprint: context.content_fingerprint,
        concept_unit_version: context.conceptUnit.version,
        status: "failed",
        verification_status: "unable_to_verify",
        deterministic_validation_result: prismaJson(context.deterministic_validation),
        agent_call_db_id: "agent_call_id" in execution ? execution.agent_call_id ?? null : null,
        output_payload: Prisma.JsonNull,
        warning_count: 0,
        teacher_review_required: false,
        failure_message: `Agent execution did not produce a valid verification: ${execution.status}.`
      }
    });

    return {
      status: "verification_failed" as const,
      deterministic_validation: context.deterministic_validation,
      verification: serializeItemVerificationRun({
        run: failed,
        current_content_fingerprint: context.content_fingerprint
      }),
      content_fingerprint: context.content_fingerprint
    };
  }

  const combined = combineItemVerificationWithDeterministicDuplicates({
    providerInput,
    output: execution.output
  });
  const semantic = validateItemVerificationOutputSemantics({
    providerInput,
    output: combined.output
  });

  if (!semantic.ok) {
    const failed = await prisma.itemVerificationRun.create({
      data: {
        id: randomUUID(),
        verification_public_id: generatePublicId("item_verification"),
        concept_unit_db_id: context.conceptUnit.id,
        content_fingerprint: context.content_fingerprint,
        concept_unit_version: context.conceptUnit.version,
        status: "failed",
        verification_status: "unable_to_verify",
        deterministic_validation_result: prismaJson(context.deterministic_validation),
        agent_call_db_id: execution.agent_call_id,
        output_payload: prismaJson(combined.output),
        warning_count: 0,
        teacher_review_required: false,
        failure_message: semantic.errors.join("; ")
      }
    });

    await prisma.agentCall.update({
      where: { id: execution.agent_call_id },
      data: {
        output_validated: false,
        validation_error: semantic.errors.join("; "),
        call_status: "invalid_output",
        error_category: "semantic_validation"
      }
    });

    return {
      status: "semantic_validation_failed" as const,
      deterministic_validation: context.deterministic_validation,
      verification: serializeItemVerificationRun({
        run: failed,
        current_content_fingerprint: context.content_fingerprint
      }),
      content_fingerprint: context.content_fingerprint
    };
  }

  const warningCount = countItemVerificationWarnings(combined.output);
  const deterministicValidationResult = {
    ...(context.deterministic_validation as Record<string, unknown>),
    deterministic_duplicate_signal: combined.deterministic_duplicate_signal,
    deterministic_duplicate_applied: combined.deterministic_duplicate_applied,
    effective_combined_advisory_result: true
  };
  const run = await prisma.$transaction(async (tx) => {
    const created = await tx.itemVerificationRun.create({
      data: {
        id: randomUUID(),
        verification_public_id: generatePublicId("item_verification"),
        concept_unit_db_id: context.conceptUnit.id,
        content_fingerprint: context.content_fingerprint,
        concept_unit_version: context.conceptUnit.version,
        status: "completed",
        verification_status: combined.output.verification_status,
        deterministic_validation_result: prismaJson(deterministicValidationResult),
        agent_call_db_id: execution.agent_call_id,
        output_payload: prismaJson(combined.output),
        warning_count: warningCount,
        teacher_review_required: combined.output.teacher_review_required
      },
      include: {
        agent_call: {
          select: {
            provider: true,
            model_name: true,
            prompt_version: true,
            schema_version: true,
            call_status: true,
            live_call_allowed: true
          }
        },
        acknowledged_by: { select: { user_id: true, display_name: true } }
      }
    });

    await tx.conceptUnit.update({
      where: { id: context.conceptUnit.id },
      data: { latest_item_verification_run_db_id: created.id }
    });

    return created;
  });

  return {
    status: "verified" as const,
    deterministic_validation: context.deterministic_validation,
    verification: serializeItemVerificationRun({
      run,
      current_content_fingerprint: context.content_fingerprint
    }),
    content_fingerprint: context.content_fingerprint
  };
}

export async function acknowledgeItemVerificationWarnings(input: {
  teacher_user_db_id: string;
  concept_unit_public_id: string;
  verification_public_id: string;
}) {
  const context = await buildCurrentItemVerificationContext(input);
  const run = await prisma.itemVerificationRun.findFirst({
    where: {
      verification_public_id: input.verification_public_id,
      concept_unit_db_id: context.conceptUnit.id,
      status: "completed"
    }
  });

  if (!run) {
    throw new ContentServiceError("not_found", "Verification run was not found.", 404);
  }

  if (run.content_fingerprint !== context.content_fingerprint) {
    throw new ContentServiceError(
      "conflict",
      "This verification no longer applies to the current item set.",
      409
    );
  }

  if (run.warning_count <= 0) {
    throw new ContentServiceError(
      "conflict",
      "This verification has no warnings to acknowledge.",
      409
    );
  }

  const updated = await prisma.itemVerificationRun.update({
    where: { id: run.id },
    data: {
      acknowledged_by_user_db_id: input.teacher_user_db_id,
      acknowledged_at: new Date()
    },
    include: {
      agent_call: {
        select: {
          provider: true,
          model_name: true,
          prompt_version: true,
          schema_version: true,
          call_status: true,
          live_call_allowed: true
        }
      },
      acknowledged_by: { select: { user_id: true, display_name: true } }
    }
  });

  return serializeItemVerificationRun({
    run: updated,
    current_content_fingerprint: context.content_fingerprint
  });
}
