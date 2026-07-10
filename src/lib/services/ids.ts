import { randomBytes } from "node:crypto";

export type PublicIdKind =
  | "assessment"
  | "concept_unit"
  | "item"
  | "session"
  | "summative_outcome"
  | "summative_import_batch"
  | "export"
  | "workflow_job"
  | "workflow_override"
  | "item_verification"
  | "followup_update_cycle"
  | "concept_progression"
  | "roster_import_batch"
  | "student_account_event"
  | "student_account_deletion_event"
  | "assessment_deletion_event"
  | "operational_effective_result"
  | "operational_canary_run"
  | "operational_canary_step"
  | "operational_canary_dispatch"
  | "operational_canary_credential_check"
  | "operational_canary_annotation"
  | "eval_suite"
  | "eval_case"
  | "eval_run"
  | "eval_run_item"
  | "eval_annotation"
  | "eval_annotation_revision"
  | "eval_rubric";

const prefixes: Record<PublicIdKind, string> = {
  assessment: "asmt",
  concept_unit: "cu",
  item: "item",
  session: "sess",
  summative_outcome: "outcome",
  summative_import_batch: "sib",
  export: "export",
  workflow_job: "wfjob",
  workflow_override: "wfo",
  item_verification: "iver",
  followup_update_cycle: "fuc",
  concept_progression: "cpr",
  roster_import_batch: "rib",
  student_account_event: "sae",
  student_account_deletion_event: "sade",
  assessment_deletion_event: "asde",
  operational_effective_result: "oper",
  operational_canary_run: "olcr",
  operational_canary_step: "olcs",
  operational_canary_dispatch: "olcd",
  operational_canary_credential_check: "olcc",
  operational_canary_annotation: "olca",
  eval_suite: "evs",
  eval_case: "evc",
  eval_run: "evr",
  eval_run_item: "evi",
  eval_annotation: "eva",
  eval_annotation_revision: "evar",
  eval_rubric: "evrub"
};

function utcDateStamp(date = new Date()): string {
  return date.toISOString().slice(0, 10).replaceAll("-", "");
}

export function generatePublicId(kind: PublicIdKind): string {
  const suffix = randomBytes(5).toString("base64url").toLowerCase();

  return `${prefixes[kind]}_${utcDateStamp()}_${suffix}`;
}
