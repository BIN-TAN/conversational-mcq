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
  | "student_account_event";

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
  student_account_event: "sae"
};

function utcDateStamp(date = new Date()): string {
  return date.toISOString().slice(0, 10).replaceAll("-", "");
}

export function generatePublicId(kind: PublicIdKind): string {
  const suffix = randomBytes(5).toString("base64url").toLowerCase();

  return `${prefixes[kind]}_${utcDateStamp()}_${suffix}`;
}
