import { RESPONSE_OBSERVATION_VERSION, type ResponseObservationLink, type ResponseObservationPayload, type ResponseStageContext } from "@/lib/student-assessment-ui/response-observation";
import type { FrontendProcessEvent } from "./api";

// Client observations never decide whether a response was accepted. The server
// records that separately, linked by submission_id.
export function createResponseStageRecorder(input: {
  send: (event: FrontendProcessEvent, keepalive?: boolean) => void;
  now: () => number;
  wallNow: () => string;
  newId: () => string;
}) {
  type Visit = ResponseStageContext & { id: string; sequence: number; firstInput: boolean; changes: number; pending?: string };
  let visit: Visit | null = null;
  let suspended = false;
  const awaitingControls = new Set<Visit>();
  const emit = (v: Visit, kind: ResponseObservationPayload["observation_kind"], extra: Partial<ResponseObservationPayload> = {}, keepalive = false) => {
    input.send({ event_type: "response_stage_observation", item_public_id: v.item_public_id,
      client_occurred_at: input.wallNow(), payload: {
        observation_version: RESPONSE_OBSERVATION_VERSION, stage_visit_id: v.id,
        response_stage: v.response_stage, response_phase: v.response_phase,
        observation_kind: kind, monotonic_ms: input.now(), observation_sequence: ++v.sequence, ...extra
      } }, keepalive);
  };
  const close = (reason: ResponseObservationPayload["reason"] = "stage_changed") => {
    if (visit) emit(visit, "closed", { reason, input_change_count: visit.changes }, true);
    visit = null;
    if (reason === "pause_requested" || reason === "end_requested") suspended = true;
  };
  return {
    ready(context: ResponseStageContext) {
      if (suspended) return;
      if (visit && visit.item_public_id === context.item_public_id && visit.response_stage === context.response_stage && visit.response_phase === context.response_phase) return;
      close();
      visit = { ...context, id: input.newId(), sequence: 0, firstInput: false, changes: 0 };
      emit(visit, "ready");
    },
    input(length: number) {
      if (!visit || visit.pending) return;
      visit.changes++;
      if (!visit.firstInput) { visit.firstInput = true; emit(visit, "first_input", { input_length: length }); }
    },
    submit() {
      if (!visit || visit.pending) return null;
      const v = visit;
      const submission_id = input.newId();
      v.pending = submission_id;
      awaitingControls.add(v);
      const link: ResponseObservationLink = { stage_visit_id: v.id, submission_id };
      emit(v, "submitted", { submission_id, input_change_count: v.changes });
      let finished = false;
      return { link, finish(failed = false) {
        if (finished) return;
        finished = true;
        emit(v, "request_finished", { submission_id, result: failed ? "request_failed" : "response_received" });
      } };
    },
    controlsReady() {
      for (const v of awaitingControls) {
        emit(v, "controls_ready", { submission_id: v.pending });
        v.pending = undefined;
      }
      awaitingControls.clear();
    },
    observe(kind: "hidden" | "visible" | "blur" | "focus" | "offline" | "online") {
      if (visit) emit(visit, kind, {}, kind === "hidden");
    },
    close,
    current: () => visit
  };
}
