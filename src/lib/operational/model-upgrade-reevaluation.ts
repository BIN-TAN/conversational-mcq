import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { stableHash } from "@/lib/agents/operational/approved-config";
import {
  buildOperationalModelUpgradeComparison,
  readCandidateOperationalModelConfig,
  resolveCandidateManifestPath
} from "@/lib/operational/model-upgrade";
import {
  MODEL_UPGRADE_ARTIFACT_ROOT,
  currentModelUpgradeEvaluationProtocolHash,
  evaluateModelUpgradeOutputLayers,
  loadModelUpgradeCase,
  loadModelUpgradeRun,
  modelUpgradeEvaluationFixtures,
  runDir,
  type CandidateEvaluationOutput,
  type EvaluationCaseRecord,
  type ModelUpgradeRunRecord
} from "@/lib/operational/model-upgrade-evaluation";
import { evaluateModelUpgradeSemanticCalibration } from "@/lib/operational/model-upgrade-evaluation-protocol";

export const MODEL_UPGRADE_REEVALUATION_VERSION = "model-upgrade-offline-reevaluation-v2";
export const MODEL_UPGRADE_DERIVED_REVIEW_VERSION = "model-upgrade-derived-human-review-v1";
export const MODEL_UPGRADE_DERIVED_APPROVAL_VERSION = "model-upgrade-derived-approval-v1";

export type ModelUpgradeDerivedCaseRecord = {
  fixture_id: string;
  role: EvaluationCaseRecord["role"];
  source_case_public_id: string;
  source_case_artifact_sha256: string;
  source_provider_evidence: {
    status: EvaluationCaseRecord["status"];
    provider_request_status: string;
    provider_request_id_present: boolean;
    provider_response_id_present: boolean;
    model_configured: string;
    model_resolved: string | null;
    validation_result: EvaluationCaseRecord["validation_result"];
    raw_output_hash: string | null;
    effective_output_hash: string | null;
    fallback_used: boolean;
  };
  effective_output: CandidateEvaluationOutput | null;
  original_findings: {
    automated_review_status: EvaluationCaseRecord["automated_review_status"];
    validator_results: EvaluationCaseRecord["validator_results"];
    semantic_adjudications: EvaluationCaseRecord["semantic_adjudications"];
    critical_failure: boolean;
    critical_failure_reasons: string[];
  };
  prior_derived_findings: Array<{
    derived_evaluation_id: string;
    evaluation_protocol_hash: string;
    derived_findings: ModelUpgradeDerivedCaseRecord["derived_findings"];
  }>;
  derived_findings: {
    fixture_preflight: ReturnType<typeof evaluateModelUpgradeOutputLayers>["fixture_preflight"];
    validator_results: ReturnType<typeof evaluateModelUpgradeOutputLayers>["validator_results"];
    semantic_adjudications: ReturnType<typeof evaluateModelUpgradeOutputLayers>["semantic_adjudications"];
    production_schema_fidelity: ReturnType<typeof evaluateModelUpgradeOutputLayers>["production_schema_fidelity"];
    critical_failure: boolean;
    critical_failure_reasons: string[];
    semantic_review_required: boolean;
    action_adjudication: ReturnType<typeof evaluateModelUpgradeOutputLayers>["action_adjudication"];
  };
};

export type ModelUpgradeDerivedEvaluationRecord = {
  derived_evaluation_id: string;
  reevaluation_version: string;
  source_provider_run_id: string;
  source_runtime_candidate_hash: string;
  source_evaluation_protocol_hash: string;
  runtime_candidate_hash: string;
  evaluation_protocol_hash: string;
  source_artifact_sha256: string;
  source_artifact_file_count: number;
  source_artifacts_immutable: boolean;
  prior_derived_evaluation: null | {
    derived_evaluation_id: string;
    evaluation_protocol_hash: string;
    artifact_sha256: string;
    artifact_file_count: number;
    artifacts_immutable: boolean;
  };
  provider_calls_made: 0;
  provider_evidence_intact: boolean;
  provider_evidence_issue_codes: string[];
  application_git_commit: string;
  candidate_manifest_path: string;
  candidate_manifest_hash: string;
  status: "completed_pending_review" | "completed_failed" | "completed_reviewed";
  recommendation:
    | "candidate_blocked_by_derived_failures"
    | "candidate_pending_derived_human_review"
    | "candidate_rejected_by_derived_human_review"
    | "candidate_eligible_for_explicit_approval";
  fixture_ids: string[];
  case_results: Array<{
    fixture_id: string;
    critical_failure: boolean;
    original_critical_failure: boolean;
    semantic_review_required: boolean;
  }>;
  semantic_calibration: ReturnType<typeof evaluateModelUpgradeSemanticCalibration>;
  human_review_status: "exported" | "approved" | "rejected";
  human_review: null | {
    reviewer: string;
    decision: "approve" | "reject";
    reviewed_at: string;
    artifact_path: string;
    artifact_sha256: string;
    reviewed_fixture_ids: string[];
    semantic_review_required_cases: string[];
    semantic_review_confirmed: boolean;
    runtime_candidate_hash: string;
    source_evaluation_protocol_hash: string;
    evaluation_protocol_hash: string;
  };
  review_artifact_paths: {
    review_records_jsonl: string;
    review_template_csv: string;
    review_summary_json: string;
  };
  created_at: string;
  completed_at: string;
};

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function writeJson(filePath: string, value: unknown) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function derivedId() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `omude_${date}_${randomBytes(4).toString("hex")}`;
}

export function modelUpgradeDerivedEvaluationDir(derivedEvaluationId: string) {
  return path.join(MODEL_UPGRADE_ARTIFACT_ROOT, "derived-evaluations", derivedEvaluationId);
}

function derivedRecordPath(derivedEvaluationId: string) {
  return path.join(modelUpgradeDerivedEvaluationDir(derivedEvaluationId), "evaluation.json");
}

function derivedCasePath(derivedEvaluationId: string, fixtureId: string) {
  return path.join(modelUpgradeDerivedEvaluationDir(derivedEvaluationId), "cases", `${fixtureId}.json`);
}

export function loadModelUpgradeDerivedEvaluation(derivedEvaluationId: string) {
  return readJson<ModelUpgradeDerivedEvaluationRecord>(derivedRecordPath(derivedEvaluationId));
}

export function loadModelUpgradeDerivedCase(derivedEvaluationId: string, fixtureId: string) {
  return readJson<ModelUpgradeDerivedCaseRecord>(derivedCasePath(derivedEvaluationId, fixtureId));
}

export function hashModelUpgradeSourceArtifacts(runPublicId: string, fixtureIds?: string[]) {
  const run = loadModelUpgradeRun(runPublicId);
  const ids = fixtureIds ?? run.fixture_ids;
  const paths = [
    path.join(runDir(runPublicId), "run.json"),
    ...ids.map((fixtureId) => path.join(runDir(runPublicId), "cases", `${fixtureId}.json`))
  ];
  const files = paths.map((filePath) => {
    if (!existsSync(filePath)) throw new Error(`source_artifact_missing:${path.basename(filePath)}`);
    const bytes = readFileSync(filePath, "utf8");
    return {
      relative_path: path.relative(runDir(runPublicId), filePath),
      sha256: sha256(bytes)
    };
  });
  return {
    artifact_sha256: stableHash(files),
    file_count: files.length,
    files
  };
}

export function hashModelUpgradeDerivedArtifacts(derivedEvaluationId: string, fixtureIds?: string[]) {
  const record = loadModelUpgradeDerivedEvaluation(derivedEvaluationId);
  const ids = fixtureIds ?? record.fixture_ids;
  const root = modelUpgradeDerivedEvaluationDir(derivedEvaluationId);
  const paths = [
    derivedRecordPath(derivedEvaluationId),
    ...ids.map((fixtureId) => derivedCasePath(derivedEvaluationId, fixtureId))
  ];
  const files = paths.map((filePath) => {
    if (!existsSync(filePath)) throw new Error(`prior_derived_artifact_missing:${path.basename(filePath)}`);
    return {
      relative_path: path.relative(root, filePath),
      sha256: sha256(readFileSync(filePath, "utf8"))
    };
  });
  return {
    artifact_sha256: stableHash(files),
    file_count: files.length,
    files
  };
}

function sourceProviderEvidenceStatus(run: ModelUpgradeRunRecord, cases: EvaluationCaseRecord[]) {
  const issues = [
    ...(!run.completed_at || !["completed_pending_review", "completed_failed", "completed_reviewed"].includes(run.status)
      ? ["source_provider_run_not_complete"]
      : []),
    ...(cases.length !== run.fixture_ids.length ? ["source_provider_cases_missing"] : []),
    ...(cases.some((entry) => entry.status !== "succeeded") ? ["source_provider_case_not_succeeded"] : []),
    ...(cases.some((entry) => entry.provider_request_status !== "completed") ? ["source_provider_request_not_completed"] : []),
    ...(cases.some((entry) => entry.validation_result !== "passed" || !entry.effective_output)
      ? ["source_effective_output_missing_or_invalid"]
      : []),
    ...(cases.some((entry) => !entry.raw_output_hash) ? ["source_raw_output_evidence_missing"] : []),
    ...(cases.some((entry) => !entry.provider_request_id && !entry.provider_response_id)
      ? ["source_provider_identifier_missing"]
      : []),
    ...(cases.some((entry) => entry.model_resolved !== entry.model_configured)
      ? ["source_model_resolution_mismatch"]
      : []),
    ...(cases.some((entry) => entry.fallback_used) ? ["source_fallback_used"] : [])
  ];
  return { intact: issues.length === 0, issue_codes: [...new Set(issues)] };
}

function derivedCriticalReasons(
  source: EvaluationCaseRecord,
  layers: ReturnType<typeof evaluateModelUpgradeOutputLayers>
) {
  return [
    ...(source.status !== "succeeded" ? ["source_provider_case_not_succeeded"] : []),
    ...(source.validation_result !== "passed" ? ["source_schema_validation_failed"] : []),
    ...(source.model_resolved !== source.model_configured ? ["source_model_resolution_mismatch"] : []),
    ...(layers.fixture_preflight.status !== "passed" ? ["fixture_preflight_invalid"] : []),
    ...(layers.validator_results.fact_consistency.critical
      ? layers.validator_results.fact_consistency.issue_codes.map((code) => `fact_consistency:${code}`)
      : []),
    ...(layers.validator_results.output_completeness.critical
      ? layers.validator_results.output_completeness.issue_codes.map((code) => `output_completeness:${code}`)
      : []),
    ...(layers.validator_results.safety.critical
      ? layers.validator_results.safety.issue_codes.map((code) => `safety:${code}`)
      : []),
    ...(layers.validator_results.substantive_accuracy.critical
      ? layers.validator_results.substantive_accuracy.issue_codes.map((code) => `substantive_accuracy:${code}`)
      : [])
  ];
}

function csvValue(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/u.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function writeReviewArtifacts(record: ModelUpgradeDerivedEvaluationRecord, cases: ModelUpgradeDerivedCaseRecord[]) {
  const reviewDir = path.join(modelUpgradeDerivedEvaluationDir(record.derived_evaluation_id), "review");
  mkdirSync(reviewDir, { recursive: true });
  const records = cases.map((entry) => ({
    source_provider_run_id: record.source_provider_run_id,
    derived_evaluation_id: record.derived_evaluation_id,
    runtime_candidate_hash: record.runtime_candidate_hash,
    source_evaluation_protocol_hash: record.source_evaluation_protocol_hash,
    evaluation_protocol_hash: record.evaluation_protocol_hash,
    fixture_id: entry.fixture_id,
    role: entry.role,
    output_contract: modelUpgradeEvaluationFixtures().find((fixture) => fixture.fixture_id === entry.fixture_id)?.input_contract.output_contract,
    effective_output: entry.effective_output,
    original_findings: entry.original_findings,
    prior_derived_findings: entry.prior_derived_findings,
    derived_findings: entry.derived_findings,
    reviewer_decision: "",
    reviewer_notes: "",
    critical_issue_flag: entry.derived_findings.critical_failure
  }));
  const jsonlPath = path.join(reviewDir, "review_records.jsonl");
  writeFileSync(jsonlPath, `${records.map((entry) => JSON.stringify(entry)).join("\n")}\n`, "utf8");
  const csvPath = path.join(reviewDir, "review_template.csv");
  const columns = ["fixture_id", "role", "derived_critical_failure", "semantic_review_required", "reviewer_decision", "critical_issue_flag", "reviewer_notes"];
  const lines = [columns.join(","), ...cases.map((entry) => [
    entry.fixture_id,
    entry.role,
    entry.derived_findings.critical_failure,
    entry.derived_findings.semantic_review_required,
    "",
    entry.derived_findings.critical_failure,
    ""
  ].map(csvValue).join(","))];
  writeFileSync(csvPath, `${lines.join("\n")}\n`, "utf8");
  const summaryPath = path.join(reviewDir, "review_summary.json");
  writeJson(summaryPath, {
    source_provider_run_id: record.source_provider_run_id,
    derived_evaluation_id: record.derived_evaluation_id,
    runtime_candidate_hash: record.runtime_candidate_hash,
    source_evaluation_protocol_hash: record.source_evaluation_protocol_hash,
    evaluation_protocol_hash: record.evaluation_protocol_hash,
    review_record_count: records.length,
    required_case_count: record.fixture_ids.length,
    all_required_cases_represented: records.length === record.fixture_ids.length,
    original_failure_count: cases.filter((entry) => entry.original_findings.critical_failure).length,
    prior_derived_failure_count: cases.filter((entry) =>
      entry.prior_derived_findings.some((finding) => finding.derived_findings.critical_failure)
    ).length,
    derived_failure_count: cases.filter((entry) => entry.derived_findings.critical_failure).length,
    no_provider_call: true
  });
  return {
    review_records_jsonl: jsonlPath,
    review_template_csv: csvPath,
    review_summary_json: summaryPath
  };
}

export function reevaluateModelUpgradeRunOffline(input: {
  candidateRunPublicId: string;
  expectedRuntimeCandidateHash: string;
  expectedSourceEvaluationProtocolHash: string;
  priorDerivedEvaluationId?: string;
}) {
  const sourceRunPath = path.join(runDir(input.candidateRunPublicId), "run.json");
  if (!existsSync(sourceRunPath)) throw new Error("source_candidate_run_not_found");
  const sourceRun = loadModelUpgradeRun(input.candidateRunPublicId);
  if (sourceRun.runtime_candidate_hash !== input.expectedRuntimeCandidateHash) {
    throw new Error("source_runtime_candidate_hash_mismatch");
  }
  if (sourceRun.evaluation_protocol_hash !== input.expectedSourceEvaluationProtocolHash) {
    throw new Error("source_evaluation_protocol_hash_mismatch");
  }
  const comparison = buildOperationalModelUpgradeComparison({ manifestPath: sourceRun.candidate_manifest_path });
  const candidate = readCandidateOperationalModelConfig(sourceRun.candidate_manifest_path);
  if (comparison.candidate.runtime_candidate_hash !== sourceRun.runtime_candidate_hash) {
    throw new Error("current_manifest_runtime_hash_mismatch");
  }
  const fixtures = modelUpgradeEvaluationFixtures();
  const sourceCases = sourceRun.fixture_ids.map((fixtureId) => loadModelUpgradeCase(sourceRun.run_public_id, fixtureId));
  const evidence = sourceProviderEvidenceStatus(sourceRun, sourceCases);
  if (!evidence.intact) throw new Error(`source_provider_evidence_not_intact:${evidence.issue_codes.join(",")}`);
  const sourceHashBefore = hashModelUpgradeSourceArtifacts(sourceRun.run_public_id);
  const priorRecord = input.priorDerivedEvaluationId
    ? loadModelUpgradeDerivedEvaluation(input.priorDerivedEvaluationId)
    : null;
  if (priorRecord && priorRecord.source_provider_run_id !== sourceRun.run_public_id) {
    throw new Error("prior_derived_source_run_mismatch");
  }
  if (priorRecord && priorRecord.runtime_candidate_hash !== sourceRun.runtime_candidate_hash) {
    throw new Error("prior_derived_runtime_hash_mismatch");
  }
  if (priorRecord && priorRecord.fixture_ids.some((fixtureId) => !sourceRun.fixture_ids.includes(fixtureId))) {
    throw new Error("prior_derived_fixture_set_mismatch");
  }
  const priorHashBefore = priorRecord
    ? hashModelUpgradeDerivedArtifacts(priorRecord.derived_evaluation_id)
    : null;
  const priorCases = priorRecord
    ? new Map(priorRecord.fixture_ids.map((fixtureId) => [
        fixtureId,
        loadModelUpgradeDerivedCase(priorRecord.derived_evaluation_id, fixtureId)
      ]))
    : new Map<string, ModelUpgradeDerivedCaseRecord>();
  const protocolHash = currentModelUpgradeEvaluationProtocolHash();
  const id = derivedId();
  const cases = fixtures.map((fixture) => {
    const source = sourceCases.find((entry) => entry.fixture_id === fixture.fixture_id);
    if (!source) throw new Error(`source_provider_case_missing:${fixture.fixture_id}`);
    const layers = evaluateModelUpgradeOutputLayers({
      fixture,
      candidate,
      output: source.effective_output
    });
    const criticalReasons = derivedCriticalReasons(source, layers);
    const derived: ModelUpgradeDerivedCaseRecord = {
      fixture_id: fixture.fixture_id,
      role: fixture.role,
      source_case_public_id: source.case_public_id,
      source_case_artifact_sha256: sha256(readFileSync(path.join(runDir(sourceRun.run_public_id), "cases", `${fixture.fixture_id}.json`), "utf8")),
      source_provider_evidence: {
        status: source.status,
        provider_request_status: source.provider_request_status,
        provider_request_id_present: Boolean(source.provider_request_id),
        provider_response_id_present: Boolean(source.provider_response_id),
        model_configured: source.model_configured,
        model_resolved: source.model_resolved,
        validation_result: source.validation_result,
        raw_output_hash: source.raw_output_hash,
        effective_output_hash: source.effective_output ? stableHash(source.effective_output) : null,
        fallback_used: source.fallback_used
      },
      effective_output: source.effective_output,
      original_findings: {
        automated_review_status: source.automated_review_status,
        validator_results: source.validator_results,
        semantic_adjudications: source.semantic_adjudications,
        critical_failure: source.critical_failure,
        critical_failure_reasons: source.critical_failure_reasons
      },
      prior_derived_findings: priorRecord
        ? [{
            derived_evaluation_id: priorRecord.derived_evaluation_id,
            evaluation_protocol_hash: priorRecord.evaluation_protocol_hash,
            derived_findings: priorCases.get(fixture.fixture_id)?.derived_findings ?? (() => {
              throw new Error(`prior_derived_case_missing:${fixture.fixture_id}`);
            })()
          }]
        : [],
      derived_findings: {
        fixture_preflight: layers.fixture_preflight,
        validator_results: layers.validator_results,
        semantic_adjudications: layers.semantic_adjudications,
        production_schema_fidelity: layers.production_schema_fidelity,
        critical_failure: criticalReasons.length > 0,
        critical_failure_reasons: criticalReasons,
        semantic_review_required: layers.semantic_adjudications.some((entry) => entry.semantic_review_required),
        action_adjudication: layers.action_adjudication
      }
    };
    writeJson(derivedCasePath(id, fixture.fixture_id), derived);
    return derived;
  });
  const calibration = evaluateModelUpgradeSemanticCalibration();
  const hasCritical = cases.some((entry) => entry.derived_findings.critical_failure);
  const now = new Date().toISOString();
  const record: ModelUpgradeDerivedEvaluationRecord = {
    derived_evaluation_id: id,
    reevaluation_version: MODEL_UPGRADE_REEVALUATION_VERSION,
    source_provider_run_id: sourceRun.run_public_id,
    source_runtime_candidate_hash: sourceRun.runtime_candidate_hash,
    source_evaluation_protocol_hash: sourceRun.evaluation_protocol_hash,
    runtime_candidate_hash: sourceRun.runtime_candidate_hash,
    evaluation_protocol_hash: protocolHash,
    source_artifact_sha256: sourceHashBefore.artifact_sha256,
    source_artifact_file_count: sourceHashBefore.file_count,
    source_artifacts_immutable: true,
    prior_derived_evaluation: priorRecord && priorHashBefore
      ? {
          derived_evaluation_id: priorRecord.derived_evaluation_id,
          evaluation_protocol_hash: priorRecord.evaluation_protocol_hash,
          artifact_sha256: priorHashBefore.artifact_sha256,
          artifact_file_count: priorHashBefore.file_count,
          artifacts_immutable: true
        }
      : null,
    provider_calls_made: 0,
    provider_evidence_intact: evidence.intact,
    provider_evidence_issue_codes: evidence.issue_codes,
    application_git_commit: sourceRun.application_git_commit,
    candidate_manifest_path: sourceRun.candidate_manifest_path,
    candidate_manifest_hash: sourceRun.candidate_manifest_hash,
    status: hasCritical ? "completed_failed" : "completed_pending_review",
    recommendation: hasCritical ? "candidate_blocked_by_derived_failures" : "candidate_pending_derived_human_review",
    fixture_ids: fixtures.map((fixture) => fixture.fixture_id),
    case_results: cases.map((entry) => ({
      fixture_id: entry.fixture_id,
      critical_failure: entry.derived_findings.critical_failure,
      original_critical_failure: entry.original_findings.critical_failure,
      semantic_review_required: entry.derived_findings.semantic_review_required
    })),
    semantic_calibration: calibration,
    human_review_status: "exported",
    human_review: null,
    review_artifact_paths: {
      review_records_jsonl: "",
      review_template_csv: "",
      review_summary_json: ""
    },
    created_at: now,
    completed_at: now
  };
  record.review_artifact_paths = writeReviewArtifacts(record, cases);
  writeJson(derivedRecordPath(id), record);
  const sourceHashAfter = hashModelUpgradeSourceArtifacts(sourceRun.run_public_id);
  if (sourceHashAfter.artifact_sha256 !== sourceHashBefore.artifact_sha256) {
    throw new Error("source_artifacts_changed_during_reevaluation");
  }
  if (priorRecord && priorHashBefore) {
    const priorHashAfter = hashModelUpgradeDerivedArtifacts(priorRecord.derived_evaluation_id);
    if (priorHashAfter.artifact_sha256 !== priorHashBefore.artifact_sha256) {
      throw new Error("prior_derived_artifacts_changed_during_reevaluation");
    }
  }
  return record;
}

function reviewFixtureIds(reviewArtifactPath: string) {
  if (!existsSync(reviewArtifactPath)) throw new Error("derived_review_artifact_not_found");
  return readFileSync(reviewArtifactPath, "utf8").trim().split(/\n/u).filter(Boolean)
    .map((line) => JSON.parse(line) as { fixture_id?: unknown })
    .map((entry) => String(entry.fixture_id ?? ""));
}

export function confirmModelUpgradeDerivedHumanReview(input: {
  derivedEvaluationId: string;
  reviewArtifactPath: string;
  confirmPhrase: string;
  decision: "approve" | "reject";
  reviewer: string;
}) {
  if (input.confirmPhrase !== "I reviewed all required candidate outputs") {
    throw new Error("missing_exact_human_review_confirmation");
  }
  if (!input.reviewer || ["default", "unknown"].includes(input.reviewer)) {
    throw new Error("safe_reviewer_identifier_required");
  }
  const record = loadModelUpgradeDerivedEvaluation(input.derivedEvaluationId);
  const fixtureIds = new Set(reviewFixtureIds(input.reviewArtifactPath));
  const missing = record.fixture_ids.filter((fixtureId) => !fixtureIds.has(fixtureId));
  if (missing.length > 0) throw new Error(`review_artifact_missing_cases:${missing.join(",")}`);
  const cases = record.fixture_ids.map((fixtureId) => loadModelUpgradeDerivedCase(record.derived_evaluation_id, fixtureId));
  if (input.decision === "approve" && cases.some((entry) => entry.derived_findings.critical_failure)) {
    throw new Error("critical_derived_failure_blocks_human_approval");
  }
  const semanticCases = cases.filter((entry) => entry.derived_findings.semantic_review_required).map((entry) => entry.fixture_id);
  const reviewed: ModelUpgradeDerivedEvaluationRecord = {
    ...record,
    status: "completed_reviewed",
    human_review_status: input.decision === "approve" ? "approved" : "rejected",
    recommendation: input.decision === "approve"
      ? "candidate_eligible_for_explicit_approval"
      : "candidate_rejected_by_derived_human_review",
    human_review: {
      reviewer: input.reviewer,
      decision: input.decision,
      reviewed_at: new Date().toISOString(),
      artifact_path: input.reviewArtifactPath,
      artifact_sha256: sha256(readFileSync(input.reviewArtifactPath, "utf8")),
      reviewed_fixture_ids: [...fixtureIds].sort(),
      semantic_review_required_cases: semanticCases,
      semantic_review_confirmed: input.decision === "approve",
      runtime_candidate_hash: record.runtime_candidate_hash,
      source_evaluation_protocol_hash: record.source_evaluation_protocol_hash,
      evaluation_protocol_hash: record.evaluation_protocol_hash
    }
  };
  writeJson(derivedRecordPath(record.derived_evaluation_id), reviewed);
  return reviewed;
}

export function evaluateModelUpgradeDerivedApprovalEvidence(input: {
  manifestPath: string;
  candidateRunPublicId: string;
  derivedEvaluationId: string;
  expectedRuntimeCandidateHash: string;
  expectedEvaluationProtocolHash: string;
}) {
  const record = loadModelUpgradeDerivedEvaluation(input.derivedEvaluationId);
  const sourceRun = loadModelUpgradeRun(input.candidateRunPublicId);
  const comparison = buildOperationalModelUpgradeComparison({ manifestPath: input.manifestPath });
  const cases = record.fixture_ids.map((fixtureId) => loadModelUpgradeDerivedCase(record.derived_evaluation_id, fixtureId));
  const sourceCases = sourceRun.fixture_ids.map((fixtureId) => loadModelUpgradeCase(sourceRun.run_public_id, fixtureId));
  const sourceEvidence = sourceProviderEvidenceStatus(sourceRun, sourceCases);
  const sourceHash = hashModelUpgradeSourceArtifacts(sourceRun.run_public_id);
  const priorDerivedHashMatches = !record.prior_derived_evaluation || (
    existsSync(derivedRecordPath(record.prior_derived_evaluation.derived_evaluation_id)) &&
    hashModelUpgradeDerivedArtifacts(record.prior_derived_evaluation.derived_evaluation_id).artifact_sha256 ===
      record.prior_derived_evaluation.artifact_sha256
  );
  const reviewArtifactHashMatches = Boolean(
    record.human_review?.artifact_path &&
    existsSync(record.human_review.artifact_path) &&
    record.human_review.artifact_sha256 === sha256(readFileSync(record.human_review.artifact_path, "utf8"))
  );
  const reviewedIds = new Set(record.human_review?.reviewed_fixture_ids ?? []);
  const semanticCases = cases.filter((entry) => entry.derived_findings.semantic_review_required).map((entry) => entry.fixture_id);
  const calibration = evaluateModelUpgradeSemanticCalibration();
  const blockingReasons = [
    ...(record.source_provider_run_id !== input.candidateRunPublicId ? ["derived_source_run_mismatch"] : []),
    ...(sourceRun.runtime_candidate_hash !== record.runtime_candidate_hash ? ["source_derived_runtime_hash_mismatch"] : []),
    ...(comparison.candidate.runtime_candidate_hash !== input.expectedRuntimeCandidateHash ? ["manifest_runtime_hash_mismatch"] : []),
    ...(record.runtime_candidate_hash !== input.expectedRuntimeCandidateHash ? ["derived_runtime_hash_mismatch"] : []),
    ...(record.evaluation_protocol_hash !== input.expectedEvaluationProtocolHash ? ["derived_evaluation_protocol_hash_mismatch"] : []),
    ...(record.evaluation_protocol_hash !== currentModelUpgradeEvaluationProtocolHash() ? ["derived_protocol_not_current"] : []),
    ...(record.source_evaluation_protocol_hash !== sourceRun.evaluation_protocol_hash ? ["source_protocol_linkage_mismatch"] : []),
    ...(sourceHash.artifact_sha256 !== record.source_artifact_sha256 ? ["source_artifacts_not_immutable"] : []),
    ...(!priorDerivedHashMatches ? ["prior_derived_artifacts_not_immutable"] : []),
    ...(!record.source_artifacts_immutable ? ["derived_source_immutability_attestation_missing"] : []),
    ...(sourceRun.artifact_persistence?.persistence_verified !== true ? ["artifact_persistence_not_verified"] : []),
    ...(sourceRun.candidate_manifest_hash !== comparison.candidate.candidate_configuration_hash
      ? ["source_candidate_manifest_hash_mismatch"] : []),
    ...(!record.provider_evidence_intact ? ["derived_provider_evidence_attestation_failed"] : []),
    ...(!sourceEvidence.intact ? sourceEvidence.issue_codes : []),
    ...(!calibration.approved_negative_controls_pass || !calibration.harmful_controls_blocked ? ["semantic_calibration_gate_failed"] : []),
    ...(cases.length !== record.fixture_ids.length ? ["derived_cases_missing"] : []),
    ...(cases.some((entry) => entry.derived_findings.critical_failure) ? ["critical_derived_failure"] : []),
    ...(record.status !== "completed_reviewed" ? ["derived_evaluation_not_reviewed"] : []),
    ...(record.human_review_status !== "approved" || record.human_review?.decision !== "approve" ? ["derived_human_review_not_approved"] : []),
    ...(!reviewArtifactHashMatches ? ["derived_review_artifact_hash_mismatch"] : []),
    ...(semanticCases.some((fixtureId) => !reviewedIds.has(fixtureId)) ||
      (semanticCases.length > 0 && record.human_review?.semantic_review_confirmed !== true)
      ? ["ambiguous_semantic_review_incomplete"] : []),
    ...(record.human_review && record.human_review.runtime_candidate_hash !== record.runtime_candidate_hash
      ? ["derived_human_review_runtime_hash_mismatch"] : []),
    ...(record.human_review && record.human_review.evaluation_protocol_hash !== record.evaluation_protocol_hash
      ? ["derived_human_review_protocol_hash_mismatch"] : [])
  ];
  return { eligible: blockingReasons.length === 0, blocking_reasons: [...new Set(blockingReasons)], record, sourceRun, cases, comparison };
}

export function writeModelUpgradeDerivedApprovalArtifact(input: Parameters<typeof evaluateModelUpgradeDerivedApprovalEvidence>[0]) {
  const evidence = evaluateModelUpgradeDerivedApprovalEvidence(input);
  if (!evidence.eligible) return { status: "blocked" as const, blocking_reasons: evidence.blocking_reasons, no_provider_call: true };
  const approvalDir = path.join(modelUpgradeDerivedEvaluationDir(input.derivedEvaluationId), "approval");
  mkdirSync(approvalDir, { recursive: true });
  const manifestCopyPath = path.join(approvalDir, "approved-candidate-manifest.json");
  writeFileSync(manifestCopyPath, readFileSync(resolveCandidateManifestPath(input.manifestPath), "utf8"), "utf8");
  const artifact = {
    approval_command_version: MODEL_UPGRADE_DERIVED_APPROVAL_VERSION,
    approved_at: new Date().toISOString(),
    source_provider_run_id: input.candidateRunPublicId,
    derived_evaluation_id: input.derivedEvaluationId,
    source_evaluation_protocol_hash: evidence.record.source_evaluation_protocol_hash,
    evaluation_protocol_hash: evidence.record.evaluation_protocol_hash,
    runtime_candidate_hash: evidence.record.runtime_candidate_hash,
    source_artifact_sha256: evidence.record.source_artifact_sha256,
    approval_evidence_hash: stableHash({
      source_provider_run_id: input.candidateRunPublicId,
      derived_evaluation_id: input.derivedEvaluationId,
      runtime_candidate_hash: evidence.record.runtime_candidate_hash,
      source_evaluation_protocol_hash: evidence.record.source_evaluation_protocol_hash,
      evaluation_protocol_hash: evidence.record.evaluation_protocol_hash,
      human_review: evidence.record.human_review
    }),
    exact_operational_approved_config_hash: evidence.record.runtime_candidate_hash,
    rollback_hash: evidence.comparison.baseline.approved_active_configuration_hash,
    approved_manifest_artifact_path: manifestCopyPath,
    human_review: evidence.record.human_review
  };
  const artifactPath = path.join(approvalDir, "approval_evidence.json");
  writeJson(artifactPath, artifact);
  return {
    status: "approval_evidence_ready" as const,
    no_provider_call: true,
    artifact_path: artifactPath,
    ...artifact
  };
}
