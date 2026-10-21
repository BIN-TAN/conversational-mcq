/**
 * Prepares the other topics of a course topic bank one after another (item builder sidebar):
 * for each topic it creates the topic's mini test with the stored course materials, lets the
 * assistant fill the design panel, and prepares checked drafts for the teacher's review: the
 * instructor's own items when the materials have items for that topic, else new drafts. Every
 * step can be repeated safely, so a stopped or interrupted run continues where it stopped.
 */
import { apiRequest, ClientApiError } from "./api";

export function topicPreparationMessage(title: string) {
  return `Please prepare this mini test for the topic "${title}" from the course topic bank, and fill in the whole design panel.`;
}

export type TopicRunStep =
  | "waiting"
  | "creating"
  | "designing"
  | "drafting"
  | "ready"
  | "needs_input"
  | "failed"
  | "stopped";

export type TopicRunState = {
  topic_id: string;
  title: string;
  step: TopicRunStep;
  /** Where the teacher continues: the drafts to review, or the mini test's builder. */
  link: string | null;
  note: string | null;
};

const STEP_TEXT: Record<TopicRunStep, string> = {
  waiting: "Waiting",
  creating: "Creating the mini test",
  designing: "Filling in the design panel (a few minutes)",
  drafting: "Preparing and checking drafts (a few minutes)",
  ready: "Drafts ready to review",
  needs_input: "The assistant needs your answer",
  failed: "Not finished",
  stopped: "Not started"
};

export function topicRunStepText(step: TopicRunStep) {
  return STEP_TEXT[step];
}

type TopicDesign = {
  blueprint_hash: string;
  concept_unit_version: number;
  assistant_thread: { messages: unknown[] };
  assistant_state: { ready_for_item_generation: boolean };
};

function builderUrl(assessmentPublicId: string) {
  return `/teacher/content/assessments/${assessmentPublicId}/item-design`;
}

export async function prepareTopicMiniTests(input: {
  bank_assessment_public_id: string;
  topics: Array<{ topic_id: string; title: string; has_source_items?: boolean }>;
  existing: Array<{ topic_id: string; assessment_public_id: string; draft_review_url?: string | null }>;
  onUpdate: (state: TopicRunState) => void;
  shouldStop: () => boolean;
  newClientMessageId?: () => string;
}): Promise<TopicRunState[]> {
  const newId = input.newClientMessageId ?? (() => crypto.randomUUID());
  const results: TopicRunState[] = [];
  for (const topic of input.topics) {
    const update = (step: TopicRunStep, link: string | null = null, note: string | null = null) => {
      const state = { topic_id: topic.topic_id, title: topic.title, step, link, note };
      input.onUpdate(state);
      return state;
    };
    const known = input.existing.find((entry) => entry.topic_id === topic.topic_id);
    if (known?.draft_review_url) {
      results.push(update("ready", known.draft_review_url, "Drafted earlier."));
      continue;
    }
    if (input.shouldStop()) {
      results.push(update("stopped"));
      continue;
    }
    let assessmentPublicId = known?.assessment_public_id ?? null;
    try {
      update("creating");
      const created = await apiRequest<{ assessment_public_id: string }>(
        `/api/teacher/assessments/${input.bank_assessment_public_id}/item-design/topic-mini-test`,
        { method: "POST", body: JSON.stringify({ topic_id: topic.topic_id }) }
      );
      assessmentPublicId = created.assessment_public_id;
      const designUrl = `/api/teacher/assessments/${assessmentPublicId}/item-design`;
      let design = await apiRequest<TopicDesign>(designUrl);
      if (design.assistant_thread.messages.length === 0) {
        update("designing", builderUrl(assessmentPublicId));
        design = await apiRequest<TopicDesign>(`${designUrl}/assistant`, {
          method: "POST",
          body: JSON.stringify({
            client_message_id: newId(),
            expected_blueprint_hash: design.blueprint_hash,
            expected_concept_unit_version: design.concept_unit_version,
            message: topicPreparationMessage(topic.title)
          })
        });
      }
      if (!design.assistant_state.ready_for_item_generation) {
        results.push(update("needs_input", builderUrl(assessmentPublicId),
          "Open the mini test, answer the assistant's question, then generate the drafts there."));
        continue;
      }
      if (input.shouldStop()) {
        results.push(update("stopped", builderUrl(assessmentPublicId), "The design is ready; the drafts are not written yet."));
        continue;
      }
      update("drafting", builderUrl(assessmentPublicId));
      // The instructor's own items for this topic come first; new drafts only when there are none.
      if (topic.has_source_items) {
        try {
          const imported = await apiRequest<{ review_url: string; imported_count: number }>(`${designUrl}/existing-items`, {
            method: "POST",
            body: JSON.stringify({})
          });
          results.push(update("ready", imported.review_url,
            imported.imported_count === 1
              ? "Imported your item from the course materials."
              : `Imported ${imported.imported_count} of your items from the course materials.`));
          continue;
        } catch (caught) {
          if (!(caught instanceof ClientApiError && caught.status === 422)) throw caught;
        }
      }
      const generated = await apiRequest<{ review_url: string }>(`${designUrl}/generate`, {
        method: "POST",
        body: JSON.stringify({ expected_blueprint_hash: design.blueprint_hash, mode: "live" })
      });
      results.push(update("ready", generated.review_url));
    } catch (caught) {
      const message = caught instanceof ClientApiError || caught instanceof Error ? caught.message : "Something went wrong.";
      results.push(update("failed", assessmentPublicId ? builderUrl(assessmentPublicId) : null,
        `${message} Start again to retry this topic; finished topics are kept.`));
    }
  }
  return results;
}
