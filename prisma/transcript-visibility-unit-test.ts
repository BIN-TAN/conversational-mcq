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

  console.log(`${passed} transcript visibility checks passed; no database or provider calls.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
