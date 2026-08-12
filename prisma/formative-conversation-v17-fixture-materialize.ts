import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentInputByName } from "../src/lib/agents/contracts";
import { stableHash } from "../src/lib/operational/stable-hash";
import {
  FORMATIVE_CONVERSATION_V5_CASE_ORDER,
  FORMATIVE_CONVERSATION_V5_FORMATIVE_CASE_ORDER,
  FORMATIVE_CONVERSATION_V5_FIXTURE_ROOT,
  FormativeConversationV17FixtureSchema,
  type FormativeConversationV17Fixture
} from "../src/lib/operational/formative-conversation-v5-evaluation-v17/contracts";
import { FormativeConversationV5FixtureSchema as V16FormativeFixtureSchema } from "../src/lib/operational/formative-conversation-v5-evaluation-v14/contracts";

const V16_FIXTURE_ROOT =
  "config/operational-candidates/formative-conversation-host-v5-executable-v16/fixtures";

type ItemEvidence = {
  item_public_id: string;
  correctness: "correct" | "incorrect";
  reasoning_text: string;
  confidence_rating: "low" | "medium" | "high";
};

function responsePackage(items: ItemEvidence[]) {
  return {
    package_type: "initial_concept_unit_response_package",
    payload: {
      item_responses: items,
      process_counts: {
        answer_revision_count: 1,
        page_hidden_count: 0
      }
    },
    process_events: [
      {
        event_type: "package_submitted",
        event_category: "initial_administration",
        event_source: "student",
        occurred_at: "2026-08-12T00:00:00.000Z"
      }
    ]
  };
}

function profilingInput(caseId: string, items: ItemEvidence[]): AgentInputByName["student_profiling_agent"] {
  return {
    concept_unit_metadata: {
      concept_unit_public_id: `${caseId}:measurement-evidence`,
      title: "Measurement evidence and score interpretation",
      learning_objective:
        "Distinguish reliability, measurement error, and validity evidence."
    },
    initial_response_package: responsePackage(items),
    previous_profile: null,
    followup_evidence_package: null,
    profile_type: "initial",
    profiling_constraints: {
      conservative_inference_required: true,
      semantic_atomic_claims_required: true,
      platform_assigns_machine_ids_after_validation: true,
      synthetic_operational_evaluation_only: true
    }
  };
}

function canary(input: {
  case_id:
    | "pcv17_01_no_misconception"
    | "pcv17_02_single_atomic_misconception"
    | "pcv17_03_compound_conceptual_state";
  case_order: 1 | 2 | 3;
  title: string;
  items: ItemEvidence[];
  expected_catalog: {
    indicator_count: number | null;
    claim_count: number | null;
    minimum_claim_count: number;
    empty_catalog_required: boolean;
    distinct_claim_ids_required: boolean;
    partial_resolution_projection_required: boolean;
  };
}) {
  const hashable = {
    fixture_version: "formative-conversation-v17-profiling-canary-v1" as const,
    case_type: "profiling_contract_canary" as const,
    case_id: input.case_id,
    case_order: input.case_order,
    title: input.title,
    synthetic_only: true as const,
    real_student_information_present: false as const,
    provider_input: profilingInput(input.case_id, input.items),
    catalog_identity_scope_template: `<provider_run_id>:${input.case_id}:initial-profile`,
    expected_catalog: {
      ...input.expected_catalog,
      metadata_pseudo_claims_forbidden: true as const,
      lexical_splitting_forbidden: true as const
    },
    case_assertions: [
      {
        assertion_id: "profiling_contract_valid",
        description:
          "The real student-profiling-v4 response passes schema and evidence-grounded semantic validation.",
        severity: "blocking" as const,
        evaluation_method: "deterministic_artifact_check" as const
      },
      {
        assertion_id: "platform_identity_assignment_valid",
        description:
          "The platform assigns canonical machine identities only after the profiling output is accepted.",
        severity: "blocking" as const,
        evaluation_method: "deterministic_artifact_check" as const
      }
    ],
    call_graph: {
      agent_name: "student_profiling_agent" as const,
      prompt_version: "student-profiling-v4" as const,
      schema_version: "student-profile-output-v3" as const,
      base_logical_calls: 1 as const,
      maximum_semantic_regenerations: 1 as const,
      maximum_logical_calls: 2 as const,
      maximum_provider_attempts_per_logical_call: 3 as const,
      maximum_transport_retries_per_logical_call: 2 as const
    }
  };
  return FormativeConversationV17FixtureSchema.parse({
    ...hashable,
    fixture_hash: stableHash(hashable)
  });
}

function atomicClaimsForCase(caseId: string) {
  if (
    caseId === "fcv5_01_assistant_first_opening" ||
    caseId === "fcv5_04_related_concept_discussion"
  ) {
    return [];
  }
  if (caseId === "fcv5_03_direct_answer_handling") {
    return [
      {
        claim_text: "A reliability coefficient is treated as proof of validity.",
        source_evidence_references: ["measurement_reliability"]
      }
    ];
  }
  if (caseId === "fcv5_08_mixed_resolved_evidence") {
    return [
      {
        claim_text:
          "Standard error of measurement is treated as identifying an exact true score.",
        source_evidence_references: ["standard_error_measurement"]
      }
    ];
  }
  return [
    {
      claim_text: "High reliability or consistency automatically proves validity.",
      source_evidence_references: ["measurement_reliability"]
    },
    {
      claim_text:
        "Standard error of measurement identifies an exact true score.",
      source_evidence_references: ["standard_error_measurement"]
    },
    {
      claim_text:
        "Validity is a permanent property of a test independent of interpretation and context.",
      source_evidence_references: ["validity_argument"]
    }
  ];
}

async function formativeFixture(
  caseId: (typeof FORMATIVE_CONVERSATION_V5_FORMATIVE_CASE_ORDER)[number],
  caseOrder: number
) {
  const sourcePath = `${V16_FIXTURE_ROOT}/${caseId}.json`;
  const sourceBytes = await readFile(path.resolve(process.cwd(), sourcePath));
  const formativeFixture = V16FormativeFixtureSchema.parse(
    JSON.parse(sourceBytes.toString("utf8")) as unknown
  );
  const sourceFixtureHash = formativeFixture.fixture_hash;
  formativeFixture.initial_profile_source.profile.prompt_version =
    "student-profiling-v4";
  formativeFixture.initial_profile_source.profile.schema_version =
    "student-profile-output-v3";
  const atomicClaims = atomicClaimsForCase(caseId);
  if (atomicClaims.length > 0) {
    formativeFixture.initial_profile_source.profile.misconception_indicators[0].atomic_claims =
      atomicClaims;
  }
  const { fixture_hash: ignored, ...formativeHashable } = formativeFixture;
  void ignored;
  formativeFixture.fixture_hash = stableHash(formativeHashable);
  const hashable = {
    fixture_version: "formative-conversation-v17-formative-case-v1" as const,
    case_type: "formative_conversation" as const,
    case_id: caseId,
    case_order: caseOrder,
    source_v16_fixture_sha256: createHash("sha256").update(sourceBytes).digest("hex"),
    formative_fixture: formativeFixture,
    source_v16_fixture_hash: sourceFixtureHash
  };
  const { source_v16_fixture_hash: evidenceOnly, ...frozen } = hashable;
  void evidenceOnly;
  return FormativeConversationV17FixtureSchema.parse({
    ...frozen,
    fixture_hash: stableHash(frozen)
  });
}

async function writeFixture(fixture: FormativeConversationV17Fixture) {
  await writeFile(
    path.join(FORMATIVE_CONVERSATION_V5_FIXTURE_ROOT, `${fixture.case_id}.json`),
    `${JSON.stringify(fixture, null, 2)}\n`,
    "utf8"
  );
}

export async function materializeFormativeConversationV17Fixtures() {
  const canaries = [
    canary({
      case_id: "pcv17_01_no_misconception",
      case_order: 1,
      title: "Validated empty misconception catalog",
      items: [
        ["measurement_reliability", "Reliability supports consistency, not validity by itself."],
        ["standard_error_measurement", "SEM describes uncertainty around an observed score."],
        ["validity_argument", "Validity evidence depends on the intended interpretation and use."]
      ].map(([id, reasoning]) => ({
        item_public_id: id,
        correctness: "correct" as const,
        reasoning_text: reasoning,
        confidence_rating: "medium" as const
      })),
      expected_catalog: {
        indicator_count: 0,
        claim_count: 0,
        minimum_claim_count: 0,
        empty_catalog_required: true,
        distinct_claim_ids_required: true,
        partial_resolution_projection_required: false
      }
    }),
    canary({
      case_id: "pcv17_02_single_atomic_misconception",
      case_order: 2,
      title: "Single atomic misconception identity",
      items: [
        {
          item_public_id: "measurement_reliability",
          correctness: "incorrect",
          reasoning_text: "A highly reliable test must therefore be valid for the intended use.",
          confidence_rating: "high"
        },
        {
          item_public_id: "standard_error_measurement",
          correctness: "correct",
          reasoning_text: "SEM represents uncertainty rather than an exact true score.",
          confidence_rating: "medium"
        },
        {
          item_public_id: "validity_argument",
          correctness: "correct",
          reasoning_text: "Validity evidence is tied to the intended interpretation and use.",
          confidence_rating: "medium"
        }
      ],
      expected_catalog: {
        indicator_count: 1,
        claim_count: 1,
        minimum_claim_count: 1,
        empty_catalog_required: false,
        distinct_claim_ids_required: true,
        partial_resolution_projection_required: false
      }
    }),
    canary({
      case_id: "pcv17_03_compound_conceptual_state",
      case_order: 3,
      title: "Compound conceptual state with atomic claims",
      items: [
        {
          item_public_id: "measurement_reliability",
          correctness: "incorrect",
          reasoning_text: "High reliability proves the scores are valid.",
          confidence_rating: "high"
        },
        {
          item_public_id: "standard_error_measurement",
          correctness: "incorrect",
          reasoning_text: "SEM identifies the exact true score.",
          confidence_rating: "high"
        },
        {
          item_public_id: "validity_argument",
          correctness: "incorrect",
          reasoning_text: "Validity belongs permanently to the test, whatever its use.",
          confidence_rating: "high"
        }
      ],
      expected_catalog: {
        indicator_count: null,
        claim_count: null,
        minimum_claim_count: 2,
        empty_catalog_required: false,
        distinct_claim_ids_required: true,
        partial_resolution_projection_required: true
      }
    })
  ];
  await mkdir(FORMATIVE_CONVERSATION_V5_FIXTURE_ROOT, { recursive: true });
  for (const fixture of canaries) await writeFixture(fixture);
  for (
    let index = 0;
    index < FORMATIVE_CONVERSATION_V5_FORMATIVE_CASE_ORDER.length;
    index += 1
  ) {
    await writeFixture(
      await formativeFixture(
        FORMATIVE_CONVERSATION_V5_FORMATIVE_CASE_ORDER[index],
        index + 4
      )
    );
  }
  return {
    status: "materialized" as const,
    fixture_count: FORMATIVE_CONVERSATION_V5_CASE_ORDER.length,
    profiling_canary_count: 3,
    formative_case_count: 8,
    provider_calls: 0,
    model_auth_requests: 0,
    dispatch_checkpoints: 0
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  materializeFormativeConversationV17Fixtures()
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
