import { createHash } from "node:crypto";

function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortObject);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, nested]) => [key, sortObject(nested)])
    );
  }

  return value;
}

export function stableSerialize(value: unknown) {
  return JSON.stringify(sortObject(value));
}

export function hashVerificationContent(value: unknown) {
  return createHash("sha256").update(stableSerialize(value)).digest("hex");
}
