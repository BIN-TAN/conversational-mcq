/**
 * Readable transcripts for instructors (transcript-visibility-v1, release 20):
 * - Turns written during item administration (the item, each follow-up question, the student's
 *   actions and messages) are recorded as shown to the student, so new sessions no longer carry
 *   the "legacy visibility" limitation.
 * - Limitations are shown in plain sentences, not as codes.
 * - The reason for a tempting option no longer repeats "Option X was tempting." when the line
 *   before it already says so.
 * - With the formative conversation, a missing package_feedback turn is expected, not a warning.
 * No database or provider calls. Run with: npx tsx prisma/transcript-visibility-unit-test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { conversationVisibility } from "../src/lib/services/student-assessment/conversation-visibility";
import { TRANSCRIPT_LIMITATION_NOTES, transcriptLimitationNote } from "../src/lib/services/teacher-review/transcript-limitations";
import { sanitizeReadableMessageText } from "../src/lib/services/teacher-review/readable-transcript-text";

let passed = 0;
async function check(name: string, run: () => void | Promise<void>) {
  await run();
  passed += 1;
  console.log(`ok - ${passed}. ${name}`);
}
const source = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

async function main() {
  await check("item-administration turns are recorded as shown to the student", () => {
    const service = source("src/lib/services/student-assessment/service.ts");
    assert(service.includes("function logStudentShownTurn("));
    assert(!service.includes("await logConversationTurn({"), "Every turn written by the student service goes through logStudentShownTurn");
    assert(service.includes('{ ...record, visibility: "student_visible" }'));
    assert.equal(conversationVisibility({ source: "x", visibility: "student_visible" }), "student_visible");
    assert.equal(conversationVisibility({ source: "x" }), "legacy_unspecified");
    assert.equal(conversationVisibility({ visibility: "internal" }), "internal_only", "An explicit internal marker still wins");
  });

  await check("limitations read as plain sentences", () => {
    for (const code of ["internal_turns_excluded_available_in_assessment_log", "legacy_visibility_unspecified_not_proof_of_exposure", "empty_text_turns_hidden"]) {
      const note = transcriptLimitationNote(code);
      assert(TRANSCRIPT_LIMITATION_NOTES[code], code);
      assert(!note.includes("_") && /\.$/.test(note), note);
    }
    assert.equal(transcriptLimitationNote("some_new_code"), "some new code");
    const readable = source("src/lib/services/teacher-review/readable-transcript.ts");
    assert(readable.includes("transcriptLimitationNote(entry)"));
    assert(!readable.includes("Legacy turns without visibility metadata"));
    const page = source("src/components/teacher-review/session-detail-client.tsx");
    assert(page.includes("{transcriptLimitationNote(limitation)}"));
  });

  await check("a tempting-option reason does not repeat the line before it", async () => {
    const { withoutRepeatedTemptingLine } = await import("../src/lib/services/teacher-review/readable-transcript");
    const reason = "Option D was tempting.\nI suppose it could be GRM.";
    assert.equal(withoutRepeatedTemptingLine(reason, "Option D was tempting."), "I suppose it could be GRM.");
    assert.equal(withoutRepeatedTemptingLine(reason, "Option C was tempting."), reason, "A different option keeps its line");
    assert.equal(withoutRepeatedTemptingLine(reason, null), reason, "Without a line before it, the text is kept");
    assert.equal(withoutRepeatedTemptingLine("Option D was tempting.", "Option D was tempting."), "Option D was tempting.");
  });

  await check("feedback given in the formative conversation is not reported as a missing package_feedback turn", () => {
    const service = source("src/lib/services/student-assessment/service.ts");
    assert(service.includes('if (!feedbackTurn && !usesFormativeConversation) safeWarnings.push("package_feedback_turn_missing");'));
    assert(service.includes('feedback_status: feedbackTurn ? "existing" : usesFormativeConversation ? "not_applicable" : "missing",'));
  });

  await check("the readable transcript masks a stated answer key but keeps encouragement as the student saw it (release 39)", () => {
    const praise = "You chose the correct option on every item. In Item 1, you linked information to the cut score.";
    assert.equal(sanitizeReadableMessageText(praise), praise);
    assert.equal(sanitizeReadableMessageText("Every answer was correct."), "Every answer was correct.");
    assert.equal(sanitizeReadableMessageText("The correct option is B, because the cSEM is 1/sqrt(I)."), "[restricted item key], because the cSEM is 1/sqrt(I).");
    assert.equal(sanitizeReadableMessageText("Here the correct answer was (C)."), "Here [restricted item key].");
    assert.equal(sanitizeReadableMessageText("Option D is the correct answer."), "[restricted item key].");
    assert.equal(sanitizeReadableMessageText("Check the answer key."), "Check the [restricted item key].");
    assert.equal(sanitizeReadableMessageText("correctness: correct"), "[restricted correctness]: correct");
    assert.equal(sanitizeReadableMessageText("The correct option is Brief."), "The correct option is Brief.", "A word starting with a letter is not an option");
    const service = source("src/lib/services/teacher-review/readable-transcript.ts");
    assert(service.includes('import { sanitizeReadableMessageText } from "./readable-transcript-text";'));
    assert(!service.includes("correct option|answer key"), "The broad mask is gone");
  });

  console.log(`${passed} transcript visibility checks passed; no database or provider calls.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
