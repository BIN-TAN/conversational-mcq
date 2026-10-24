/**
 * Release CMCQ-20261020-06: what students read is complete, natural and plain.
 * - The feedback prompts (v8.2) ask for the way a knowledgeable, friendly tutor speaks, and the
 *   profiling prompt asks for plain sentences in the text instructors read.
 * - The application's own wording in the current student flow uses one name for each thing
 *   (tutor, question, attempt, instructor), full sentences, and no internal codes or labels.
 * No database or provider calls. Run with: npx tsx prisma/student-plain-language-unit-test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  buildInitialAdminPrompt,
  INITIAL_ADMIN_PROMPT_GENERATOR_VERSION
} from "../src/lib/student-assessment/initial-admin-prompts";
import {
  normalizeAssessmentStartErrorForStudent,
  shouldDisplayStudentApiErrorCode
} from "../src/lib/student-assessment-ui/start-errors";
import { studentResultSentence } from "../src/lib/services/student-assessment/evidence-integrated-profile";
import * as feedback from "../src/lib/services/student-assessment/feedback-v8/contract";
import * as interpretation from "../src/lib/services/student-assessment/interpretation-v8/contract";

let passed = 0;
function check(name: string, run: () => void) {
  run();
  passed += 1;
  console.log(`ok - ${name}`);
}
const source = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

check("The feedback and profiling prompts ask for complete, natural, plain language", () => {
  // Each prompt family's version is checked on its own line, apart from the others, so that one
  // family's prompt commit can be reverted without touching another's.
  assert.equal(feedback.FEEDBACK_V8_OPENING_PROMPT_VERSION, "formative-opening-v8.2");
  assert.equal(feedback.FEEDBACK_V8_CONVERSATION_PROMPT_VERSION, "formative-conversation-v8.3");

  for (const prompt of [feedback.FEEDBACK_V8_OPENING_INSTRUCTIONS, feedback.FEEDBACK_V8_CONVERSATION_INSTRUCTIONS]) {
    assert.match(prompt, /Write the way a knowledgeable, friendly tutor speaks: complete, natural sentences/);
    assert.match(prompt, /Do not use stock phrases \(such as "Great question!" or "I hope this helps"\), empty praise or sentence fragments\./);
    assert.match(prompt, /Explain a technical term when you use it, with a short example where it helps\./);
  }
  assert.match(feedback.FEEDBACK_V8_OPENING_INSTRUCTIONS, /Length is fine when it serves the focus\./);
  assert.match(interpretation.INTERPRETATION_V8_INSTRUCTIONS, /write rationales and notes as complete sentences\./);

  assert.equal(interpretation.INTERPRETATION_V8_PROMPT_VERSION, "student-profiling-v8.3");
});

check("Conversation v8.3 defines every focus type and strategy its turn record allows, and limits questions", () => {
  const prompt = feedback.FEEDBACK_V8_CONVERSATION_INSTRUCTIONS;
  const record = prompt.slice(prompt.indexOf("TURN RECORD"));
  for (const type of feedback.FOCUS_TYPES) assert.match(record, new RegExp(`\\n  ${type}: `), `focus type ${type} is defined`);
  for (const strategy of feedback.STRATEGIES) assert(record.includes(strategy), `strategy ${strategy} is listed`);
  assert.match(record, /possible_misconception: an idea listed in the profile's possible misconceptions, including one that spans several items/);
  assert.match(record, /asking the student to apply an idea to a new case is extend/);
  assert.match(prompt, /not as rhetorical questions, and ask at most one question in a reply\./);
});

check("Results read as a sentence, and the stored result format is unchanged", () => {
  assert.equal(studentResultSentence("2 of 3 correct"), "You got 2 of 3 questions right.");
  assert.equal(studentResultSentence("1 of 1 correct"), "You got 1 of 1 question right.");
  assert.equal(studentResultSentence("Not available"), "Your result: Not available.");
});

check("Fixed prompts during the mini-test are plain, and their generator version changed", () => {
  assert.equal(INITIAL_ADMIN_PROMPT_GENERATOR_VERSION, "initial-admin-prompt-generator-v5");
  const texts: string[] = [];
  for (let order = 1; order <= 12; order += 1) {
    for (const kind of ["answer_prompt", "reasoning_prompt", "tempting_option_prompt", "tempting_reason_prompt", "procedural_clarification", "repair_prompt"] as const) {
      texts.push(buildInitialAdminPrompt({ kind, assessmentState: "AWAIT_REASON", itemPublicId: `item_${order}`, itemOrder: order, selectedOption: "C" }).prompt_text);
      texts.push(buildInitialAdminPrompt({ kind, assessmentState: "AWAIT_REASON", itemPublicId: `item_${order}`, itemOrder: order, selectedOption: "E", latestStudentResponse: "I don't know" }).prompt_text);
    }
  }
  for (const text of texts) {
    assert.doesNotMatch(text, /invent a reason|should I record|record your|record this|current prompt|A-D option/i, text);
    assert.match(text, /[.?!]$/, `A full sentence: ${text}`);
  }
  assert(texts.some((text) => /option C\b/.test(text)), "The chosen option is named as \"option C\"");
  // v5: the tempting step uses buttons and asks the reason in the next step.
  for (const order of [1, 2, 3, 4, 5, 6]) {
    for (const selectedOption of ["C", "E"]) {
      const text = buildInitialAdminPrompt({ kind: "tempting_option_prompt", assessmentState: "AWAIT_TEMPTING_OPTION", itemPublicId: `item_${order}`, itemOrder: order, selectedOption }).prompt_text;
      assert.match(text, /If so, choose it\. If not, choose No\.$/, text);
      assert.doesNotMatch(text, /what made it|which one/i, text);
    }
  }
});

check("Students never see internal error codes, and conflicts say what to do", () => {
  const conflict = normalizeAssessmentStartErrorForStudent({ code: "session_start_conflict", message: "CONFLICT", status: 409 });
  assert.equal(conflict.message, "You already have an attempt in progress. Resume it to continue.");
  for (const status of [400, 403, 409, 500]) {
    assert.equal(shouldDisplayStudentApiErrorCode({ code: "request_failed", message: "x", status }), false);
  }
  assert(!source("src/components/student-assessment/available-assessments-client.tsx").includes("{error.code}"));
});

check("The current student flow uses one name for each thing and no internal wording", () => {
  const files = [
    "src/components/student-assessment/assessment-session-client.tsx",
    "src/components/student-assessment/available-assessments-client.tsx",
    "src/lib/student-assessment/initial-admin-prompts.ts",
    "src/lib/services/student-assessment/response-quality.ts",
    "src/lib/services/student-assessment/formative-conversation/availability.ts"
  ];
  const forbidden = [
    /Personalized learning support/, /learning support (?:is|could)/i, /your teacher/i, /teacher researcher/,
    /in this prototype/, /Retry \{failedAction\.label\}/, /Assessment Tutor/, /AI feedback reached its response limit/,
    /Item \{item\./, /remaining after this/, /Boundary to notice/, /Total correct/, /chances remaining/, /All three chances used/,
    /invent a reason/, /should I record/, /This assessment session is complete/
  ];
  for (const file of files) {
    const text = source(file);
    for (const pattern of forbidden) assert.doesNotMatch(text, pattern, `${file}: ${pattern}`);
  }
  const client = source("src/components/student-assessment/assessment-session-client.tsx");
  for (const phrase of ['STUDENT_FACING_TUTOR_LABEL = "Tutor"', "Reading your answers and preparing your feedback...", "Your score",
    "`Question ${item.initial_item_position} of ${item.initial_item_total}`", "What to watch for:", "Try again",
    "Your answers are saved. Preparing your feedback...", "contact your instructor"]) {
    assert(client.includes(phrase), phrase);
  }
});

check("Student-facing service errors are sentences with a next step, not internal names", () => {
  const service = source("src/lib/services/student-assessment/service.ts");
  for (const removed of ["Session was not found for this student.", "client_action_id was used", "concept unit is unavailable",
    "This action is not allowed in the current assessment state.", "A-D option"]) {
    assert(!service.includes(removed), removed);
  }
  assert(service.includes("We could not find this attempt. Go back to your assessments and open it again."));
  assert(source("src/lib/services/student-assessment/formative-conversation/finish-assessment.ts")
    .includes("You can finish once the conversation with the tutor has ended. If feedback is not available, contact your instructor."));
  const login = source("src/app/api/auth/login/route.ts");
  assert(!login.includes("Check database and environment configuration"));
  const http = source("src/lib/http.ts");
  assert(!http.includes("This endpoint requires a different role."));
  const password = source("src/components/student-account/password-change-client.tsx");
  assert(password.includes("data.error?.details?.issues") && password.includes("Use at least 8 characters."));
});

console.log(`\n${passed} student plain-language checks passed; no database or provider calls.`);
