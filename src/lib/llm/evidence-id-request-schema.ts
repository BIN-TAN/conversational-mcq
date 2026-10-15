import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import { CanonicalEvidenceIdSchema } from "../domain/canonical-evidence-identity";

export const EVIDENCE_ID_REQUEST_SCHEMA_VERSION = "evidence-id-request-enum-v1" as const;

const citationFields = new Set([
  "evidence_id", "evidence_ids", "canonical_evidence_ids", "source_evidence_id",
  "evidence_reference", "source_evidence_references"
]);

export function evidenceIdRequestSchemaLimits(schema: unknown) {
  let enumValues = 0, stringCharacters = 0, objectProperties = 0;
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) { value.forEach(visit); return; }
    const node = value as Record<string, unknown>;
    if (Array.isArray(node.enum)) {
      enumValues += node.enum.length;
      const characters = node.enum.reduce<number>((sum, entry) =>
        sum + (typeof entry === "string" ? entry.length : 0), 0);
      stringCharacters += characters;
      if (node.enum.length > 250 && characters > 15_000) {
        throw new Error("evidence_id_request_schema_single_enum_limit_exceeded");
      }
    }
    if (typeof node.const === "string") stringCharacters += node.const.length;
    for (const key of ["properties", "definitions", "$defs"]) {
      const entries = node[key];
      if (entries && typeof entries === "object" && !Array.isArray(entries)) {
        const names = Object.keys(entries);
        stringCharacters += names.reduce((sum, name) => sum + name.length, 0);
        if (key === "properties") objectProperties += names.length;
      }
    }
    Object.values(node).forEach(visit);
  };
  visit(schema);
  if (enumValues > 1_000 || stringCharacters > 120_000 || objectProperties > 5_000) {
    throw new Error("evidence_id_request_schema_aggregate_limit_exceeded");
  }
  return { enum_values: enumValues, string_characters: stringCharacters, object_properties: objectProperties };
}

// Restrict generation, never repair an authored identifier. The canonical schema,
// quotes, values and semantic validators remain unchanged. Separate memo tables
// prevent a shared ordinary string from becoming a citation merely because a
// different field uses the same Zod instance; shared citations reuse one enum.
export function evidenceIdRequestSchema<T extends z.AnyZodObject>(
  schema: T, evidenceIds: readonly string[], schemaName: string
): T {
  if (!evidenceIds.length || new Set(evidenceIds).size !== evidenceIds.length ||
      evidenceIds.some(id => !CanonicalEvidenceIdSchema.safeParse(id).success)) {
    throw new Error("evidence_id_request_schema_catalog_invalid");
  }
  const identifier = z.enum([...evidenceIds] as [string, ...string[]]);
  const ordinary = new Map<z.ZodTypeAny, z.ZodTypeAny>();
  const citations = new Map<z.ZodTypeAny, z.ZodTypeAny>();
  let boundLeaves = 0;
  const clone = (node: z.ZodTypeAny, citation = false): z.ZodTypeAny => {
    const cache = citation ? citations : ordinary;
    const cached = cache.get(node);
    if (cached) return cached;
    let result: z.ZodTypeAny = node;
    if (node instanceof z.ZodString) {
      if (citation) { result = identifier; boundLeaves += 1; }
    } else if (node instanceof z.ZodObject) {
      if (citation) throw new Error("evidence_id_request_schema_citation_shape_invalid");
      const shape = Object.fromEntries(Object.entries(node.shape as z.ZodRawShape)
        .map(([key, child]) => [key, clone(child, citationFields.has(key))]));
      result = new z.ZodObject({ ...node._def, shape: () => shape });
    } else if (node instanceof z.ZodArray) {
      result = new z.ZodArray({ ...node._def, type: clone(node.element, citation) });
    } else if (node instanceof z.ZodNullable) {
      result = new z.ZodNullable({ ...node._def, innerType: clone(node.unwrap(), citation) });
    } else if (node instanceof z.ZodOptional) {
      result = new z.ZodOptional({ ...node._def, innerType: clone(node.unwrap(), citation) });
    } else if (node instanceof z.ZodEffects) {
      result = new z.ZodEffects({ ...node._def, schema: clone(node.innerType(), citation) });
    } else if (node instanceof z.ZodUnion) {
      result = new z.ZodUnion({ ...node._def, options: node.options.map((option: z.ZodTypeAny) => clone(option, citation)) });
    } else if (node instanceof z.ZodNull) {
      // An explicitly authored null union arm is equivalent to .nullable().
      result = node;
    } else if (citation) {
      throw new Error("evidence_id_request_schema_citation_shape_invalid");
    } else if (!(node instanceof z.ZodEnum || node instanceof z.ZodLiteral ||
        node instanceof z.ZodNumber || node instanceof z.ZodBoolean || node instanceof z.ZodNull ||
        node instanceof z.ZodNever)) {
      // New composite schema types need an explicit traversal, not a silent hole.
      throw new Error("evidence_id_request_schema_unhandled_type");
    }
    cache.set(node, result);
    return result;
  };
  const constrained = clone(schema) as T;
  if (!boundLeaves) throw new Error("evidence_id_request_schema_citations_missing");
  // Use exactly the installed provider compiler, including its repeated root and
  // shared definitions. Never truncate a catalog or fall back to free-form IDs.
  evidenceIdRequestSchemaLimits(zodTextFormat(constrained, schemaName).schema);
  return constrained;
}
