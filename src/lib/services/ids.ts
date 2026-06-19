import { randomBytes } from "node:crypto";

export type PublicIdKind = "assessment" | "concept_unit" | "item" | "session";

const prefixes: Record<PublicIdKind, string> = {
  assessment: "asmt",
  concept_unit: "cu",
  item: "item",
  session: "sess"
};

function utcDateStamp(date = new Date()): string {
  return date.toISOString().slice(0, 10).replaceAll("-", "");
}

export function generatePublicId(kind: PublicIdKind): string {
  const suffix = randomBytes(5).toString("base64url").toLowerCase();

  return `${prefixes[kind]}_${utcDateStamp()}_${suffix}`;
}
