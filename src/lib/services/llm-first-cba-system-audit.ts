import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export const LLM_FIRST_CBA_AUDIT_VERSION = "phase31l-llm-first-cba-system-audit-v1";

export type AuditSeverity = "P0 classroom blocker" | "P1 required before pilot" | "P2 usability improvement" | "P3 later enhancement";

export type LlmFirstCbaFinding = {
  id: string;
  category: string;
  severity: AuditSeverity;
  observed_behavior: string;
  code_evidence: string[];
  user_impact: string;
  data_validity_risk: string;
  recommended_fix: string;
  recommended_phase: string;
  live_llm_testing_required: boolean;
  migration_required: boolean;
};

export type AgentInventoryEntry = {
  agent_name: string;
  purpose: string;
  primary_files: string[];
  prompt_version_source: string;
  schema_version_source: string;
  context_builder_evidence: string[];
  current_context_assessment_fields: string[];
  current_context_item_fields: string[];
  current_context_student_evidence: string[];
  boundary_controls: string[];
  missing_or_unverified_context: string[];
};

export type LlmFirstCbaAuditArtifact = {
  audit_version: typeof LLM_FIRST_CBA_AUDIT_VERSION;
  generated_at: string;
  source: "static_code_audit";
  openai_calls_made: 0;
  production_rows_modified: false;
  files_inspected: string[];
  agent_inventory: AgentInventoryEntry[];
  assessment_context_inventory: Record<string, {
    status: "present" | "partial" | "missing" | "unverified";
    evidence: string[];
    limitation?: string;
  }>;
  boundary_inventory: Record<string, {
    status: "present" | "partial" | "missing" | "unverified";
    evidence: string[];
    limitation?: string;
  }>;
  finding_counts: {
    by_severity: Record<AuditSeverity, number>;
    by_category: Record<string, number>;
  };
  p0_finding_ids: string[];
  p1_finding_ids: string[];
  findings: LlmFirstCbaFinding[];
  limitations: string[];
  artifact_hash: string;
};

const filesInspected = [
  "AGENTS.md",
  "docs/PRODUCT_SPEC.md",
  "docs/ASSESSMENT_FLOW.md",
  "docs/DATA_LOGGING_SPEC.md",
  "docs/SPEC_LOCK.md",
  "docs/DISTRACTOR_INFORMED_MISCONCEPTION_DIAGNOSIS.md",
  "docs/POST_ACTIVITY_MISCONCEPTION_EVIDENCE_UPDATE.md",
  "docs/CLASSROOM_PILOT_READINESS.md",
  "docs/RENDER_STAGING_DEPLOYMENT_RUNBOOK.md",
  "prisma/schema.prisma",
  "src/app/api/student/assessments/available/route.ts",
  "src/app/api/student/assessments/[assessmentPublicId]/sessions/start/route.ts",
  "src/app/api/student/sessions/[sessionPublicId]/initial/messages/route.ts",
  "src/app/api/student/sessions/[sessionPublicId]/activity-runtime/response/route.ts",
  "src/app/api/teacher/assessments/[assessmentPublicId]/items/route.ts",
  "src/app/api/teacher/assessments/[assessmentPublicId]/deletion/route.ts",
  "src/lib/services/assessment-availability/availability.ts",
  "src/lib/services/student-assessment/service.ts",
  "src/lib/services/student-assessment/item-administration-tutor.ts",
  "src/lib/services/student-assessment/profile-integration.ts",
  "src/lib/services/student-assessment/formative-value-determination.ts",
  "src/lib/services/student-assessment/formative-activity-live.ts",
  "src/lib/services/student-assessment/activity-misconception-evidence-live.ts",
  "src/lib/services/student-assessment/activity-runtime-ui.ts",
  "src/lib/services/student-assessment/ability-evidence.ts",
  "src/lib/services/student-assessment/engagement-evidence.ts",
  "src/lib/services/content/teacher-diagnostic-context.ts",
  "src/lib/services/content/items.ts",
  "src/lib/services/content/assessments.ts",
  "src/lib/services/content/assessment-deletion.ts",
  "src/lib/services/teacher-review/session-detail.ts",
  "src/lib/services/teacher-research-export/service.ts",
  "src/lib/llm/providers/openai-responses-provider.ts",
  "src/lib/llm/config.ts",
  "src/lib/agents/operational/executor.ts"
] as const;

const agentInventory: AgentInventoryEntry[] = [
  {
    agent_name: "item_administration_tutor_agent",
    purpose: "Classifies open-text initial-administration student messages, defers protected content questions, and returns student-safe tutor wording while the app owns state transitions.",
    primary_files: ["src/lib/services/student-assessment/item-administration-tutor.ts"],
    prompt_version_source: "ITEM_ADMINISTRATION_TUTOR_PROMPT_VERSION",
    schema_version_source: "ITEM_ADMINISTRATION_TUTOR_SCHEMA_VERSION",
    context_builder_evidence: ["ItemAdministrationTutorStatePacket"],
    current_context_assessment_fields: ["assessment_state"],
    current_context_item_fields: ["item_public_id", "item_order", "item_role", "selected_option"],
    current_context_student_evidence: ["latest_student_message", "prior_uncertainty", "recent_transcript_summary"],
    boundary_controls: ["correctness_feedback_prohibited", "content_question deferral", "answer_request deferral", "student-facing forbidden text scan"],
    missing_or_unverified_context: ["assessment title", "assessment diagnostic focus", "teacher diagnostic guidance", "item stem/options/key snapshot"]
  },
  {
    agent_name: "formative_value_and_planning_agent",
    purpose: "Chat-native formative profile and earlier formative planning paths; produces structured post-package formative profile text or planning decisions.",
    primary_files: [
      "src/lib/services/student-assessment/formative-profile.ts",
      "src/lib/agents/formative-planning/service.ts"
    ],
    prompt_version_source: "CHAT_NATIVE_PROFILE_PROMPT_VERSION / prompt registry",
    schema_version_source: "CHAT_NATIVE_PROFILE_SCHEMA_VERSION / prompt registry",
    context_builder_evidence: ["createResponsePackage", "response-package payloads", "redactForAudit"],
    current_context_assessment_fields: ["assessment_public_id through response package"],
    current_context_item_fields: ["item snapshots in response package"],
    current_context_student_evidence: ["responses", "reasoning", "confidence", "tempting option", "process summaries"],
    boundary_controls: ["student-facing validation", "answer-key leak checks", "internal-label leak checks"],
    missing_or_unverified_context: ["single shared version-bound assessment interpretation context contract", "explicit teacher-guidance versus observed-evidence partition"]
  },
  {
    agent_name: "profile_integration_agent",
    purpose: "Integrates ability and engagement evidence into current misconception/knowledge-state interpretation.",
    primary_files: ["src/lib/services/student-assessment/profile-integration.ts"],
    prompt_version_source: "PROFILE_INTEGRATION_PROMPT_VERSION",
    schema_version_source: "PROFILE_INTEGRATION_PACKET_SCHEMA_VERSION",
    context_builder_evidence: ["buildAbilityEvidencePacketForSession", "buildEngagementEvidencePacketForSession"],
    current_context_assessment_fields: ["assessment_public_id", "concept_unit_id"],
    current_context_item_fields: ["item evidence derived from evidence packets"],
    current_context_student_evidence: ["ability evidence packet", "engagement evidence packet"],
    boundary_controls: ["student-facing status whitelist", "integrity accusation prohibition", "answer-key leak validation"],
    missing_or_unverified_context: ["teacher diagnostic context propagation to every evidence packet", "session-bound assessment snapshot public ID"]
  },
  {
    agent_name: "formative_value_determination_agent",
    purpose: "Chooses the broad formative value after profile integration while preserving student choice.",
    primary_files: ["src/lib/services/student-assessment/formative-value-determination.ts"],
    prompt_version_source: "FORMATIVE_VALUE_PROMPT_VERSION",
    schema_version_source: "FORMATIVE_VALUE_PACKET_SCHEMA_VERSION",
    context_builder_evidence: ["ProfileIntegrationInterpretationPacketV1"],
    current_context_assessment_fields: ["session_public_id", "student_public_id", "assessment_public_id", "concept_unit_id"],
    current_context_item_fields: ["indirect through profile integration packet"],
    current_context_student_evidence: ["profile integration packet", "student choice state"],
    boundary_controls: ["no activity generation", "student choice policy", "student-facing safety checks"],
    missing_or_unverified_context: ["explicit teacher diagnostic context fields", "assessment snapshot/version ID"]
  },
  {
    agent_name: "formative_activity_dialogue_agent",
    purpose: "Generates live LLM first-turn formative activity packets after the protected package.",
    primary_files: ["src/lib/services/student-assessment/formative-activity-live.ts"],
    prompt_version_source: "formative activity prompt constants",
    schema_version_source: "FormativeActivityPacketV1Schema",
    context_builder_evidence: ["buildFormativeActivityDesignPacketFromPackets", "activity family packet"],
    current_context_assessment_fields: ["assessment_public_id through source packets"],
    current_context_item_fields: ["distractor role and source diagnostic purpose through packet"],
    current_context_student_evidence: ["profile integration packet", "formative value packet"],
    boundary_controls: ["reviewer pass", "forbidden scan", "runtime_servable_to_student flag"],
    missing_or_unverified_context: ["full authorized assessment-design context package", "teacher notes as guidance-only partition"]
  },
  {
    agent_name: "formative_activity_quality_reviewer_agent",
    purpose: "Reviews formative activity quality/safety before serving live LLM activity output.",
    primary_files: ["src/lib/services/student-assessment/formative-activity-live.ts"],
    prompt_version_source: "formative activity reviewer prompt constants",
    schema_version_source: "FormativeActivityQualityReviewV1",
    context_builder_evidence: ["reviewer receives generated packet and safety checklist"],
    current_context_assessment_fields: ["indirect through activity packet"],
    current_context_item_fields: ["indirect through activity packet"],
    current_context_student_evidence: ["source evidence summaries, not unrelated students"],
    boundary_controls: ["quality score", "issue codes", "repair path"],
    missing_or_unverified_context: ["explicit complete assessment context", "version-bound media/context not present yet"]
  },
  {
    agent_name: "activity_misconception_evidence_evaluator",
    purpose: "Evaluates student response to a formative activity and produces post-activity misconception evidence.",
    primary_files: ["src/lib/services/student-assessment/activity-misconception-evidence-live.ts"],
    prompt_version_source: "activity misconception evidence prompt constants",
    schema_version_source: "ActivityMisconceptionEvidencePacketV1",
    context_builder_evidence: ["ActivityMisconceptionEvidenceLiveEvaluationInput"],
    current_context_assessment_fields: ["assessment_public_id", "concept_unit_id"],
    current_context_item_fields: ["source activity packet ref and diagnostic purpose"],
    current_context_student_evidence: ["activity response", "prior activity packet", "pre-activity diagnostic state"],
    boundary_controls: ["student-safe feedback schema", "review_only/runtime flags", "post-activity snapshot validation"],
    missing_or_unverified_context: ["teacher diagnostic guidance separated from observed evidence", "media context"]
  }
];

const findings: LlmFirstCbaFinding[] = [
  {
    id: "31L-P1-CTX-001",
    category: "LLM context construction",
    severity: "P1 required before pilot",
    observed_behavior: "Production LLM calls use several agent-specific packets and prompts, but there is no single shared assessment-interpretation context contract proving that every substantive agent receives the same authorized assessment design boundaries.",
    code_evidence: [
      "src/lib/services/student-assessment/item-administration-tutor.ts: ItemAdministrationTutorStatePacket",
      "src/lib/services/student-assessment/profile-integration.ts: ability/engagement packets",
      "src/lib/services/student-assessment/formative-value-determination.ts: ProfileIntegrationInterpretationPacketV1"
    ],
    user_impact: "The student may receive LLM behavior that is locally safe but inconsistently informed across phases.",
    data_validity_risk: "Substantive interpretations may omit teacher design intent or treat packet-derived summaries as equivalent across agents.",
    recommended_fix: "Create a shared internal assessment-interpretation-context schema and propagate safe presence/hash metadata to every applicable agent call.",
    recommended_phase: "Phase 31M",
    live_llm_testing_required: false,
    migration_required: false
  },
  {
    id: "31L-P1-VER-001",
    category: "Assessment lifecycle/versioning",
    severity: "P1 required before pilot",
    observed_behavior: "ItemResponse stores item_snapshot, correct_option_snapshot, and item_version_snapshot, but assessment-level and diagnostic-note snapshot public IDs are not modeled as first-class session-bound references.",
    code_evidence: [
      "prisma/schema.prisma: ItemResponse.item_snapshot",
      "prisma/schema.prisma: AssessmentSession.assessment_db_id",
      "prisma/schema.prisma: ConceptUnit.version and Item.version"
    ],
    user_impact: "A completed session is partly interpretable from item snapshots, but assessment-level diagnostic focus and teacher-note edits need stronger version binding.",
    data_validity_risk: "Exports and later LLM context could silently rely on mutable current assessment metadata if not built from the administered snapshot.",
    recommended_fix: "Bind assessment/concept/item diagnostic context to a versioned context package at session start or fail closed when binding is unavailable.",
    recommended_phase: "Phase 31M / Phase 31N for media context",
    live_llm_testing_required: false,
    migration_required: true
  },
  {
    id: "31L-P1-LLM-001",
    category: "Substantive LLM dependence",
    severity: "P1 required before pilot",
    observed_behavior: "Several deterministic evidence packets classify ability, engagement, and formative value inputs for no-live and fallback paths. These should remain safety/audit supports rather than final classroom-valid diagnostic claims.",
    code_evidence: [
      "src/lib/services/student-assessment/ability-evidence.ts",
      "src/lib/services/student-assessment/engagement-evidence.ts",
      "src/lib/services/student-assessment/formative-value-determination.ts"
    ],
    user_impact: "Teacher/research displays may over-read deterministic categories if labels are not clearly framed as provisional process/evidence summaries.",
    data_validity_risk: "Deterministic categories can be mistaken for misconception diagnosis rather than evidence-quality context.",
    recommended_fix: "Keep deterministic categories as support features; ensure final substantive interpretation remains LLM-mediated and clearly labels uncertainty.",
    recommended_phase: "Phase 31M and later review polish",
    live_llm_testing_required: false,
    migration_required: false
  },
  {
    id: "31L-P2-UX-001",
    category: "Student experience",
    severity: "P2 usability improvement",
    observed_behavior: "The interface is chat-native for the student path, but initial item selection and state transitions are still visibly app-mediated. This is appropriate for answer-key protection but can feel less like direct conversation with an informed tutor.",
    code_evidence: [
      "src/components/student-assessment/assessment-session-client.tsx",
      "src/lib/student-assessment/state-machine.ts",
      "src/lib/services/student-assessment/item-administration-tutor.ts"
    ],
    user_impact: "Students may experience a hybrid chat/control interface rather than a fully natural LLM conversation.",
    data_validity_risk: "Low risk; strict controls preserve protected administration.",
    recommended_fix: "Preserve app-owned state while adding clearer conversational framing and tutor-source audit visibility in teacher/research views.",
    recommended_phase: "Later UI polish",
    live_llm_testing_required: false,
    migration_required: false
  },
  {
    id: "31L-P2-MULTI-001",
    category: "Multi-assessment logic",
    severity: "P2 usability improvement",
    observed_behavior: "Assessment availability, release/close windows, ordering, completion, and resume paths exist, but more browser QA is needed with many concurrently published mini tests.",
    code_evidence: [
      "src/lib/services/assessment-availability/availability.ts",
      "src/components/student-assessment/available-assessments-client.tsx",
      "prisma/schema.prisma: Assessment.release_at, close_at, folder_label, assessment_order_index"
    ],
    user_impact: "A course with many mini tests could be confusing if module/week grouping and completed/in-progress distinctions are not visually clear enough.",
    data_validity_risk: "Wrong-assessment entry would be P0; current code has explicit assessment public ID start routes, but needs high-coverage QA.",
    recommended_fix: "Add multi-assessment browser QA with simultaneous released/closed/completed/in-progress assessments.",
    recommended_phase: "Pre-pilot QA",
    live_llm_testing_required: false,
    migration_required: false
  },
  {
    id: "31L-P2-OPS-001",
    category: "Classroom operations",
    severity: "P2 usability improvement",
    observed_behavior: "Local and Render readiness scripts exist, but classroom live-call failure states still need operator rehearsal with real staging env and no paid provider stress testing.",
    code_evidence: [
      "docs/RENDER_STAGING_DEPLOYMENT_RUNBOOK.md",
      "src/lib/llm/readiness.ts",
      "prisma/student-classroom-pilot-readiness-smoke-test.ts"
    ],
    user_impact: "Teachers need clear failure messaging when a provider call is blocked or unavailable.",
    data_validity_risk: "Low to medium; data persistence usually occurs before provider calls, but live staging recovery must be rehearsed.",
    recommended_fix: "Run private staging dry run with synthetic users and confirm failure copy, retry behavior, and teacher audit signals.",
    recommended_phase: "Pre-pilot operations rehearsal",
    live_llm_testing_required: false,
    migration_required: false
  },
  {
    id: "31L-P2-EXPORT-001",
    category: "Research-data integrity",
    severity: "P2 usability improvement",
    observed_behavior: "Teacher/research exports include broad evidence and deletion behavior, but assessment snapshot IDs and future media-version IDs need explicit export columns once modeled.",
    code_evidence: [
      "src/lib/services/teacher-research-export/service.ts",
      "docs/DATA_LOGGING_SPEC.md",
      "prisma/schema.prisma: ActivityRuntimeAttempt, ActivityMisconceptionEvidenceRecord, PostActivityDiagnosticSnapshot"
    ],
    user_impact: "Researchers can inspect existing evidence, but version joins need to become more explicit as teacher-authored content evolves.",
    data_validity_risk: "Medium if exported rows cannot be joined to exact administered content and media context.",
    recommended_fix: "Extend exports with assessment/item/media snapshot public IDs after the version-bound context model is added.",
    recommended_phase: "Phase 31M/31N and export follow-up",
    live_llm_testing_required: false,
    migration_required: true
  }
];

function countFindingsBySeverity() {
  const severities: AuditSeverity[] = [
    "P0 classroom blocker",
    "P1 required before pilot",
    "P2 usability improvement",
    "P3 later enhancement"
  ];
  return Object.fromEntries(
    severities.map((severity) => [
      severity,
      findings.filter((finding) => finding.severity === severity).length
    ])
  ) as Record<AuditSeverity, number>;
}

function countFindingsByCategory() {
  const counts: Record<string, number> = {};
  for (const finding of findings) {
    counts[finding.category] = (counts[finding.category] ?? 0) + 1;
  }
  return counts;
}

function hashAudit(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function withoutHash(artifact: Omit<LlmFirstCbaAuditArtifact, "artifact_hash">) {
  return artifact;
}

export function buildLlmFirstCbaSystemAuditArtifact(
  generatedAt = new Date().toISOString()
): LlmFirstCbaAuditArtifact {
  const base = {
    audit_version: LLM_FIRST_CBA_AUDIT_VERSION,
    generated_at: generatedAt,
    source: "static_code_audit" as const,
    openai_calls_made: 0 as const,
    production_rows_modified: false,
    files_inspected: [...filesInspected],
    agent_inventory: agentInventory,
    assessment_context_inventory: {
      assessment_public_id: {
        status: "present",
        evidence: ["AssessmentSession.assessment_db_id", "agent packets include assessment_public_id"]
      },
      assessment_title: {
        status: "partial",
        evidence: ["Assessment.title", "content serializers include title"],
        limitation: "Not proven to reach every production LLM call."
      },
      assessment_diagnostic_focus: {
        status: "partial",
        evidence: ["Assessment.diagnostic_focus", "teacher item builder smoke validates storage"],
        limitation: "Propagation to every production LLM agent requires Phase 31M context contract."
      },
      item_stem_options_key_snapshot: {
        status: "present",
        evidence: ["ItemResponse.item_snapshot", "ItemResponse.correct_option_snapshot", "ItemResponse.item_version_snapshot"]
      },
      teacher_target_reasoning_and_distractor_notes: {
        status: "partial",
        evidence: ["teacher_diagnostic_context metadata utilities", "response package may include internal teacher diagnostic context"],
        limitation: "No single context-presence audit currently proves every substantive LLM received it."
      },
      safe_process_timing_summaries: {
        status: "present",
        evidence: ["engagement evidence packet", "process_events", "DATA_LOGGING_SPEC process features"]
      },
      post_activity_evidence: {
        status: "present",
        evidence: ["ActivityMisconceptionEvidenceRecord", "PostActivityDiagnosticSnapshot", "activity runtime services"]
      },
      media_context: {
        status: "missing",
        evidence: ["No item media model exists in prisma/schema.prisma as of this audit."],
        limitation: "Phase 31N should add version-bound media metadata and LLM media context."
      }
    },
    boundary_inventory: {
      answer_key_protection: {
        status: "present",
        evidence: ["student serializers", "student-facing validation", "item administration tutor protected rules"]
      },
      procedural_not_content_help_initial_admin: {
        status: "present",
        evidence: ["item administration tutor content_question and answer_request handling"]
      },
      teacher_notes_not_student_visible: {
        status: "present",
        evidence: ["teacher diagnostic context is internal metadata", "student preview safety tests"]
      },
      teacher_guidance_not_ground_truth: {
        status: "partial",
        evidence: ["profile integration prompt states evidence limitations"],
        limitation: "Needs one shared context contract that labels teacher guidance separately from observed evidence."
      },
      selected_option_indirect_evidence_only: {
        status: "partial",
        evidence: ["PRODUCT_SPEC and profile prompts warn correctness is insufficient"],
        limitation: "Needs context metadata and tests across every substantive agent."
      },
      no_misconduct_accusation: {
        status: "present",
        evidence: ["profile integration prompt prohibits integrity/misconduct language"]
      },
      no_openai_in_audit: {
        status: "present",
        evidence: ["This audit command is static and sets openai_calls_made to 0."]
      }
    },
    finding_counts: {
      by_severity: countFindingsBySeverity(),
      by_category: countFindingsByCategory()
    },
    p0_finding_ids: findings
      .filter((finding) => finding.severity === "P0 classroom blocker")
      .map((finding) => finding.id),
    p1_finding_ids: findings
      .filter((finding) => finding.severity === "P1 required before pilot")
      .map((finding) => finding.id),
    findings,
    limitations: [
      "Static audit only; no paid live LLM calls were made.",
      "No browser walkthrough, concurrency/load test, or provider stress test was performed.",
      "File evidence is path-level and field-level; it does not include verbatim prompts, verbatim student text, answer keys, secrets, or provider outputs.",
      "Phase 31M should replace partial context-propagation findings with executable context-presence tests."
    ]
  } satisfies Omit<LlmFirstCbaAuditArtifact, "artifact_hash">;

  return {
    ...base,
    artifact_hash: hashAudit(withoutHash(base))
  };
}

export function assertLlmFirstCbaAuditArtifactIsSafe(artifact: LlmFirstCbaAuditArtifact) {
  const serialized = JSON.stringify(artifact);
  const forbiddenPatterns = [
    /sk-(?:proj|svcacct)-[A-Za-z0-9_-]{20,}/u,
    /DATABASE_URL\s*=/iu,
    /SESSION_SECRET\s*=/iu,
    /BEGIN\s+(?:RSA|OPENSSH|PRIVATE)\s+KEY/u,
    /\bcorrect_option_snapshot"\s*:\s*"[A-F]"/u,
    /\braw_student_response\b/iu,
    /\braw_provider_output\b/iu
  ];

  for (const pattern of forbiddenPatterns) {
    if (pattern.test(serialized)) {
      throw new Error(`Audit artifact contains protected content matching ${pattern.source}.`);
    }
  }
}

export async function writeLlmFirstCbaSystemAuditArtifact(options: {
  outputDir?: string;
  generatedAt?: string;
} = {}) {
  const artifact = buildLlmFirstCbaSystemAuditArtifact(options.generatedAt);
  assertLlmFirstCbaAuditArtifactIsSafe(artifact);

  const outputDir =
    options.outputDir ?? path.join(process.cwd(), ".data", "llm-first-cba-system-audit");
  await mkdir(outputDir, { recursive: true });
  const safeTimestamp = artifact.generated_at.replace(/[:.]/g, "-");
  const filePath = path.join(outputDir, `llm-first-cba-system-audit-${safeTimestamp}.json`);
  await writeFile(filePath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  return { artifact, file_path: filePath };
}
