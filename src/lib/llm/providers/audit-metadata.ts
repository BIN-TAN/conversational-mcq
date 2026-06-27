import { createHash } from "node:crypto";
import type { StructuredAgentResult } from "./types";

export type ProviderAuditMetadata = {
  provider_request_id?: string;
  provider_response_id?: string;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizedTransportValue(
  result: StructuredAgentResult<unknown>,
  key: "requestId" | "responseId"
) {
  const normalized = result.transport_telemetry?.normalized_response;
  const transport = record(record(normalized)?.transport);
  return nonEmptyString(transport?.[key]);
}

function rawOutputResponseId(result: StructuredAgentResult<unknown>) {
  const raw = record(result.raw_output);
  const id = raw?.id;

  if (typeof id === "string" && id.trim()) {
    return id.trim();
  }

  if (typeof id === "number" && Number.isFinite(id)) {
    return String(id);
  }

  return undefined;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJson(entry)).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`);

  return `{${entries.join(",")}}`;
}

function rawOutputHasProviderResponseEvidence(value: unknown) {
  const raw = record(value);

  if (!raw) {
    return false;
  }

  return [
    "id",
    "status",
    "output",
    "output_parsed",
    "incomplete_details",
    "error",
    "usage"
  ].some((key) => key in raw);
}

function rawOutputEvidenceHash(result: StructuredAgentResult<unknown>) {
  if (result.provider !== "openai" || !rawOutputHasProviderResponseEvidence(result.raw_output)) {
    return undefined;
  }

  return createHash("sha256")
    .update(stableJson(result.raw_output))
    .digest("hex");
}

function responseEvidenceHash(result: StructuredAgentResult<unknown>) {
  const normalized = record(result.transport_telemetry?.normalized_response);
  const rawOutput = record(normalized?.rawOutput);
  const hash =
    nonEmptyString(result.transport_telemetry?.raw_response_hash) ??
    nonEmptyString(rawOutput?.rawResponseHash) ??
    rawOutputEvidenceHash(result);

  return hash ? `openai_response_hash:${hash}` : undefined;
}

export function providerAuditMetadata(
  result: StructuredAgentResult<unknown>
): ProviderAuditMetadata {
  const normalizedError = result.transport_telemetry?.normalized_error;
  const provider_request_id =
    nonEmptyString(result.provider_request_id) ??
    nonEmptyString(result.transport_telemetry?.provider_request_id) ??
    normalizedTransportValue(result, "requestId") ??
    nonEmptyString(normalizedError?.provider_request_id) ??
    nonEmptyString(normalizedError?.provider_request_header_id);

  const provider_response_id =
    nonEmptyString(result.provider_response_id) ??
    nonEmptyString(result.transport_telemetry?.provider_response_id) ??
    normalizedTransportValue(result, "responseId") ??
    rawOutputResponseId(result) ??
    responseEvidenceHash(result);

  return {
    ...(provider_request_id ? { provider_request_id } : {}),
    ...(provider_response_id ? { provider_response_id } : {})
  };
}
