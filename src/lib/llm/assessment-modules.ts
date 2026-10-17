/**
 * The five functional modules described in the dissertation (Section 3.1) and the
 * application AI roles that implement each one.
 *
 * Design decision D6 (docs/DESIGN_ALIGNMENT_2026-10-17.md, docs/AI_ROLES_AND_MODULES.md):
 * the internal roles stay separate because each has its own prompt, output schema
 * and validator, but the system runs five model configurations, one per module
 * (D9, five-module model policy). The module-level OPENAI_MODEL_MODULE_* variable
 * is authoritative; an older role-specific OPENAI_MODEL_* variable applies only
 * when its module variable is unset. An active operational approval bundle
 * overrides environment configuration, exactly as before; the readiness page
 * reports whether the bundle follows the five-module policy.
 *
 * This file has no runtime dependencies so it can be imported by configuration,
 * documentation tooling and tests.
 */

export const ASSESSMENT_MODULES = [
  "item_preparation",
  "item_administration",
  "profiling_and_feedback",
  "formative_conversation",
  "instructor_reporting"
] as const;

export type AssessmentModule = (typeof ASSESSMENT_MODULES)[number];

export type AssessmentModuleDefinition = {
  module: AssessmentModule;
  dissertation_section: string;
  title: string;
  responsibility: string;
  model_env_key: string;
  reasoning_env_key: string;
};

export const ASSESSMENT_MODULE_DEFINITIONS: Record<AssessmentModule, AssessmentModuleDefinition> = {
  item_preparation: {
    module: "item_preparation",
    dissertation_section: "3.1.1",
    title: "Item preparation",
    responsibility:
      "Help instructors draft, adapt, format and check MCQs and their specifications before subject-matter review.",
    model_env_key: "OPENAI_MODEL_MODULE_ITEM_PREPARATION",
    reasoning_env_key: "OPENAI_REASONING_EFFORT_MODULE_ITEM_PREPARATION"
  },
  item_administration: {
    module: "item_administration",
    dissertation_section: "3.1.2",
    title: "Item administration",
    responsibility:
      "Collect the answer, justification, confidence and alternative-option reasoning without correctness feedback or hints.",
    model_env_key: "OPENAI_MODEL_MODULE_ITEM_ADMINISTRATION",
    reasoning_env_key: "OPENAI_REASONING_EFFORT_MODULE_ITEM_ADMINISTRATION"
  },
  profiling_and_feedback: {
    module: "profiling_and_feedback",
    dissertation_section: "3.1.3",
    title: "Student profiling and feedback generation",
    responsibility:
      "Interpret the sealed initial record into an instructor-facing understanding profile (retaining uncertainty) and student-facing tailored feedback.",
    model_env_key: "OPENAI_MODEL_MODULE_PROFILING_FEEDBACK",
    reasoning_env_key: "OPENAI_REASONING_EFFORT_MODULE_PROFILING_FEEDBACK"
  },
  formative_conversation: {
    module: "formative_conversation",
    dissertation_section: "3.1.4",
    title: "Formative conversation",
    responsibility:
      "Conduct the optional conversation (up to 30 student turns per mini-test) that the student may redirect or end at any point.",
    model_env_key: "OPENAI_MODEL_MODULE_FORMATIVE_CONVERSATION",
    reasoning_env_key: "OPENAI_REASONING_EFFORT_MODULE_FORMATIVE_CONVERSATION"
  },
  instructor_reporting: {
    module: "instructor_reporting",
    dissertation_section: "3.1.5",
    title: "Instructor reporting",
    responsibility:
      "Review all students' sealed response packages and conversation transcripts for a mini-test and write an evidence-linked instructor report.",
    model_env_key: "OPENAI_MODEL_MODULE_INSTRUCTOR_REPORTING",
    reasoning_env_key: "OPENAI_REASONING_EFFORT_MODULE_INSTRUCTOR_REPORTING"
  }
};

export type RoleUsage =
  /** Reached in the current student or teacher workflow. */
  | "current_workflow"
  /** Kept for earlier-phase workflows, evaluations or replays; not reached by the current student flow. */
  | "retained_legacy_path"
  /** May be called by the current workflow depending on configuration; confirm with AgentCall records. */
  | "conditional"
  /** Operational utility, not an assessment function. */
  | "utility";

export type AssessmentRoleDefinition = {
  role: string;
  module: AssessmentModule | "utility";
  usage: RoleUsage;
  responsibility: string;
};

/** Every application AI role, grouped by dissertation module. */
export const ASSESSMENT_ROLE_DEFINITIONS: readonly AssessmentRoleDefinition[] = [
  { role: "mcq_diagnostic_authoring_assistant_agent", module: "item_preparation", usage: "current_workflow",
    responsibility: "Evidence-centred blueprint conversation and draft item generation for teacher review." },
  { role: "mcq_import_formatting_assistant_agent", module: "item_preparation", usage: "current_workflow",
    responsibility: "Suggests structure/formatting fixes for imported MCQs; never changes a confirmed key." },
  { role: "item_verification_agent", module: "item_preparation", usage: "current_workflow",
    responsibility: "Checks structural completeness and flags ambiguous wording, cues and weak distractors before publishing." },

  { role: "item_administration_tutor_agent", module: "item_administration", usage: "current_workflow",
    responsibility: "Classifies each typed justification/alternative reason; its wording is replaced by fixed neutral text." },
  { role: "response_collection_agent", module: "item_administration", usage: "retained_legacy_path",
    responsibility: "Free-text response collection (initial/messages route); not called by the current student UI." },

  { role: "student_profiling_agent", module: "profiling_and_feedback", usage: "current_workflow",
    responsibility: "Builds the canonical initial understanding profile used by the conversation and the dashboard." },
  { role: "profile_integration_agent", module: "profiling_and_feedback", usage: "current_workflow",
    responsibility: "Integrates item-level evidence and engagement context into an evidence packet." },
  { role: "formative_value_and_planning_agent", module: "profiling_and_feedback", usage: "current_workflow",
    responsibility: "Writes the student-facing tailored feedback and the formative plan after submission." },
  { role: "formative_value_determination_agent", module: "profiling_and_feedback", usage: "conditional",
    responsibility: "Formative value decision used when building the evidence-integrated feedback bundle." },
  { role: "student_communication_agent", module: "profiling_and_feedback", usage: "conditional",
    responsibility: "Drafts student-facing feedback wording inside the evidence-integrated bundle when its live toggle is on." },

  { role: "formative_conversation_agent", module: "formative_conversation", usage: "current_workflow",
    responsibility: "The optional learning conversation (v18r2 runtime), with the bounded delivery reviewer." },
  { role: "followup_agent", module: "formative_conversation", usage: "retained_legacy_path",
    responsibility: "Earlier follow-up conversation (requires the legacy followup_active phase)." },
  { role: "topic_dialogue_agent", module: "formative_conversation", usage: "retained_legacy_path",
    responsibility: "Earlier post-activity topic dialogue." },
  { role: "formative_activity_dialogue_agent", module: "formative_conversation", usage: "retained_legacy_path",
    responsibility: "Earlier structured formative activity." },
  { role: "formative_activity_quality_reviewer_agent", module: "formative_conversation", usage: "retained_legacy_path",
    responsibility: "Earlier activity quality review." },
  { role: "formative_activity_response_evaluator_agent", module: "formative_conversation", usage: "retained_legacy_path",
    responsibility: "Earlier activity response evaluation." },
  { role: "post_activity_evidence_evaluator_agent", module: "formative_conversation", usage: "retained_legacy_path",
    responsibility: "Earlier post-activity evidence evaluation." },

  { role: "instructor_report_agent", module: "instructor_reporting", usage: "current_workflow",
    responsibility: "Reviews all sealed response packages and conversation transcripts for a mini-test and writes the instructor report." },

  { role: "connectivity_test", module: "utility", usage: "utility",
    responsibility: "Provider connectivity check." }
] as const;

export type ModuleReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh" | "max";

export type ModuleModelSelection = {
  model: string;
  reasoning_effort: ModuleReasoningEffort;
  /** Why this model and effort balance accuracy, capability, cost and response time. */
  rationale: string;
  /** What evidence supports the selection in this application. */
  evidence: string;
};

export const MODULE_MODEL_POLICY_VERSION = "five-module-model-policy-v1";

/**
 * D9: the selected model and reasoning effort for each module (2026-10-17).
 * Modules 1-4 keep the configuration verified live in release CMCQ-20261013-03, so no
 * new approval bundle is needed. Changing any entry requires the evaluation and
 * approval steps in docs/AI_ROLES_AND_MODULES.md before production use.
 */
export const MODULE_MODEL_POLICY: Record<AssessmentModule, ModuleModelSelection> = {
  item_preparation: {
    model: "gpt-5.6-luna",
    reasoning_effort: "medium",
    rationale:
      "Teacher-facing drafting and checking; every item is reviewed by the instructor before publishing, so a fast, low-cost model is sufficient.",
    evidence: "Verified live configuration (CMCQ-20261013-03)."
  },
  item_administration: {
    model: "gpt-5.6-luna",
    reasoning_effort: "medium",
    rationale:
      "Runs once per answered item while the student waits, so response time and cost matter most; its wording is replaced by fixed neutral text.",
    evidence:
      "Verified live configuration (CMCQ-20261013-03). Luna low failed profiling validation in CMCQ-20261013-01, so low effort is not used."
  },
  profiling_and_feedback: {
    model: "gpt-5.6-luna",
    reasoning_effort: "medium",
    rationale:
      "Runs once per submitted attempt; profile-fidelity safeguards and one audited repair keep quotations and confidence faithful at low cost.",
    evidence: "All seven profiles validated after the profile-fidelity corrections (CMCQ-20261013-02/03)."
  },
  formative_conversation: {
    model: "gpt-6.1-sol",
    reasoning_effort: "medium",
    rationale:
      "The most demanding task: multi-turn tutoring that must track evidence, honour deferrals and stop requests, and avoid inaccurate recaps.",
    evidence: "All-Luna tutoring failed review; GPT-6.1 Sol medium passed seven reviewed simulations (CMCQ-20261013-03)."
  },
  instructor_reporting: {
    model: "gpt-6.1-sol",
    reasoning_effort: "medium",
    rationale:
      "Synthesises a whole class's records with exact quotations; run rarely by the instructor, so a stronger model costs little and latency is acceptable.",
    evidence: "New module; quotation and reference checks are enforced by the application. Review sample reports before relying on them."
  }
};

export type ModulePolicyRoleConfig = {
  role: string;
  model: string | null;
  reasoning_effort: string | null;
};

export type ModulePolicyStatus = {
  module: AssessmentModule;
  selected: { model: string; reasoning_effort: ModuleReasoningEffort };
  /** Distinct model/effort pairs used by the module's current-workflow roles. */
  configured: Array<{ model: string | null; reasoning_effort: string | null; roles: string[] }>;
  /** True when every current-workflow role in the module uses one configuration. */
  single_configuration: boolean;
  matches_selected: boolean;
};

/**
 * Summarises whether the resolved role configurations follow the five-module policy.
 * Only roles reached by the current workflow are counted; retained legacy roles are
 * listed separately in docs/AI_ROLES_AND_MODULES.md.
 */
export function moduleModelPolicyStatus(configs: readonly ModulePolicyRoleConfig[]): ModulePolicyStatus[] {
  return ASSESSMENT_MODULES.map((module) => {
    const selected = MODULE_MODEL_POLICY[module];
    const roles = new Set(
      ASSESSMENT_ROLE_DEFINITIONS
        .filter((entry) => entry.module === module && entry.usage === "current_workflow")
        .map((entry) => entry.role)
    );
    const groups = new Map<string, { model: string | null; reasoning_effort: string | null; roles: string[] }>();
    for (const config of configs) {
      if (!roles.has(config.role)) continue;
      const key = `${config.model ?? ""}\u0000${config.reasoning_effort ?? ""}`;
      const group = groups.get(key) ?? { model: config.model, reasoning_effort: config.reasoning_effort, roles: [] };
      group.roles.push(config.role);
      groups.set(key, group);
    }
    const configured = [...groups.values()];
    const single = configured.length === 1;
    return {
      module,
      selected: { model: selected.model, reasoning_effort: selected.reasoning_effort },
      configured,
      single_configuration: single,
      matches_selected: single && configured[0].model === selected.model &&
        configured[0].reasoning_effort === selected.reasoning_effort
    };
  });
}

export function moduleForRole(role: string): AssessmentModule | "utility" | null {
  return ASSESSMENT_ROLE_DEFINITIONS.find((entry) => entry.role === role)?.module ?? null;
}

export function rolesForModule(module: AssessmentModule) {
  return ASSESSMENT_ROLE_DEFINITIONS.filter((entry) => entry.module === module);
}
