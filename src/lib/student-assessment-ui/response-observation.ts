import { z } from "zod";

export const RESPONSE_OBSERVATION_VERSION = "response-stage-observation-v1";
export const responseStages = ["answer", "reasoning", "confidence", "tempting_option", "tempting_reason", "revision", "package_review"] as const;
export const observationKinds = ["ready", "first_input", "submitted", "request_finished", "controls_ready", "hidden", "visible", "blur", "focus", "offline", "online", "closed"] as const;
export const ResponseObservationLinkSchema = z.object({
  stage_visit_id: z.string().uuid(),
  submission_id: z.string().uuid()
}).strict();
export type ResponseObservationLink = z.infer<typeof ResponseObservationLinkSchema>;
export const ResponseObservationPayloadSchema = z.object({
  observation_version: z.literal(RESPONSE_OBSERVATION_VERSION),
  stage_visit_id: z.string().uuid(),
  response_stage: z.enum(responseStages),
  response_phase: z.enum(["initial", "transfer", "review", "revision"]),
  observation_kind: z.enum(observationKinds),
  monotonic_ms: z.number().finite().nonnegative().max(31 * 24 * 60 * 60 * 1000),
  observation_sequence: z.number().int().positive(),
  submission_id: z.string().uuid().optional(),
  result: z.enum(["response_received", "request_failed"]).optional(),
  input_length: z.number().int().nonnegative().max(100000).optional(),
  input_change_count: z.number().int().nonnegative().optional(),
  reason: z.enum(["stage_changed", "view_left", "pause_requested", "end_requested"]).optional()
}).strict();
export type ResponseObservationPayload = z.infer<typeof ResponseObservationPayloadSchema>;

export type ResponseStageContext = {
  item_public_id: string;
  response_stage: typeof responseStages[number];
  response_phase: ResponseObservationPayload["response_phase"];
};
