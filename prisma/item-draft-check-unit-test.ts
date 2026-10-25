/**
 * Item builder, release CMCQ-20261020-05: drafts are checked before the teacher sees them, the language is
 * plain and natural, and the other topics of a course topic bank can be prepared in one run.
 * - The check answers each draft without its proposed key; drafts with another answer or a
 *   reported problem are revised once and checked again (item-design.ts checkGeneratedItems).
 * - The review page names statuses, flags and check results in plain sentences, and the
 *   teacher can confirm together the keys the check agreed with.
 * - The topic run creates each topic's mini test, fills its design panel and writes drafts,
 *   and can be stopped and started again.
 * No database or provider calls. Run with: npx tsx prisma/item-draft-check-unit-test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  checkFindsProblem,
  ITEM_CHECK_SCHEMA_VERSION,
  ItemCheckOutputSchema,
  ItemGenerationOutputSchema,
  itemCheckSummary,
  normalizeLegacyItemGenerationOutput
} from "../src/lib/services/content/item-design-contract";
import {
  assistantCheckHeadline,
  assistantCheckOf,
  candidateStatusLabel,
  issueFlagDescriptions,
  keysTheCheckAgreedWith
} from "../src/components/teacher-content/mcq-review";
import { prepareTopicMiniTests, topicRunStepText, type TopicRunState } from "../src/components/teacher-content/topic-preparation";
import type { McqImportCandidate } from "../src/components/teacher-content/types";

let passed = 0;
async function check(name: string, run: () => void | Promise<void>) {
  await run();
  passed += 1;
  console.log(`ok - ${name}`);
}
const source = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");
const between = (text: string, start: string, end: string) => text.slice(text.indexOf(start), text.indexOf(end));

const finding = (answer: string | null, defensible: string[], problems: Array<{ check: "ambiguous_wording"; detail: string }> = []) =>
  ({ item_label: "Item 1", independent_answer: answer, defensible_options: defensible, problems });

const candidate = (overrides: Partial<McqImportCandidate> & { check?: Record<string, unknown> | null }): McqImportCandidate => {
  const { check: assistantCheck, ...rest } = overrides;
  const options = [{ label: "A", text: "Theta" }, { label: "B", text: "Percent correct" }];
  return {
    candidate_public_id: `c_${Math.random().toString(36).slice(2)}`,
    item_label: "Item",
    stem: "Which value is on the latent scale?",
    options,
    imported_key: null,
    llm_suggested_key: "A",
    teacher_confirmed_key: null,
    status: "needs_key",
    issue_flags: ["teacher_confirmed_key_required"],
    suggestion: assistantCheck === null ? { suggested_key: "A" } : {
      suggested_key: "A",
      assistant_check: {
        status: "checked", independent_answer: "A", agrees_with_key: true, revised: false, remaining_problems: [],
        checked_stem: "Which value is on the latent scale?", checked_options: options, ...assistantCheck
      }
    },
    ...rest
  } as unknown as McqImportCandidate;
};

async function main() {
  await check("A draft passes only when the check, without the key, defends the key alone and reports nothing", () => {
    assert.equal(checkFindsProblem(finding("A", ["A"]), "A"), false);
    assert.equal(checkFindsProblem(finding("B", ["B"]), "A"), true, "Another answer");
    assert.equal(checkFindsProblem(finding("A", ["A", "C"]), "A"), true, "Two defensible answers");
    assert.equal(checkFindsProblem(finding(null, []), "A"), true, "No defensible answer");
    assert.equal(checkFindsProblem(finding("A", ["A"], [{ check: "ambiguous_wording", detail: "x" }]), "A"), true, "A reported problem");
    assert.equal(checkFindsProblem(undefined, "A"), true, "An item the check left out");
  });

  await check("Check results read as complete, natural sentences", () => {
    const other = itemCheckSummary({ check: finding("B", ["B"]), proposed_key: "A", revised: false });
    assert.equal(other.agrees_with_key, false);
    assert.equal(other.remaining_problems[0],
      "When the assistant answered this item without seeing the key, it chose B, but the proposed key is A. Please check which answer is correct.");
    const two = itemCheckSummary({ check: finding(null, ["A", "B", "C"]), proposed_key: "A", revised: true });
    assert.match(two.remaining_problems[0], /more than one defensible answer \(A, B and C\)\. The proposed key is A\./);
    assert.equal(two.revised, true);
    const none = itemCheckSummary({ check: finding(null, []), proposed_key: "D", revised: false });
    assert.match(none.remaining_problems[0], /could not defend any option\. The proposed key is D\./);
    const problem = itemCheckSummary({
      check: finding("A", ["A"], [{ check: "ambiguous_wording", detail: "The word \"score\" could mean the raw score or theta." }]),
      proposed_key: "A", revised: false
    });
    assert.deepEqual(problem.remaining_problems, ["The word \"score\" could mean the raw score or theta."]);
    assert.equal(itemCheckSummary({ check: undefined, proposed_key: "A", revised: false }).status, "unavailable");
    for (const summary of [other, two, none]) {
      assert.doesNotMatch(summary.remaining_problems[0], /_|independent_answer|defensible_options/, "No field names or codes");
    }
  });

  await check("Check output and idea labels parse; drafts from before idea labels still replay", () => {
    assert.equal(ItemCheckOutputSchema.parse({ schema_version: ITEM_CHECK_SCHEMA_VERSION, items: [finding("A", ["A"])] }).items.length, 1);
    assert.throws(() => ItemCheckOutputSchema.parse({ schema_version: ITEM_CHECK_SCHEMA_VERSION, items: [{ ...finding("A", ["A"]), problems: [{ check: "made_up", detail: "x" }] }] }));
    const option = (label: string, extra: Record<string, unknown> = {}) =>
      ({ label, text: `Option ${label}`, rationale: `Why ${label}`, linked_misconception_ids: [], ...extra });
    const legacy = {
      schema_version: "evidence-centered-mcq-generation-output-v1",
      blueprint_version: "evidence-centered-item-design-v1",
      candidates: [{
        item_label: "Item 1", stem: "Stem?", options: [option("A"), option("B"), option("C")],
        proposed_correct_option: "A", correct_answer_explanation: "Because.", objective_ids: ["objective_1"],
        misconception_hypothesis_ids: [], target_reasoning_note: "Note.", strong_reasoning_should_mention: "Point.",
        cognitive_demand: "apply", difficulty: "foundational", limitations: []
      }],
      coverage_summary: [{ objective_id: "objective_1", candidate_count: 1 }],
      set_level_limitations: [],
      teacher_review_required: true
    };
    const replayed = ItemGenerationOutputSchema.parse(normalizeLegacyItemGenerationOutput(legacy));
    assert.deepEqual(replayed.candidates[0].options.map((entry) => entry.idea_label), [null, null, null]);
    const labelled = structuredClone(legacy);
    labelled.candidates[0].options = [option("A", { idea_label: null }), option("B", { idea_label: "Theta as percent correct" }), option("C", { idea_label: "Harder form, lower ability" })];
    assert.equal(ItemGenerationOutputSchema.parse(labelled).candidates[0].options[1].idea_label, "Theta as percent correct");
  });

  await check("The check sees no key or rationale; revisions keep label, links and demand; failures never block drafts", () => {
    const text = source("src/lib/services/content/item-design.ts");
    const context = between(text, "function itemCheckContext", "/** A revised draft is used only");
    assert(context.includes("options: candidate.options.map((option) => ({ label: option.label, text: option.text }))"));
    assert(!context.includes("proposed_correct_option") && !context.includes("rationale:"));
    assert(context.includes("item_label: checkLabel(index)"), "Items are named by position, since chunk labels can repeat");
    const revision = between(text, "function acceptableRevision", "/**\n * Checks the drafts before");
    for (const part of ["revised.item_label === original.item_label", "revised.cognitive_demand === original.cognitive_demand",
      "cognitiveDemandBand(revised.cognitive_demand) === original.difficulty", "sameSet(revised.objective_ids, original.objective_ids)"]) {
      assert(revision.includes(part), part);
    }
    const pipeline = between(text, "async function checkGeneratedItems", "export async function generateAssessmentItemDrafts");
    for (const part of [":check:${key}", ":revise:${chunkIndex + 1}", "if (!first) return", "if (revised.length !== chunk.length) return;",
      "Promise.all(chunks.map", "const second = await check(\"2\", revisedIndexes"]) assert(pipeline.includes(part), part);
    const call = between(text, "async function auditedCheckCall", "/** Items are named by position");
    assert(call.includes("call_status: \"succeeded\"") && call.includes("return null;"), "Audited, and a failure returns no result");
    assert(text.includes("item_checks: checked.summaries"));
    assert(text.includes("call.agent_invocation_key?.includes(\":check:\")"), "A full-set replay skips the check calls");
  });

  await check("Prompts ask for plain, natural language and a check with actionable sentences", () => {
    const text = source("src/lib/services/content/item-design.ts");
    const assistant = between(text, "export const ITEM_DESIGN_ASSISTANT_INSTRUCTIONS", "export const ITEM_DESIGN_ASSISTANT_PROMPT_HASH");
    assert(assistant.includes("PLAIN, NATURAL LANGUAGE") && assistant.includes("the way an experienced colleague would"));
    assert(assistant.includes("Do not use stock phrases"));
    const generation = between(text, "export const ITEM_GENERATION_INSTRUCTIONS", "const ITEM_GENERATION_RECOVERY_INSTRUCTIONS");
    for (const part of ["PLAIN, NATURAL LANGUAGE", "understands on first reading", "write them to the student as a clear explanation",
      "idea_label of two to six plain words", "the key's idea_label is null"]) assert(generation.includes(part), part);
    const checkPrompt = between(text, "export const ITEM_CHECK_INSTRUCTIONS", "export const ITEM_CHECK_PROMPT_HASH");
    for (const part of ["without its proposed answer", "independent_answer", "defensible_options", "answer_cue", "not_plain_language",
      "reading_load", "item_dependency", "complete, natural sentence the teacher can act on"]) assert(checkPrompt.includes(part), part);
    const revisionPrompt = between(text, "const ITEM_REVISION_INSTRUCTIONS", "export const ITEM_REVISION_PROMPT_HASH");
    assert(revisionPrompt.includes("exactly one option is defensible") && revisionPrompt.includes("in the same order"));
  });

  await check("Item preparation v8.3 (import suggestions, layout repair, pre-publish check) follows the same writing rules", async () => {
    const prep = await import("../src/lib/services/content/item-preparation/contract");
    assert.equal(prep.ITEM_PREPARATION_PROMPT_VERSION, "item-preparation-v8.3");
    assert.equal(prep.ITEM_PREPARATION_SCHEMA_VERSION, "item-preparation-output-v8.1");
    for (const part of ["WRITING GOOD ITEMS", "answer the stem before reading the options", "exactly one is fully correct",
      "Keep the reading load low", "keep the instructor's wording even where it breaks these rules", "write it to the student as a clear explanation",
      "idea label of two to six plain words", "First answer each item yourself without relying on its key", "not_plain_language",
      "item_dependency", "does_not_assess_objective", "without stock phrases"]) {
      assert(prep.ITEM_PREPARATION_INSTRUCTIONS.includes(part), part);
    }
    for (const code of ["does_not_assess_objective", "not_plain_language", "item_dependency"] as const) {
      assert((prep.MODEL_PROBLEM_CODES as readonly string[]).includes(code));
      assert.match(prep.PROBLEM_CODE_LABELS[code], /^[A-Z][a-z]/);
    }
  });

  await check("Statuses and flags are named in plain words, without codes", () => {
    assert.equal(candidateStatusLabel("needs_key"), "Key to confirm");
    assert.equal(candidateStatusLabel("ready_as_draft"), "Ready to add");
    assert.deepEqual(issueFlagDescriptions(["teacher_confirmed_key_required"]), [], "The key area already asks for the key");
    const described = issueFlagDescriptions(["key_missing", "possible_duplicate", "assistant_check_needs_attention",
      "assistant_check_unavailable", "embedded_image_requires_review", "tracked_changes_require_review"]);
    assert.equal(described.length, 6);
    for (const sentence of described) {
      assert.doesNotMatch(sentence, /_/);
      assert.match(sentence, /^[A-Z].*\.$/, "A sentence");
    }
    const client = source("src/components/teacher-content/mcq-import-client.tsx");
    assert(client.includes("candidateStatusLabel(candidate.status, { key_confirmed: Boolean(candidate.teacher_confirmed_key) })") && client.includes("issueFlagDescriptions(candidate.issue_flags)"));
    assert(!client.includes("Issues: {candidate.issue_flags.join") && !client.includes("Unofficial key suggestion"));
  });

  await check("The review shows the check in plain sentences and notices edits since the check", () => {
    const passedCheck = assistantCheckOf(candidate({}))!;
    assert.equal(assistantCheckHeadline(passedCheck, "A"),
      "The assistant answered this item without seeing the key, chose A, the proposed key, and found nothing to fix.");
    assert.match(assistantCheckHeadline(assistantCheckOf(candidate({ check: { revised: true } }))!, "A"), /^The first check found a problem, so the item was rewritten\./);
    const flagged = assistantCheckOf(candidate({ check: { agrees_with_key: false, remaining_problems: ["Two options are defensible."] } }))!;
    assert.equal(assistantCheckHeadline(flagged, "A"), "The automatic check found something to look at:");
    assert.equal(assistantCheckHeadline(assistantCheckOf(candidate({ check: { status: "unavailable" } }))!, "A"),
      "The automatic check could not run for this item, so review it as usual.");
    const edited = assistantCheckOf(candidate({ stem: "Which value is on the latent ability scale?" }))!;
    assert.equal(edited.current, false);
    assert.match(assistantCheckHeadline(edited, "A"), /^The question or options have changed since the automatic check/);
    assert.equal(assistantCheckOf(candidate({ check: null })), null);
  });

  await check("Confirm-together offers only unedited drafts whose check chose the proposed key and found nothing", () => {
    const eligible = candidate({ item_label: "eligible" });
    const list = [
      eligible,
      candidate({ item_label: "confirmed", teacher_confirmed_key: "A" }),
      candidate({ item_label: "problem", check: { remaining_problems: ["Option B is also defensible."] } }),
      candidate({ item_label: "disagrees", check: { agrees_with_key: false, independent_answer: "B" } }),
      candidate({ item_label: "unavailable", check: { status: "unavailable" } }),
      candidate({ item_label: "edited", options: [{ label: "A", text: "Theta (ability)" }, { label: "B", text: "Percent correct" }] }),
      candidate({ item_label: "imported", imported_item_public_id: "item_1" } as Partial<McqImportCandidate>),
      candidate({ item_label: "no check", check: null })
    ];
    assert.deepEqual(keysTheCheckAgreedWith(list).map((entry) => entry.item_label), ["eligible"]);
    const client = source("src/components/teacher-content/mcq-import-client.tsx");
    assert(client.includes("Confirm the keys the check agreed with ({checkedKeys.length})"));
    assert(client.includes("teacher_confirmed_key: entry.imported_key ?? entry.llm_suggested_key"), "A key the file states comes first");
  });

  await check("The topic run prepares each other topic, skips drafted ones, asks when input is needed, and can stop", async () => {
    const calls: string[] = [];
    let stop = false;
    const designs: Record<string, { messages: number; ready: boolean }> = {
      mt_two: { messages: 0, ready: true },
      mt_three: { messages: 0, ready: false },
      mt_four: { messages: 2, ready: true }
    };
    const original = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      const target = String(url);
      const method = init?.method ?? "GET";
      calls.push(`${method} ${target}`);
      const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
      if (target.endsWith("/topic-mini-test")) {
        const topicId = JSON.parse(String(init?.body)).topic_id as string;
        if (topicId === "five") return json({ error: { code: "validation_failed", message: "This topic is no longer in the course topic bank." } }, 422);
        return json({ assessment_public_id: `mt_${topicId}`, builder_url: "x", created: true });
      }
      const id = target.split("/")[4]!;
      const state = designs[id]!;
      const design = () => ({ blueprint_hash: `hash_${id}`, concept_unit_version: 1,
        assistant_thread: { messages: Array.from({ length: state.messages }) }, assistant_state: { ready_for_item_generation: state.ready } });
      if (target.endsWith("/assistant")) {
        const body = JSON.parse(String(init?.body));
        assert.equal(body.expected_blueprint_hash, `hash_${id}`);
        assert.match(body.message, /^Please prepare this mini test for the topic "/);
        state.messages = 2;
        return json(design());
      }
      if (target.endsWith("/generate")) {
        if (id === "mt_four") stop = true;
        return json({ review_url: `/teacher/content/assessments/${id}/import-mcq?batch=b_${id}` });
      }
      return json(design());
    }) as typeof fetch;
    const updates: TopicRunState[] = [];
    try {
      const results = await prepareTopicMiniTests({
        bank_assessment_public_id: "mt_one",
        topics: ["one_drafted", "two", "three", "four", "five", "six"].map((id) => ({ topic_id: id, title: `Topic ${id}` })),
        existing: [{ topic_id: "one_drafted", assessment_public_id: "mt_one_drafted", draft_review_url: "/drafts/one" }],
        onUpdate: (state) => updates.push(state),
        shouldStop: () => stop,
        newClientMessageId: () => "client_message"
      });
      assert.deepEqual(results.map((entry) => entry.step), ["ready", "ready", "needs_input", "ready", "stopped", "stopped"]);
      assert.equal(results[0].link, "/drafts/one", "A topic drafted earlier is not drafted again");
      assert.equal(results[1].link, "/teacher/content/assessments/mt_two/import-mcq?batch=b_mt_two");
      assert.equal(results[2].link, "/teacher/content/assessments/mt_three/item-design");
      assert.match(results[2].note ?? "", /answer the assistant's question/);
      assert(!calls.includes("POST /api/teacher/assessments/mt_four/item-design/assistant"), "A design filled earlier is not filled again");
      assert(!calls.some((entry) => entry.includes("mt_one_drafted")));
      assert(updates.some((entry) => entry.topic_id === "two" && entry.step === "designing"));
      assert(updates.some((entry) => entry.topic_id === "two" && entry.step === "drafting"));
    } finally {
      globalThis.fetch = original;
    }
    globalThis.fetch = (async (url: string | URL) => String(url).endsWith("/topic-mini-test")
      ? new Response(JSON.stringify({ error: { code: "validation_failed", message: "This topic is no longer in the course topic bank." } }), { status: 422 })
      : new Response("{}")) as typeof fetch;
    try {
      const [failed] = await prepareTopicMiniTests({
        bank_assessment_public_id: "mt_one", topics: [{ topic_id: "five", title: "Topic five" }], existing: [],
        onUpdate: () => undefined, shouldStop: () => false
      });
      assert.equal(failed.step, "failed");
      assert.equal(failed.note, "This topic is no longer in the course topic bank. Start again to retry this topic; finished topics are kept.");
    } finally {
      globalThis.fetch = original;
    }
    assert.equal(topicRunStepText("drafting"), "Preparing and checking drafts (a few minutes)");
    const client = source("src/components/teacher-content/item-design-client.tsx");
    for (const part of ["Prepare the other topics (${otherTopics.length})", "Stop after the current step", "Review its drafts",
      "The design is ready for drafts.", "Generate drafts", "topicRunActive || (busy !== null"]) assert(client.includes(part), part);
    const service = source("src/lib/services/content/item-design.ts");
    assert(service.includes("draft_review_url: latestDrafts"));
  });

  console.log(`\n${passed} item draft check, plain-language and topic run checks passed; no database or provider calls.`);
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
