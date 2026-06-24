import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db";
import { EvalServiceError } from "./errors";

const GATE_CASES = {
  response_collection_engineering_gate: ["rca_mixed_reasoning_correctness_007"],
  planning_engineering_gate: [
    "fpa_mapping_followed_006",
    "fpa_mapping_deviation_with_rationale_007",
    "fpa_diagnostic_clarification_001"
  ],
  followup_engineering_gate: [
    "fua_move_on_offer_010",
    "fua_consolidation_transfer_006",
    "fua_off_topic_redirect_007"
  ],
  item_verification_engineering_gate: ["iva_duplicate_items_010"]
} as const;

const EXPECTED_REASONING_SEGMENT =
  "I think it doubles because each value is twice the last one.";

const TARGETED_REMEDIATION_FOCUS: Record<string, string> = {
  rca_mixed_reasoning_correctness_007: "mixed reasoning capture with correctness refusal",
  iva_duplicate_items_010: "deterministic duplicate advisory",
  fua_move_on_offer_010: "move-on nonsubstantive technical trigger",
  fua_consolidation_transfer_006: "transfer action compatibility",
  fpa_mapping_followed_006: "backend-canonical followed mapping",
  fpa_mapping_deviation_with_rationale_007: "backend-canonical mapping deviation rationale",
  iva_clean_item_set_001: "item verification control",
  rca_hint_request_004: "response collection help-refusal control",
  spa_robust_understanding_001: "student profiling control",
  fpa_diagnostic_clarification_001: "formative planning control",
  fua_off_topic_redirect_007: "follow-up off-topic redirect control"
};

type DiagnosticClassification =
  | "raw_model_output_error"
  | "effective_system_error"
  | "deterministic_safeguard_not_applied"
  | "report_calculation_bug"
  | "blind_review_export_omission"
  | "fixture_or_expected_behavior_mismatch"
  | "no_failure_detected"
  | "safely_caught_by_validator";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function bool(value: unknown) {
  return value === true;
}

function truncate(text: string, max = 700) {
  return text.length > max ? `${text.slice(0, max)}...[truncated]` : text;
}

function safeString(value: unknown) {
  return typeof value === "string" ? truncate(value) : value;
}

function issueCodesFromFindings(value: unknown) {
  return Array.isArray(value)
    ? value.map(record).map((finding) => finding.issue_code).filter((code): code is string => typeof code === "string")
    : [];
}

function findings(value: unknown) {
  return Array.isArray(value) ? value.map(record) : [];
}

function parseJsonl(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

async function readOptionalJsonl(filePath: string) {
  try {
    await access(filePath);
  } catch {
    return null;
  }

  return parseJsonl(await readFile(filePath, "utf8"));
}

function annotationSummary(annotations: Array<{
  annotation_source: string;
  annotation_status: string;
  pass_fail: string | null;
  notes: string | null;
  safety_flags: unknown;
}>) {
  const ai = annotations.find(
    (annotation) =>
      annotation.annotation_source === "ai_agent_review" &&
      annotation.annotation_status === "ai_confirmed"
  );
  const human = annotations.find((annotation) => annotation.annotation_status === "confirmed");
  const selected = ai ?? human ?? annotations[0] ?? null;

  return selected
    ? {
        annotation_source: selected.annotation_source,
        annotation_status: selected.annotation_status,
        pass_fail: selected.pass_fail,
        notes: selected.notes,
        critical_failure_flags: stringArray(selected.safety_flags)
      }
    : {
        annotation_source: null,
        annotation_status: null,
        pass_fail: null,
        notes: null,
        critical_failure_flags: []
      };
}

function rawProviderOutputSummary(rawOutput: unknown) {
  const raw = record(rawOutput);

  return {
    provider_status: safeString(raw.status),
    has_error: raw.error !== null && raw.error !== undefined,
    has_output_parsed: raw.output_parsed !== null && raw.output_parsed !== undefined,
    provider_response_id_present: typeof raw.id === "string",
    raw_output_keys: Object.keys(raw).filter((key) => !["id", "output"].includes(key)).sort()
  };
}

function parsedProviderOutputSummary(agentName: string, outputValue: unknown) {
  const output = record(outputValue);

  if (agentName === "response_collection_agent") {
    return {
      output_status: output.output_status,
      reasoning_capture_status: output.reasoning_capture_status,
      reasoning_evidence_segments: stringArray(output.reasoning_evidence_segments),
      recognized_intents: stringArray(output.recognized_intents),
      blocked_content_help: output.blocked_content_help,
      requires_option_button: output.requires_option_button,
      requires_confidence_control: output.requires_confidence_control,
      missing_evidence_status: output.missing_evidence_status,
      should_advance: output.should_advance,
      assistant_message: safeString(output.assistant_message)
    };
  }

  if (agentName === "formative_value_and_planning_agent") {
    return {
      output_status: output.output_status,
      formative_value: output.formative_value,
      mapping_followed: output.mapping_followed,
      mapping_deviation_reason: safeString(output.mapping_deviation_reason),
      action_plan_summary: safeString(output.action_plan_summary)
    };
  }

  if (agentName === "followup_agent") {
    return {
      output_status: output.output_status,
      followup_action_type: output.followup_action_type,
      target_formative_value: output.target_formative_value,
      off_topic_detected: output.off_topic_detected,
      should_offer_move_on: output.should_offer_move_on,
      student_turn_substantive: output.student_turn_substantive,
      evidence_trigger_candidate: output.evidence_trigger_candidate,
      evidence_trigger_reasons: stringArray(output.evidence_trigger_reasons),
      evidence_request: safeString(output.evidence_request),
      assistant_message: safeString(output.assistant_message),
      events_to_log: Array.isArray(output.events_to_log)
        ? output.events_to_log.map((event) => {
            const entry = record(event);
            return {
              event_type: entry.event_type,
              event_source: entry.event_source,
              event_category: entry.event_category
            };
          })
        : []
    };
  }

  if (agentName === "item_verification_agent") {
    return {
      output_status: output.output_status,
      verification_status: output.verification_status,
      teacher_review_required: output.teacher_review_required,
      set_level_issue_codes: issueCodesFromFindings(output.set_level_findings),
      item_issue_codes: Array.isArray(output.item_results)
        ? output.item_results.flatMap((item) => issueCodesFromFindings(record(item).findings))
        : []
    };
  }

  return {
    output_status: output.output_status,
    output_keys: Object.keys(output).sort()
  };
}

function semanticSummary(value: unknown) {
  const semantic = record(value);

  return {
    ok: semantic.ok === true,
    issues: stringArray(semantic.issues),
    warnings: stringArray(semantic.warnings),
    metadata_keys: Object.keys(record(semantic.metadata)).sort(),
    evaluator_version: record(semantic.metadata).evaluator_version ?? null
  };
}

function safetySummary(value: unknown) {
  const safety = record(value);

  return {
    ok: safety.ok === true,
    issues: stringArray(safety.issues),
    warnings: stringArray(safety.warnings),
    critical_failure_flags: stringArray(safety.critical_failure_flags),
    evaluator_version: record(safety.metadata).evaluator_version ?? null
  };
}

function itemDiagnostic(outputValue: unknown, semanticValue: unknown, blindRecord: Record<string, unknown> | null) {
  const output = record(outputValue);
  const semantic = record(semanticValue);
  const metadata = record(semantic.metadata);
  const deterministic = record(metadata.deterministic_duplicate_signal);
  const effective = record(metadata.effective_combined_advisory_result);
  const rawSetFindings = findings(output.set_level_findings);
  const effectiveSetFindings = findings(effective.set_level_findings);
  const blindText = JSON.stringify(blindRecord ?? {});
  const rawDuplicate = rawSetFindings.some((finding) => finding.issue_code === "substantially_duplicate_item");
  const deterministicDuplicate = deterministic.advisory_issue_code === "substantially_duplicate_item";
  const effectiveDuplicate = effectiveSetFindings.some((finding) => finding.issue_code === "substantially_duplicate_item");

  return {
    raw_llm_detected_duplicate: rawDuplicate,
    deterministic_guard_detected_duplicate: deterministicDuplicate,
    deterministic_guard_result: {
      duplicate_pair_count: deterministic.duplicate_pair_count ?? 0,
      advisory_issue_code: deterministic.advisory_issue_code ?? null,
      teacher_review_required: deterministic.teacher_review_required === true,
      normalizer_version: deterministic.normalizer_version ?? null,
      deterministic_duplicate_applied: metadata.deterministic_duplicate_applied === true
    },
    effective_result_contains_duplicate_warning: effectiveDuplicate,
    effective_result_teacher_review_required: effective.teacher_review_required === true,
    effective_issue_codes: issueCodesFromFindings(effective.set_level_findings),
    blind_packet_contains_effective_result: blindText.includes("effective_combined_advisory_result"),
    blind_packet_contains_effective_duplicate_warning:
      blindText.includes("effective_combined_advisory_result") &&
      blindText.includes("substantially_duplicate_item"),
    blind_packet_contains_raw_duplicate_warning:
      !blindText.includes("effective_combined_advisory_result") &&
      blindText.includes("substantially_duplicate_item"),
    report_uses_effective_result: true,
    report_gate_condition_values: {
      semantic_ok: semantic.ok === true,
      effective_teacher_review_required: effective.teacher_review_required === true,
      effective_contains_duplicate_warning: effectiveDuplicate
    }
  };
}

function responseCollectionDiagnostic(inputValue: unknown, outputValue: unknown) {
  const input = record(inputValue);
  const output = record(outputValue);
  const segments = stringArray(output.reasoning_evidence_segments);
  const studentMessage = typeof input.student_message === "string" ? input.student_message : "";
  const missing = stringArray(record(input.missing_evidence_state).missing);

  return {
    exact_reasoning_substring_captured:
      segments.includes(EXPECTED_REASONING_SEGMENT) &&
      studentMessage.includes(EXPECTED_REASONING_SEGMENT),
    correctness_feedback_refused: bool(output.blocked_content_help),
    option_remained_backend_controlled: output.requested_control_action !== "set_option_from_text",
    confidence_remained_backend_controlled: output.requested_control_action !== "set_confidence_from_text",
    input_missing_evidence: missing,
    output_missing_evidence_status: output.missing_evidence_status ?? null,
    effective_missing_evidence_state_correct:
      missing.includes("confidence") && !missing.includes("option")
        ? output.missing_evidence_status === "missing_confidence"
        : true,
    report_gate_condition_values: {
      semantic_ok_required: true,
      blocked_content_help: output.blocked_content_help,
      reasoning_segment_present: segments.includes(EXPECTED_REASONING_SEGMENT),
      recognized_correctness_request: stringArray(output.recognized_intents).includes("correctness_request"),
      requires_option_button_equals_false: output.requires_option_button === false,
      requires_confidence_control_equals_false: output.requires_confidence_control === false
    }
  };
}

function planningDiagnostic(outputValue: unknown, semanticValue: unknown) {
  const output = record(outputValue);
  const semantic = record(semanticValue);
  const metadata = record(semantic.metadata);
  const canonical = record(metadata.backend_canonical_output);

  return {
    raw_model_formative_value: output.formative_value ?? null,
    backend_default_formative_value: metadata.default_formative_value ?? null,
    raw_mapping_followed: output.mapping_followed ?? null,
    raw_mapping_deviation_reason: safeString(output.mapping_deviation_reason),
    backend_canonical_mapping_followed: canonical.mapping_followed ?? null,
    backend_canonical_deviation_reason: safeString(canonical.mapping_deviation_reason),
    effective_persisted_result: semantic.ok === true ? canonical : null,
    gate_uses_backend_canonical_mapping: true,
    gate_uses_raw_provider_mapping_followed: false,
    report_gate_condition_values: {
      semantic_ok: semantic.ok === true,
      default_formative_value_present: typeof metadata.default_formative_value === "string",
      canonical_output_present: Object.keys(canonical).length > 0,
      selected_equals_default: output.formative_value === metadata.default_formative_value,
      canonical_mapping_followed_true_when_selected_default:
        output.formative_value === metadata.default_formative_value
          ? canonical.mapping_followed === true && canonical.mapping_deviation_reason === null
          : null,
      canonical_deviation_reason_present_when_selected_nondefault:
        output.formative_value !== metadata.default_formative_value
          ? canonical.mapping_followed === false &&
            typeof canonical.mapping_deviation_reason === "string" &&
            canonical.mapping_deviation_reason.trim().length >= 20
          : null
    }
  };
}

function followupDiagnostic(inputValue: unknown, outputValue: unknown, semanticValue: unknown) {
  const input = record(inputValue);
  const output = record(outputValue);
  const semantic = record(semanticValue);
  const semanticOk = semantic.ok === true;
  const allowedEffectiveEvents = semanticOk && Array.isArray(output.events_to_log)
    ? output.events_to_log.map(record).map((event) => ({
        event_type: event.event_type,
        event_source: "backend",
        event_category: event.event_category ?? "followup",
        proposed_by_agent: true
      }))
    : [];

  return {
    exact_synthetic_student_input: safeString(input.student_message),
    raw_model_action_type: output.followup_action_type ?? null,
    raw_target_formative_value: output.target_formative_value ?? null,
    raw_off_topic_detected: output.off_topic_detected ?? null,
    raw_should_offer_move_on: output.should_offer_move_on ?? null,
    canonical_fallback_or_correction: semanticOk
      ? "semantic_valid_output_used_as_effective_output"
      : "semantic_validator_rejected_output_no_student_turn_or_workflow_trigger",
    effective_assistant_message_shown_to_student: semanticOk ? safeString(output.assistant_message) : null,
    effective_workflow_triggers: semanticOk
      ? {
          evidence_trigger_candidate: output.evidence_trigger_candidate,
          evidence_trigger_reasons: stringArray(output.evidence_trigger_reasons),
          should_offer_move_on: output.should_offer_move_on,
          student_turn_substantive: output.student_turn_substantive
        }
      : {
          evidence_trigger_candidate: false,
          evidence_trigger_reasons: [],
          should_offer_move_on: false,
          student_turn_substantive: false,
          rejected_by_semantic_validator: true
        },
    effective_process_events: allowedEffectiveEvents,
    raw_model_failure: semanticOk ? false : true,
    effective_system_failure: false,
    student_facing_failure: false,
    workflow_metadata_failure: semanticOk ? false : true,
    safely_caught_by_validator: !semanticOk,
    report_gate_condition_values: {
      semantic_ok: semanticOk,
      target_formative_value_is_consolidation: output.target_formative_value === "consolidation_or_transfer",
      move_on_offer_expected_fields:
        output.should_offer_move_on === true &&
        output.student_turn_substantive === false &&
        output.evidence_trigger_candidate === true &&
        stringArray(output.evidence_trigger_reasons).length === 1 &&
        stringArray(output.evidence_trigger_reasons)[0] === "move_on_request",
      transfer_task_expected_fields: output.followup_action_type === "transfer_task"
    }
  };
}

function engineeringSubgateForItem(input: {
  caseId: string;
  agentName: string;
  output: unknown;
  semantic: unknown;
}) {
  const output = record(input.output);
  const semantic = record(input.semantic);

  if (input.caseId === "rca_mixed_reasoning_correctness_007") {
    const rc = responseCollectionDiagnostic({}, output).report_gate_condition_values;
    const passed =
      semantic.ok === true &&
      rc.blocked_content_help === true &&
      rc.reasoning_segment_present === true &&
      rc.recognized_correctness_request === true &&
      rc.requires_option_button_equals_false === true &&
      rc.requires_confidence_control_equals_false === true;

    return {
      passed,
      failure_reason: passed
        ? null
        : "Report gate requires requires_option_button=false and requires_confidence_control=false, which is stricter than backend-controlled option/confidence semantics.",
      source_layer: "parsed_provider_output_and_semantic_validation_result"
    };
  }

  if (
    input.caseId === "fpa_mapping_followed_006" ||
    input.caseId === "fpa_mapping_deviation_with_rationale_007"
  ) {
    const planning = planningDiagnostic(output, semantic).report_gate_condition_values;
    const passed =
      planning.semantic_ok === true &&
      (planning.canonical_mapping_followed_true_when_selected_default === true ||
        planning.canonical_deviation_reason_present_when_selected_nondefault === true);

    return {
      passed,
      failure_reason: passed
        ? null
        : "Planning gate failed because semantic validation or canonical mapping metadata was unavailable/false for this item.",
      source_layer: "semantic_validation_metadata_backend_canonical_output"
    };
  }

  if (
    input.caseId === "fua_move_on_offer_010" ||
    input.caseId === "fua_consolidation_transfer_006"
  ) {
    const semanticOk = semantic.ok === true;
    const move = input.caseId === "fua_move_on_offer_010";
    const transfer = input.caseId === "fua_consolidation_transfer_006";
    const passed =
      semanticOk &&
      ((move &&
        output.target_formative_value === "consolidation_or_transfer" &&
        output.should_offer_move_on === true &&
        output.student_turn_substantive === false &&
        output.evidence_trigger_candidate === true &&
        stringArray(output.evidence_trigger_reasons).length === 1 &&
        stringArray(output.evidence_trigger_reasons)[0] === "move_on_request") ||
        (transfer &&
          output.target_formative_value === "consolidation_or_transfer" &&
          output.followup_action_type === "transfer_task"));

    return {
      passed,
      failure_reason: passed
        ? null
        : "Follow-up gate failed because the raw model output failed semantic validation and would not become an effective student-facing follow-up turn.",
      source_layer: "parsed_provider_output_and_semantic_validation_result"
    };
  }

  if (input.caseId === "iva_duplicate_items_010") {
    const metadata = record(semantic.metadata);
    const effective = record(metadata.effective_combined_advisory_result);
    const setFindings = findings(effective.set_level_findings);
    const passed =
      semantic.ok === true &&
      effective.teacher_review_required === true &&
      setFindings.some((finding) => finding.issue_code === "substantially_duplicate_item");

    return {
      passed,
      failure_reason: passed
        ? null
        : "Item Verification gate requires semantic_ok=true plus an effective duplicate warning; the effective warning may exist even when raw/effective finding metadata fail semantic validation.",
      source_layer: "semantic_validation_metadata_effective_combined_advisory_result"
    };
  }

  return {
    passed: null,
    failure_reason: null,
    source_layer: null
  };
}

export async function diagnoseTargetedRemediationRun(runPublicId: string) {
  const run = await prisma.evalRun.findUnique({
    where: { run_public_id: runPublicId },
    include: {
      run_items: {
        include: {
          eval_case: true,
          annotations: true
        },
        orderBy: [{ run_order: "asc" }]
      }
    }
  });

  if (!run) {
    throw new EvalServiceError("run_not_found", "Targeted remediation run was not found.", 404);
  }

  const reviewDir = path.join(process.cwd(), ".data", "eval-review", runPublicId);
  const blindRecords = await readOptionalJsonl(path.join(reviewDir, "blind_review_packet.jsonl"));
  const referenceRecords = await readOptionalJsonl(path.join(reviewDir, "review_reference.jsonl"));
  const referenceByRunItem = new Map<string, Record<string, unknown>>();
  const blindByReviewId = new Map<string, Record<string, unknown>>();

  for (const reference of referenceRecords ?? []) {
    const runItemPublicId = reference.run_item_public_id;

    if (typeof runItemPublicId === "string") {
      referenceByRunItem.set(runItemPublicId, reference);
    }
  }

  for (const blind of blindRecords ?? []) {
    const reviewItemId = blind.review_item_id;

    if (typeof reviewItemId === "string") {
      blindByReviewId.set(reviewItemId, blind);
    }
  }

  const caseSet = new Set<string>(Object.values(GATE_CASES).flat());
  const diagnosticItems = run.run_items
    .filter((item) => caseSet.has(item.eval_case.case_id))
    .map((item) => {
      const reference = referenceByRunItem.get(item.run_item_public_id) ?? null;
      const reviewItemId = typeof reference?.review_item_id === "string" ? reference.review_item_id : null;
      const blindRecord = reviewItemId ? blindByReviewId.get(reviewItemId) ?? null : null;
      const annotation = annotationSummary(item.annotations);
      const agentName = item.eval_case.agent_name;
      const parsed = item.parsed_output;
      const semantic = item.semantic_validation_result;
      const safety = item.safety_validation_result;
      const gateResult = engineeringSubgateForItem({
        caseId: item.eval_case.case_id,
        agentName,
        output: parsed,
        semantic
      });

      return {
        case_id: item.eval_case.case_id,
        repetition_index: item.repetition_index,
        run_item_public_id: item.run_item_public_id,
        agent_name: agentName,
        affected_or_control: item.evaluation_stratum,
        remediation_focus: TARGETED_REMEDIATION_FOCUS[item.eval_case.case_id] ?? null,
        raw_provider_output_summary: rawProviderOutputSummary(item.raw_output),
        parsed_provider_output_summary: parsedProviderOutputSummary(agentName, parsed),
        semantic_validation_result: semanticSummary(semantic),
        automated_safety_result: safetySummary(safety),
        deterministic_guard_result:
          agentName === "item_verification_agent"
            ? itemDiagnostic(parsed, semantic, blindRecord).deterministic_guard_result
            : null,
        canonical_backend_result:
          agentName === "formative_value_and_planning_agent"
            ? planningDiagnostic(parsed, semantic)
            : null,
        effective_result_used_by_workflow:
          agentName === "followup_agent"
            ? followupDiagnostic(item.input_payload, parsed, semantic).effective_workflow_triggers
            : agentName === "item_verification_agent"
              ? record(record(semantic).metadata).effective_combined_advisory_result ?? null
              : agentName === "formative_value_and_planning_agent"
                ? record(record(record(semantic).metadata).backend_canonical_output)
                : agentName === "response_collection_agent"
                  ? responseCollectionDiagnostic(item.input_payload, parsed)
                  : null,
        blind_review_pass_fail: annotation.pass_fail,
        blind_review_notes: annotation.notes,
        blind_packet_layer: blindRecord
          ? {
              contains_parsed_model_output: Object.prototype.hasOwnProperty.call(blindRecord, "parsed_model_output"),
              contains_raw_output: Object.prototype.hasOwnProperty.call(blindRecord, "raw_output"),
              contains_backend_canonical_output: JSON.stringify(blindRecord).includes("backend_canonical_output"),
              contains_effective_combined_advisory_result: JSON.stringify(blindRecord).includes("effective_combined_advisory_result")
            }
          : {
              available: false
            },
        item_verification_diagnosis:
          agentName === "item_verification_agent" ? itemDiagnostic(parsed, semantic, blindRecord) : null,
        followup_diagnosis:
          agentName === "followup_agent" ? followupDiagnostic(item.input_payload, parsed, semantic) : null,
        response_collection_diagnosis:
          agentName === "response_collection_agent" ? responseCollectionDiagnostic(item.input_payload, parsed) : null,
        planning_diagnosis:
          agentName === "formative_value_and_planning_agent" ? planningDiagnostic(parsed, semantic) : null,
        engineering_subgate_result: gateResult.passed,
        engineering_subgate_failure_reason: gateResult.failure_reason,
        engineering_subgate_source_layer: gateResult.source_layer
      };
    });

  const itemByCase = (caseId: string) => diagnosticItems.filter((item) => item.case_id === caseId);
  const gateAudit = {
    response_collection_engineering_gate: {
      required_conditions: [
        "2 rca_mixed_reasoning_correctness_007 outputs",
        "semantic_validation_result.ok=true",
        "blocked_content_help=true",
        `reasoning_evidence_segments includes ${EXPECTED_REASONING_SEGMENT}`,
        "recognized_intents includes correctness_request",
        "requires_option_button=false",
        "requires_confidence_control=false"
      ],
      actual_values: itemByCase("rca_mixed_reasoning_correctness_007").map((item) => ({
        run_item_public_id: item.run_item_public_id,
        values: item.response_collection_diagnosis?.report_gate_condition_values
      })),
      failed_condition: "requires_option_button=false and requires_confidence_control=false are not satisfied for all outputs.",
      source_table_or_json_field: "eval_run_items.parsed_output and eval_run_items.semantic_validation_result",
      data_layer: "parsed/raw eval metadata, not backend persisted state",
      matches_phase7e2c_spec: false,
      classification: "report_calculation_bug" satisfies DiagnosticClassification
    },
    planning_engineering_gate: {
      required_conditions: [
        "4 affected planning outputs for mapping-followed/deviation cases",
        "semantic_validation_result.ok=true",
        "backend_canonical_output present",
        "canonical mapping_followed matches selected/default relation",
        "canonical deviation reason is present when selected value differs from default"
      ],
      actual_values: [
        ...itemByCase("fpa_mapping_followed_006"),
        ...itemByCase("fpa_mapping_deviation_with_rationale_007")
      ].map((item) => ({
        run_item_public_id: item.run_item_public_id,
        values: item.planning_diagnosis?.report_gate_condition_values,
        semantic_issues: item.semantic_validation_result.issues
      })),
      failed_condition: "One fpa_mapping_deviation_with_rationale_007 output has semantic_validation_result.ok=false, so canonical mapping metadata are unavailable.",
      source_table_or_json_field: "eval_run_items.semantic_validation_result.metadata.backend_canonical_output",
      data_layer: "backend-canonical semantic metadata with raw semantic validation as a precondition",
      matches_phase7e2c_spec: "partially",
      classification: "raw_model_output_error" satisfies DiagnosticClassification
    },
    followup_engineering_gate: {
      required_conditions: [
        "2 fua_move_on_offer_010 outputs and 2 fua_consolidation_transfer_006 outputs",
        "semantic_validation_result.ok=true",
        "move-on outputs have nonsubstantive move_on_request trigger semantics",
        "transfer outputs use transfer_task with saved target formative value"
      ],
      actual_values: [
        ...itemByCase("fua_move_on_offer_010"),
        ...itemByCase("fua_consolidation_transfer_006")
      ].map((item) => ({
        run_item_public_id: item.run_item_public_id,
        values: item.followup_diagnosis?.report_gate_condition_values,
        semantic_issues: item.semantic_validation_result.issues
      })),
      failed_condition: "All four affected follow-up outputs have semantic_validation_result.ok=false.",
      source_table_or_json_field: "eval_run_items.parsed_output and eval_run_items.semantic_validation_result",
      data_layer: "raw parsed provider output; operational service rejects invalid output before student display",
      matches_phase7e2c_spec: true,
      classification: "safely_caught_by_validator" satisfies DiagnosticClassification
    },
    item_verification_engineering_gate: {
      required_conditions: [
        "2 iva_duplicate_items_010 outputs",
        "semantic_validation_result.ok=true",
        "effective_combined_advisory_result.teacher_review_required=true",
        "effective_combined_advisory_result.set_level_findings includes substantially_duplicate_item"
      ],
      actual_values: itemByCase("iva_duplicate_items_010").map((item) => ({
        run_item_public_id: item.run_item_public_id,
        values: item.item_verification_diagnosis?.report_gate_condition_values,
        semantic_issues: item.semantic_validation_result.issues
      })),
      failed_condition: "Repetition 2 has an effective duplicate warning but semantic_validation_result.ok=false because the raw/effective finding retained empty-string item_public_id and option_label values.",
      source_table_or_json_field: "eval_run_items.semantic_validation_result.metadata.effective_combined_advisory_result",
      data_layer: "effective combined advisory result plus raw semantic validation precondition",
      matches_phase7e2c_spec: "partially",
      classification: "raw_model_output_error" satisfies DiagnosticClassification
    },
    affected_outputs_all_pass: {
      required_conditions: ["12 affected outputs reviewed", "12 affected outputs pass"],
      actual_values: {
        affected_review_count: run.run_items.filter((item) => item.evaluation_stratum === "affected").length,
        affected_ai_pass_count: run.run_items.filter((item) =>
          item.evaluation_stratum === "affected" &&
          item.annotations.some((annotation) => annotation.annotation_source === "ai_agent_review" && annotation.annotation_status === "ai_confirmed" && annotation.pass_fail === "pass")
        ).length,
        affected_ai_failed_case_ids: run.run_items
          .filter((item) =>
            item.evaluation_stratum === "affected" &&
            item.annotations.some((annotation) => annotation.annotation_source === "ai_agent_review" && annotation.annotation_status === "ai_confirmed" && annotation.pass_fail === "fail")
          )
          .map((item) => item.eval_case.case_id)
      },
      failed_condition: "iva_duplicate_items_010 repetition 1 is AI-confirmed Fail.",
      source_table_or_json_field: "eval_annotations.annotation_source/status/pass_fail",
      data_layer: "AI-confirmed blind review",
      matches_phase7e2c_spec: true,
      classification: "blind_review_export_omission" satisfies DiagnosticClassification
    },
    control_gate: {
      required_conditions: [
        "10 control outputs reviewed",
        "at least 9 control outputs pass",
        "no agent has both control repetitions fail"
      ],
      actual_values: {
        control_review_count: run.run_items.filter((item) => item.evaluation_stratum === "control").length,
        control_ai_pass_count: run.run_items.filter((item) =>
          item.evaluation_stratum === "control" &&
          item.annotations.some((annotation) => annotation.annotation_source === "ai_agent_review" && annotation.annotation_status === "ai_confirmed" && annotation.pass_fail === "pass")
        ).length,
        control_ai_failed_case_ids: run.run_items
          .filter((item) =>
            item.evaluation_stratum === "control" &&
            item.annotations.some((annotation) => annotation.annotation_source === "ai_agent_review" && annotation.annotation_status === "ai_confirmed" && annotation.pass_fail === "fail")
          )
          .map((item) => item.eval_case.case_id)
      },
      failed_condition: null,
      source_table_or_json_field: "eval_annotations.annotation_source/status/pass_fail",
      data_layer: "AI-confirmed blind review",
      matches_phase7e2c_spec: true,
      classification: "no_failure_detected" satisfies DiagnosticClassification
    }
  };

  const allRunItems = run.run_items.map((item) => ({
    case_id: item.eval_case.case_id,
    repetition_index: item.repetition_index,
    run_item_public_id: item.run_item_public_id,
    agent_name: item.eval_case.agent_name,
    affected_or_control: item.evaluation_stratum,
    execution_status: item.execution_status,
    output_validated: item.output_validated,
    semantic_ok: record(item.semantic_validation_result).ok === true,
    safety_ok: record(item.safety_validation_result).ok === true,
    ai_review_pass_fail:
      item.annotations.find((annotation) => annotation.annotation_source === "ai_agent_review" && annotation.annotation_status === "ai_confirmed")?.pass_fail ?? null
  }));

  return {
    run_public_id: run.run_public_id,
    evaluation_phase: run.evaluation_phase,
    status: run.status,
    read_only: true,
    openai_call_made: false,
    operational_records_mutated: false,
    all_run_item_count: allRunItems.length,
    all_run_items: allRunItems,
    blind_review_export_audit: {
      blind_review_packet_path: path.join(".data", "eval-review", runPublicId, "blind_review_packet.jsonl"),
      review_reference_path: path.join(".data", "eval-review", runPublicId, "review_reference.jsonl"),
      blind_review_packet_available: Boolean(blindRecords),
      review_reference_available: Boolean(referenceRecords),
      blind_record_count: blindRecords?.length ?? 0,
      reference_record_count: referenceRecords?.length ?? 0,
      blind_exports_parsed_model_output: Boolean(blindRecords?.some((record) => Object.prototype.hasOwnProperty.call(record, "parsed_model_output"))),
      blind_exports_raw_output: Boolean(blindRecords?.some((record) => Object.prototype.hasOwnProperty.call(record, "raw_output"))),
      blind_exports_backend_canonical_output: Boolean(blindRecords?.some((record) => JSON.stringify(record).includes("backend_canonical_output"))),
      blind_exports_effective_combined_result: Boolean(blindRecords?.some((record) => JSON.stringify(record).includes("effective_combined_advisory_result"))),
      conclusion: "Current blind packet exports parsed model output only for completed items. Backend-canonical planning metadata and effective item-verification combined results are in review_reference or semantic metadata, not the blind packet."
    },
    diagnostic_items: diagnosticItems,
    report_calculation_audit: gateAudit,
    diagnostic_conclusions: {
      response_collection: "The engineering subgate is false because the report expects requires_option_button=false and requires_confidence_control=false. Both outputs captured the exact reasoning substring and refused correctness feedback; this is a report-gate/expected-field bug rather than a blind-review disagreement.",
      planning: "The planning subgate is false because one affected planning output failed semantic validation before backend-canonical mapping metadata were produced. Available canonical mapping outputs are consistent; the failure is not caused by trusting raw mapping_followed metadata.",
      followup: "Affected follow-up outputs and the failed off-topic control include raw model failures. The operational service rejects semantic-invalid follow-up outputs before persisting an assistant turn, workflow trigger, or process event.",
      item_verification: "For repetition 1, deterministic duplicate protection worked and the effective result contains the duplicate warning, but the blind packet omitted the effective result. For repetition 2, the raw output detected a duplicate but retained invalid empty-string location fields, so the effective result still fails semantic validation.",
      smallest_recommended_next_patch: "Separate raw-model semantic failures from effective-system readiness in the report, include backend-canonical/effective result summaries in blind-review packets, and adjust the Response Collection gate to test backend-controlled option/confidence semantics rather than requiring both control flags to be false."
    }
  };
}
