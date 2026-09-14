import { createHash } from "node:crypto";

// Both student transcript projections must identify the same stored turn alike.
export function studentTurnId(databaseId: string) {
  return `turn_${createHash("sha256").update(databaseId).digest("hex").slice(0, 20)}`;
}
