/**
 * The two ways an instructor can start a mini test in the item builder:
 * adapting existing multiple-choice items, or writing new items from course materials.
 * Both start with the assistant filling in the item specifications (the design panel) for review.
 */

export type ItemDesignPath = "existing" | "new";

export const ITEM_DESIGN_PATHS: Array<{
  id: ItemDesignPath;
  title: string;
  description: string;
  next_step: string;
}> = [
  {
    id: "existing",
    title: "Adapt my existing items",
    description:
      "Use multiple-choice items you already have, in any format: Word, PDF, Excel, CSV, text or images. The assistant fills in the item specifications from your items and their wrong options, then brings the items into review with your wording and keys kept. It suggests anything your file does not state.",
    next_step:
      "Attach the file with your items below and press Send. Once the specifications are filled in, your items open on the review page."
  },
  {
    id: "new",
    title: "Write new items from course materials",
    description:
      "Use course slides, textbook chapters, notes or past quizzes. The assistant works with you to fill in the item specifications, then writes new draft items that you review and edit.",
    next_step:
      "Attach your materials below, or paste or describe the content, and press Send. When the specifications are ready, choose Generate drafts."
  }
];

/** The opening message for each path. The instructor can edit it before sending. */
export function itemDesignPathStarter(path: ItemDesignPath, settings: { target_item_count: number; option_count: number }) {
  if (path === "existing") {
    return [
      "I want to adapt my existing multiple-choice items. Read the items in the file I attach.",
      "Fill in the whole design panel from them: learning objectives from what the items assess, evidence requirements from any explanation evidence the file states, and misconception hypotheses from the incorrect options, one for each distinct incorrect idea (several options can rest on the same idea). Where the file does not state this information, propose it from the items and their options, and tell me which parts you proposed.",
      "Keep the items as this topic's source items. If the file covers several topics, build the course topic bank and choose the topic that fits this mini test.",
      "Set the number of items to the number of my items for this topic (1 to 12). Ask only essential questions, one at a time. Prepare the design for my review; my items come into review after that."
    ].join("\n\n");
  }
  return [
    "I want to write new items from my course materials. Read the materials I attach or paste, such as lecture slides, textbook chapters, quizzes, sample items and item templates.",
    "Build the course topic bank, with each topic's knowledge points, content notes and the quiz or sample items that assess it. Then fill in the whole design panel for the topic that fits this mini test; the other topics get their own mini tests later. Link the design to the materials and point out gaps instead of inventing source content. If no material is available, ask me for it first.",
    `Plan for ${settings.target_item_count} items with ${settings.option_count} options each unless we agree otherwise. Fill in the design panel yourself and ask only essential questions, one at a time. Prepare the design for my review; do not generate items yet.`
  ].join("\n\n");
}

/**
 * The path shown for a design that has already started: the instructor's last choice in this
 * browser, or "existing" when the selected topic holds the instructor's own items.
 */
export function defaultItemDesignPath(design: {
  assistant_state: { topic_map?: { selected_topic_id: string | null; topics: Array<{ topic_id: string; source_items: unknown[] }> } | null };
}, stored: string | null): ItemDesignPath | null {
  if (stored === "existing" || stored === "new") return stored;
  const map = design.assistant_state.topic_map;
  const topic = map?.topics.find((entry) => entry.topic_id === map.selected_topic_id);
  if (topic && topic.source_items.length > 0) return "existing";
  return null;
}

export const itemDesignPathStorageKey = (assessmentPublicId: string) => `cmcq:item-design-path:${assessmentPublicId}`;

export function readStoredItemDesignPath(assessmentPublicId: string): string | null {
  try {
    return window.localStorage.getItem(itemDesignPathStorageKey(assessmentPublicId));
  } catch {
    return null;
  }
}

export function storeItemDesignPath(assessmentPublicId: string, path: ItemDesignPath) {
  try {
    window.localStorage.setItem(itemDesignPathStorageKey(assessmentPublicId), path);
  } catch {
    // The choice is a convenience; the page works without it.
  }
}
