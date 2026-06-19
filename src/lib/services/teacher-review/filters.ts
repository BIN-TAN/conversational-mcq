import { z } from "zod";
import {
  AssessmentPhaseSchema,
  EventSourceSchema,
  ProcessEventTypeSchema,
  SessionStatusSchema
} from "@/lib/domain/enums";

function optionalTrimmedString(max = 200) {
  return z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.string().trim().min(1).max(max).optional()
  );
}

function optionalBooleanFromQuery() {
  return z.preprocess((value) => {
    if (typeof value !== "string" || value.trim() === "") {
      return undefined;
    }

    if (value === "true") {
      return true;
    }

    if (value === "false") {
      return false;
    }

    return value;
  }, z.boolean().optional());
}

export const sessionListQuerySchema = z.object({
  search: optionalTrimmedString(120),
  assessment_public_id: optionalTrimmedString(160),
  status: z.preprocess(
    (value) => (value === "" ? undefined : value),
    SessionStatusSchema.optional()
  ),
  phase: z.preprocess(
    (value) => (value === "" ? undefined : value),
    AssessmentPhaseSchema.optional()
  ),
  needs_review: optionalBooleanFromQuery(),
  sort: z
    .preprocess(
      (value) => (value === "" ? undefined : value),
      z.enum(["started_at", "last_activity_at", "completed_at"]).optional()
    )
    .default("last_activity_at"),
  direction: z
    .preprocess((value) => (value === "" ? undefined : value), z.enum(["asc", "desc"]).optional())
    .default("desc"),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(25)
});

export type SessionListQuery = z.infer<typeof sessionListQuerySchema>;

export const processEventQuerySchema = z.object({
  event_type: z.preprocess(
    (value) => (value === "" ? undefined : value),
    ProcessEventTypeSchema.optional()
  ),
  event_source: z.preprocess(
    (value) => (value === "" ? undefined : value),
    EventSourceSchema.optional()
  ),
  concept_unit_public_id: optionalTrimmedString(160),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(500).default(100)
});

export type ProcessEventQuery = z.infer<typeof processEventQuerySchema>;

export function queryObjectFromUrl(url: string) {
  const searchParams = new URL(url).searchParams;

  return Object.fromEntries(searchParams.entries());
}
