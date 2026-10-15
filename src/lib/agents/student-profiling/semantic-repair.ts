import type { AgentInputByName, AgentOutputByName } from "@/lib/agents/contracts";
import type {
  ExecuteOperationalAgentInput,
  OperationalAgentExecutionResult
} from "@/lib/agents/operational/executor";
import { sealedCorrectnessByItem, validateStudentProfileOutputSemantics } from "./semantic-validation";
import { stableHash } from "@/lib/operational/stable-hash";

export const STUDENT_PROFILE_SEMANTIC_REPAIR_VERSION = "student-profile-semantic-repair-v2" as const;
type Request = ExecuteOperationalAgentInput<"student_profiling_agent">;
type Result = OperationalAgentExecutionResult<AgentOutputByName["student_profiling_agent"]>;
type Semantic = ReturnType<typeof validateStudentProfileOutputSemantics>;

export function studentProfileSemanticRepairKey(invocationKey: string) {
  return `${invocationKey}:semantic-repair:1`;
}

export function studentProfileReusableInvocationKeys(invocationKey: string) {
  return [invocationKey, studentProfileSemanticRepairKey(invocationKey)];
}

export type RetainedStudentProfileSemanticRejection = {
  agent_call_id: string;
  // Null means a retained rejection was found but failed identity/input checks.
  provider_input: AgentInputByName["student_profiling_agent"] | null;
  output: AgentOutputByName["student_profiling_agent"] | null;
};

export function studentProfileSealedInputMatches(
  retained: AgentInputByName["student_profiling_agent"],
  current: AgentInputByName["student_profiling_agent"]
) {
  const facts = (value: typeof retained) => ({
    profile_type: value.profile_type,
    // Operational timestamps/process events can grow after the rejection. The
    // identity, administered responses and interpretation policy cannot change.
    assessment: value.concept_unit_metadata.assessment,
    concept_unit: value.concept_unit_metadata.concept_unit,
    initial_payload: value.initial_response_package.payload,
    initial_items: value.initial_response_package.item_evidence,
    followup: value.followup_evidence_package,
    previous_profile: value.previous_profile,
    constraints: value.profiling_constraints,
    baseline_evidence: value.allowed_evidence_catalog?.evidence.filter(
      evidence => evidence.source_role === "student" && evidence.evidence_stage === "baseline_assessment"
    )
  });
  return stableHash(facts(retained)) === stableHash(facts(current));
}

function repairRequest(request: Request, rejectedCallId: string, semantic: Semantic,
  rejectedOutput: AgentOutputByName["student_profiling_agent"]): Request {
  // Reuse the fact validator's exact precedence, including unknown/conflicting
  // correctness. Each row refers to an existing item, never a newly inferred fact.
  const itemComparisons = [...sealedCorrectnessByItem(request.allowlistedInput)].map(([itemId, correctness]) => {
    const rejectedItems = rejectedOutput.item_level_evidence.filter(item => item.item_public_id === itemId);
    return {
      item_public_id: itemId,
      sealed_correctness: correctness,
      rejected_item_entry_count: rejectedItems.length,
      // Distinct enum values stay bounded even if the rejected draft duplicated
      // an item. Never choose an arbitrary one of conflicting classifications.
      rejected_reasoning_assessments: [...new Set(rejectedItems.map(item => item.reasoning_basis?.assessment ?? null))]
    };
  });
  return {
    ...request,
    invocationKey: studentProfileSemanticRepairKey(request.invocationKey),
    forceNewInvocation: false,
    allowlistedInput: {
      ...request.allowlistedInput,
      profiling_constraints: {
        ...request.allowlistedInput.profiling_constraints,
        semantic_repair: {
          policy_version: STUDENT_PROFILE_SEMANTIC_REPAIR_VERSION,
          attempt: 1,
          maximum_regenerations: 1,
          validation_issues: semantic.issues,
          rejected_field_diagnostics: {
            provenance: "The item IDs and sealed_correctness are projections of the unchanged submitted packages. Rejected flags and reasoning assessments are prior model judgments, not student evidence or authoritative classifications. Reassess the original student explanations; do not copy a rejected judgment merely because it appears here.",
            ability_pattern_flags: [...rejectedOutput.ability_pattern_flags],
            item_comparisons: itemComparisons
          },
          instruction: "Regenerate the complete profile from the unchanged submitted evidence. First assess each item's actual reasoning, then compare that assessment with its sealed answer correctness before choosing aggregate flags. Resolve every listed validation issue; do not change a reasoning assessment simply to justify a flag, delete student evidence, invent support, or copy a rejected model judgment. An incorrect answer and incorrect explanation are aligned evidence of error, not by themselves a correctness-versus-reasoning mismatch."
        }
      }
    },
    metadata: { ...request.metadata,
      semantic_repair_policy: STUDENT_PROFILE_SEMANTIC_REPAIR_VERSION,
      semantic_repair_of_agent_call: rejectedCallId }
  };
}

// The injected effects let offline tests exercise the actual bounded policy.
// Every provider dispatch still passes the ordinary readiness and usage gates.
export async function executeStudentProfileWithSemanticRepair(input: {
  request: Request;
  execute: (request: Request) => Promise<Result>;
  recordRejected: (result: Extract<Result, { status: "succeeded" }>, semantic: Semantic) => Promise<void>;
  readPriorSemanticRejection?: (request: Request) => Promise<RetainedStudentProfileSemanticRejection | null>;
}) {
  let request = input.request;
  const prior = await input.readPriorSemanticRejection?.(request);
  if (prior) {
    const semantic = prior.provider_input && prior.output
      ? validateStudentProfileOutputSemantics({ providerInput: prior.provider_input, output: prior.output }) : null;
    if (!semantic || semantic.ok || prior.output?.output_status !== "ok") return {
      status: "semantic_validation_failed" as const,
      agent_call_id: prior.agent_call_id, retry_count: 0,
      validation_error: "The retained semantic rejection is not eligible for bounded repair."
    };
    // Resume from the original audited input, not a rebuilt context containing
    // later operational events. Never dispatch the rejected original again.
    request = repairRequest({ ...request, allowlistedInput: prior.provider_input! }, prior.agent_call_id, semantic, prior.output!);
  }
  for (let attempt = prior ? 1 : 0; attempt < 2; attempt += 1) {
    const result = await input.execute(request);
    if (result.status !== "succeeded") {
      // A failed repair must not be reinterpreted as a usable conservative
      // profile. The original invalid draft and this attempt remain auditable.
      if (attempt === 1) return {
        status: "semantic_validation_failed" as const,
        agent_call_id: "agent_call_id" in result ? result.agent_call_id ?? null : null,
        retry_count: result.retry_count,
        validation_error: "The bounded semantic repair did not produce a validated profile."
      };
      return result;
    }
    const semantic = validateStudentProfileOutputSemantics({
      providerInput: request.allowlistedInput, output: result.output
    });
    if (semantic.ok) return result;
    await input.recordRejected(result, semantic);
    if (attempt === 1 || result.output.output_status !== "ok") return {
      status: "semantic_validation_failed" as const,
      agent_call_id: result.agent_call_id,
      retry_count: result.retry_count,
      validation_error: semantic.issues.join("; ")
    };
    request = repairRequest(input.request, result.agent_call_id, semantic, result.output);
  }
  throw new Error("student_profile_semantic_repair_bound_exceeded");
}
