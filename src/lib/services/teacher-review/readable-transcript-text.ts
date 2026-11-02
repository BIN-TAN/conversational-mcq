/**
 * Masks restricted item information in the readable transcript's message text.
 *
 * An answer key is masked only where a message states it: "the correct option is B",
 * "Option B is the correct answer", or any mention of the answer key. Since feedback
 * opening v8.8 the tutor may tell a student "You chose the correct option on every item",
 * which names no key; that sentence is shown as the student saw it (release 39).
 */
export function sanitizeReadableMessageText(value: string) {
  return value
    .replace(/\b(?:the\s+)?correct\s+(?:option|answer|choice)\s*(?:is|was|=|:)\s*(?:option\s+)?\(?[A-H]\)?(?![A-Za-z0-9])/gi, "[restricted item key]")
    .replace(/\boption\s+\(?[A-H]\)?\s+(?:is|was)\s+(?:the\s+)?(?:correct|keyed)(?:\s+(?:option|answer|choice))?\b/gi, "[restricted item key]")
    .replace(/\banswer key\b/gi, "[restricted item key]")
    .replace(/\bcorrectness\s*:/gi, "[restricted correctness]:")
    .replace(/\bdistractor rationales?\b/gi, "[restricted item metadata]");
}
