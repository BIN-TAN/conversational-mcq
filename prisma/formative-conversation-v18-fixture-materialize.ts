import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ProductionStudentProfilingInput } from "../src/lib/agents/contracts";
import { getPromptForAgent } from "../src/lib/agents/prompts/registry";
import { buildCanonicalEvidenceCatalog } from "../src/lib/domain/canonical-evidence-identity";
import { stableHash } from "../src/lib/operational/stable-hash";
import {
  FORMATIVE_CONVERSATION_V5_CASE_ORDER,
  FORMATIVE_CONVERSATION_V5_END_TO_END_CASE_ORDER,
  FORMATIVE_CONVERSATION_V5_FIXTURE_ROOT,
  FORMATIVE_CONVERSATION_V5_FORMATIVE_CASE_ORDER,
  FORMATIVE_CONVERSATION_V5_PROFILING_CASE_ORDER,
  FormativeConversationV18FixtureSchema,
  type FormativeConversationV18Fixture
} from "../src/lib/operational/formative-conversation-v5-evaluation-v18/contracts";
import { FormativeConversationV5FixtureSchema as HistoricalFormativeFixtureSchema } from "../src/lib/operational/formative-conversation-v5-evaluation-v14/contracts";

const HISTORICAL_FIXTURE_ROOT =
  "config/operational-candidates/formative-conversation-host-v5-executable-v16/fixtures";

type ItemEvidence = {
  item_public_id: string;
  correctness: "correct" | "incorrect";
  reasoning_text: string;
  confidence_rating: "low" | "medium" | "high";
};

function sha256(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

function evidenceCatalog(caseId: string, items: ItemEvidence[]) {
  return buildCanonicalEvidenceCatalog({
    evidence_namespace_public_id: `${caseId}:synthetic-session`,
    assessment_public_id: `${caseId}:assessment`,
    concept_unit_public_id: `${caseId}:measurement-evidence`,
    assessment_responses: items.map((item, index) => ({
      item_public_id: item.item_public_id,
      selected_option: item.correctness === "correct" ? "A" : "B",
      correctness: item.correctness,
      written_reasoning: item.reasoning_text,
      confidence: item.confidence_rating,
      tempting_option: null,
      tempting_option_reason: null
    })),
    assessment_process: [
      {
        source_public_id: `${caseId}:package-submitted`,
        event_type: "package_submitted",
        event_category: "initial_administration",
        event_source: "student",
        item_public_id: null,
        occurred_at: "2026-08-13T00:00:00.000Z"
      }
    ]
  });
}

function profilingInput(caseId: string, items: ItemEvidence[]) {
  return ProductionStudentProfilingInput.parse({
    concept_unit_metadata: {
      assessment: {
        assessment_public_id: `${caseId}:assessment`,
        title: "Synthetic measurement evidence assessment",
        description: "Synthetic operational evaluation only.",
        status: "published"
      },
      assessment_session: {
        session_public_id: `${caseId}:synthetic-session`,
        attempt_number: 1,
        status: "active",
        current_phase: "profiling_pending"
      },
      concept_unit: {
        concept_unit_public_id: `${caseId}:measurement-evidence`,
        title: "Measurement evidence and score interpretation",
        learning_objective:
          "Distinguish reliability, measurement error, and validity evidence."
      }
    },
    initial_response_package: {
      package_type: "initial_concept_unit_response_package",
      created_at: "2026-08-13T00:00:00.000Z",
      payload: {
        item_responses: items
      },
      item_evidence: items.map((item, index) => ({
        item_public_id: item.item_public_id,
        item_order: index + 1,
        response: {
          selected_option: item.correctness === "correct" ? "A" : "B",
          correctness: item.correctness,
          reasoning_text: item.reasoning_text,
          confidence_rating: item.confidence_rating,
          response_finalized: true
        }
      })),
      conversation_turns: [],
      process_event_aggregates: {
        package_submitted: 1
      },
      process_events: [
        {
          event_type: "package_submitted",
          event_category: "initial_administration",
          event_source: "student",
          occurred_at: "2026-08-13T00:00:00.000Z",
          item_public_id: null
        }
      ]
    },
    allowed_evidence_catalog: evidenceCatalog(caseId, items),
    previous_profile: null,
    followup_evidence_package: null,
    profile_type: "initial",
    profiling_constraints: {
      conservative_inference_required: true,
      semantic_atomic_claims_required: true,
      platform_assigns_machine_ids_after_validation: true,
      synthetic_operational_evaluation_only: true,
      output_schema_version: "student-profile-output-v4"
    }
  });
}

function assertion(assertionId: string, description: string) {
  return {
    assertion_id: assertionId,
    description,
    severity: "blocking" as const,
    evaluation_method: "deterministic_artifact_check" as const
  };
}

function profilingFixture(input: {
  case_id: (typeof FORMATIVE_CONVERSATION_V5_PROFILING_CASE_ORDER)[number];
  case_order: 1 | 2 | 3;
  title: string;
  items: ItemEvidence[];
  expected_catalog: {
    indicator_count: number | null;
    claim_count: number | null;
    minimum_claim_count: number;
    empty_catalog_required: boolean;
    partial_resolution_projection_required: boolean;
  };
}) {
  const prompt = getPromptForAgent("student_profiling_agent");
  const hashable = {
    fixture_version: "formative-conversation-v18-profiling-canary-v2" as const,
    case_type: "profiling_contract_canary" as const,
    case_id: input.case_id,
    case_order: input.case_order,
    title: input.title,
    synthetic_only: true as const,
    real_student_information_present: false as const,
    provider_input: profilingInput(input.case_id, input.items),
    catalog_identity_scope_template:
      `<provider_run_id>:${input.case_id}:initial-profile`,
    expected_catalog: {
      ...input.expected_catalog,
      distinct_claim_ids_required: true as const,
      metadata_pseudo_claims_forbidden: true as const,
      lexical_splitting_forbidden: true as const
    },
    case_assertions: [
      assertion(
        "production_profiling_contract_valid",
        "The exact student-profiling-v5 production request, V4 schema, and evidence-grounded semantic validator accept the output."
      ),
      assertion(
        "platform_identity_assignment_valid",
        "The platform assigns canonical claim and evidence identities only after semantic acceptance."
      )
    ],
    call_graph: {
      agent_name: "student_profiling_agent" as const,
      prompt_version: prompt.prompt_version as "student-profiling-v5",
      schema_version: prompt.schema_version as "student-profile-output-v4",
      base_logical_calls: 1 as const,
      maximum_semantic_regenerations: 1 as const,
      maximum_logical_calls: 2 as const,
      maximum_provider_attempts_per_logical_call: 3 as const,
      maximum_transport_retries_per_logical_call: 2 as const
    }
  };
  return FormativeConversationV18FixtureSchema.parse({
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
  const sourcePath = `${HISTORICAL_FIXTURE_ROOT}/${caseId}.json`;
  const sourceBytes = await readFile(path.resolve(process.cwd(), sourcePath));
  const formativeFixture = HistoricalFormativeFixtureSchema.parse(
    JSON.parse(sourceBytes.toString("utf8")) as unknown
  );
  formativeFixture.initial_profile_source.profile.prompt_version =
    "student-profiling-v5";
  formativeFixture.initial_profile_source.profile.schema_version =
    "student-profile-output-v4";
  const claims = atomicClaimsForCase(caseId);
  if (claims.length > 0) {
    formativeFixture.initial_profile_source.profile.misconception_indicators[0].atomic_claims =
      claims;
  }
  const { fixture_hash: ignored, ...formativeHashable } = formativeFixture;
  void ignored;
  formativeFixture.fixture_hash = stableHash(formativeHashable);
  const hashable = {
    fixture_version: "formative-conversation-v18-formative-case-v2" as const,
    case_type: "formative_conversation" as const,
    case_id: caseId,
    case_order: caseOrder,
    source_fixture_path: sourcePath,
    source_fixture_sha256: sha256(sourceBytes),
    substantive_scenario_preserved: true as const,
    canonical_identity_expectations: claims.map((claim, index) => ({
      claim_text: claim.claim_text,
      source_item_aliases: [...claim.source_evidence_references],
      expected_disposition:
        index === 0 &&
        (caseId === "fcv5_05_sound_profile_transition" ||
          caseId === "fcv5_06_largely_improved_temporal")
          ? ("resolved" as const)
          : ("retained" as const)
    })),
    formative_fixture: formativeFixture
  };
  return FormativeConversationV18FixtureSchema.parse({
    ...hashable,
    fixture_hash: stableHash(hashable)
  });
}

async function endToEndFixture() {
  const sourcePath = `${HISTORICAL_FIXTURE_ROOT}/fcv5_06_largely_improved_temporal.json`;
  const sourceBytes = await readFile(path.resolve(process.cwd(), sourcePath));
  const source = HistoricalFormativeFixtureSchema.parse(
    JSON.parse(sourceBytes.toString("utf8")) as unknown
  );
  const hashable = {
    fixture_version: "formative-conversation-v18-end-to-end-case-v1" as const,
    case_type: "dissertation_end_to_end" as const,
    case_id: FORMATIVE_CONVERSATION_V5_END_TO_END_CASE_ORDER[0],
    case_order: 12 as const,
    title: "Dissertation end-to-end claim and evidence provenance",
    execution_subject_id: "overconfident_incorrect" as const,
    synthetic_only: true as const,
    real_student_information_present: false as const,
    assessment: source.assessment,
    assessment_responses: source.assessment_responses,
    student_messages: [
      {
        ...source.student_messages[0],
        message_text:
          "Reliability shows consistency, but it does not by itself prove validity for an intended use. I still think SEM might identify an exact true score."
      },
      {
        ...(source.student_messages[1] ?? source.student_messages[0]),
        sequence: 2,
        message_text:
          "For a hiring test I would require separate validity evidence. I have not yet worked out how SEM represents score uncertainty."
      }
    ],
    initial_claim_expectations: [
      {
        claim_text:
          "High reliability automatically proves validity for an intended use.",
        source_item_aliases: ["measurement_reliability"],
        expected_disposition: "resolved" as const
      },
      {
        claim_text:
          "Standard error of measurement identifies an exact true score.",
        source_item_aliases: ["standard_error_measurement"],
        expected_disposition: "retained" as const
      }
    ],
    required_pipeline: [
      "baseline_assessment_evidence",
      "production_student_profiling_request",
      "profiling_schema_v4",
      "profiling_semantic_validation",
      "platform_evidence_id_assignment",
      "platform_claim_id_assignment",
      "persisted_initial_profile",
      "production_formative_request",
      "student_authored_formative_evidence",
      "claim_and_evidence_validation",
      "temporal_admissibility",
      "transition_persistence",
      "teacher_projection",
      "research_export"
    ],
    case_assertions: [
      assertion(
        "end_to_end_provenance_complete",
        "Assessment evidence, production profiling, canonical identity assignment, formative evidence, transition persistence, teacher projection, and research export are reconstructable."
      ),
      assertion(
        "resolved_and_retained_claim_identity_stable",
        "The resolved claim cites post-baseline evidence while the retained claim preserves the same claim ID and historical provenance."
      )
    ],
    permitted_terminal_outcomes: [
      "largely_improved_understanding" as const
    ],
    call_graph: {
      production_student_profiling_base_calls: 1 as const,
      assistant_first_opening_calls: 1 as const,
      student_message_calls: 2 as const,
      formative_base_calls: 3 as const,
      total_base_calls: 4 as const,
      maximum_semantic_regenerations: 4 as const,
      maximum_provider_attempts_per_logical_call: 3 as const,
      maximum_transport_retries_per_logical_call: 2 as const
    }
  };
  return FormativeConversationV18FixtureSchema.parse({
    ...hashable,
    fixture_hash: stableHash(hashable)
  });
}

async function writeFixture(fixture: FormativeConversationV18Fixture) {
  await writeFile(
    path.join(FORMATIVE_CONVERSATION_V5_FIXTURE_ROOT, `${fixture.case_id}.json`),
    `${JSON.stringify(fixture, null, 2)}\n`,
    "utf8"
  );
}

export async function materializeFormativeConversationV18Fixtures() {
  const canaries = [
    profilingFixture({
      case_id: "pcv18_01_no_misconception",
      case_order: 1,
      title: "No misconception",
      items: [
        ["measurement_reliability", "Reliability supports consistency, not validity by itself."],
        ["standard_error_measurement", "SEM describes uncertainty around an observed score."],
        ["validity_argument", "Validity evidence depends on the intended interpretation and use."]
      ].map(([item_public_id, reasoning_text]) => ({
        item_public_id,
        correctness: "correct" as const,
        reasoning_text,
        confidence_rating: "medium" as const
      })),
      expected_catalog: {
        indicator_count: 0,
        claim_count: 0,
        minimum_claim_count: 0,
        empty_catalog_required: true,
        partial_resolution_projection_required: false
      }
    }),
    profilingFixture({
      case_id: "pcv18_02_single_atomic_misconception",
      case_order: 2,
      title: "Single atomic misconception",
      items: [
        {
          item_public_id: "measurement_reliability",
          correctness: "incorrect",
          reasoning_text:
            "A highly reliable test must therefore be valid for the intended use.",
          confidence_rating: "high"
        },
        {
          item_public_id: "standard_error_measurement",
          correctness: "correct",
          reasoning_text:
            "SEM represents uncertainty rather than an exact true score.",
          confidence_rating: "medium"
        },
        {
          item_public_id: "validity_argument",
          correctness: "correct",
          reasoning_text:
            "Validity evidence is tied to the intended interpretation and use.",
          confidence_rating: "medium"
        }
      ],
      expected_catalog: {
        indicator_count: 1,
        claim_count: 1,
        minimum_claim_count: 1,
        empty_catalog_required: false,
        partial_resolution_projection_required: false
      }
    }),
    profilingFixture({
      case_id: "pcv18_03_compound_conceptual_state",
      case_order: 3,
      title: "Compound conceptual state",
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
          reasoning_text:
            "Validity belongs permanently to the test, whatever its use.",
          confidence_rating: "high"
        }
      ],
      expected_catalog: {
        indicator_count: null,
        claim_count: null,
        minimum_claim_count: 2,
        empty_catalog_required: false,
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
  await writeFixture(await endToEndFixture());
  return {
    status: "materialized" as const,
    fixture_count: FORMATIVE_CONVERSATION_V5_CASE_ORDER.length,
    profiling_case_count: 3,
    formative_case_count: 8,
    end_to_end_case_count: 1,
    provider_calls: 0,
    model_auth_requests: 0,
    generation_network_requests: 0,
    dispatch_checkpoints: 0
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  materializeFormativeConversationV18Fixtures()
    .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch((error) => {
      process.stderr.write(
        `${JSON.stringify({
          status: "failed",
          error_code:
            error instanceof Error
              ? error.message
              : "formative_conversation_v18_fixture_materialization_failed",
          provider_calls: 0,
          model_auth_requests: 0,
          generation_network_requests: 0,
          dispatch_checkpoints: 0
        })}\n`
      );
      process.exitCode = 1;
    });
}
