/**
 * Release CMCQ-20261020-06, database smoke test: an instructor's existing items are read from
 * attached files (Word, text, CSV and Excel here), keep their wording and stated keys, and arrive
 * on the review page with suggested specifications for what the file lacks. With accessible wording
 * (existing-mcq-import-v4), an item whose simpler version passes the checks starts with it, the
 * original wording is kept, the teacher's per-item choice is what is added, and the item's
 * provenance records which wording it used; with the setting off, items stay as written.
 * Uses a stub provider; no live calls. Needs the database.
 * Run with: npx tsx prisma/existing-items-import-smoke-test.ts
 */
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import JSZip from "jszip";
import * as XLSX from "xlsx";
import { hashSecret } from "../src/lib/password";
import type { LlmProvider, StructuredAgentRequest, StructuredAgentResult } from "../src/lib/llm/providers/types";
import { createAssessment } from "../src/lib/services/content/assessments";
import { ContentServiceError } from "../src/lib/services/content/errors";
import { importExistingItemsFromMaterials, withItemGenerationProviderForTest } from "../src/lib/services/content/item-design";
import { commitMcqItemImport, getMcqItemImportBatch } from "../src/lib/services/content/mcq-import";
import { normalizeUserId } from "../src/lib/services/student-accounts/validation";

const prisma = new PrismaClient();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const options = [
  { label: "A", text: "Item responses are uncorrelated in the whole sample." },
  { label: "B", text: "Item responses are independent once theta is held fixed." },
  { label: "C", text: "Each item measures a different ability." },
  { label: "D", text: "Students answer each item without looking at the others." }
];

const simplerOptions = [
  { label: "A", text: "Item responses are not linked in the whole sample." },
  { label: "B", text: "Item responses are independent once theta is fixed." },
  { label: "C", text: "Each item measures its own ability." },
  { label: "D", text: "Students answer each item without looking at the others." }
];

class ImportProvider implements LlmProvider {
  readRequests: Array<StructuredAgentRequest<unknown, unknown>> = [];
  checkRequests: Array<StructuredAgentRequest<unknown, unknown>> = [];
  belongsToTopic = true;

  async executeStructured<TInput, TOutput>(request: StructuredAgentRequest<TInput, TOutput>): Promise<StructuredAgentResult<TOutput>> {
    const done = (output: unknown): StructuredAgentResult<TOutput> => ({
      provider: "mock", client_request_id: request.client_request_id, provider_request_id: `mock_${request.client_request_id}`,
      provider_response_id: `mock_${request.client_request_id}_response`, status: "completed", parsed_output: output as TOutput,
      raw_output: output, usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 }, latency_ms: 1
    });
    if (request.metadata?.purpose === "teacher_existing_item_check") {
      this.checkRequests.push(request as StructuredAgentRequest<unknown, unknown>);
      const input = request.input as { items: Array<{ item_label: string }> };
      return done({
        schema_version: "evidence-centered-mcq-item-check-output-v1",
        items: input.items.map((item) => ({ item_label: item.item_label, independent_answer: "B", defensible_options: ["B"], problems: [] }))
      });
    }
    assert(request.metadata?.purpose === "teacher_existing_item_import", `Unexpected call ${request.metadata?.purpose}`);
    this.readRequests.push(request as StructuredAgentRequest<unknown, unknown>);
    const item = (label: string, statedKey: string | null) => ({
      source_label: label,
      source_topic: "Cluster 2: Model assumptions",
      belongs_to_selected_topic: this.belongsToTopic,
      stem: `${label}. Which statement describes local independence?`,
      options,
      stated_key: statedKey,
      suggested_key: statedKey ? null : "B",
      target_reasoning: "Once ability is held fixed, one answer tells you nothing more about another answer.",
      target_reasoning_from_source: Boolean(statedKey),
      essential_elements: ["Conditions on theta"],
      essential_elements_from_source: Boolean(statedKey),
      option_notes: [
        { label: "A", rationale: "Drops the conditioning on theta.", idea_label: "Independence without conditioning", from_source: Boolean(statedKey), linked_misconception_ids: [] },
        { label: "C", rationale: "Confuses local independence with separate abilities.", idea_label: "Independence as separate abilities", from_source: false, linked_misconception_ids: [] },
        { label: "D", rationale: "Reads independence as a test-taking rule.", idea_label: "Independence as test behavior", from_source: false, linked_misconception_ids: [] }
      ],
      objective_ids: [],
      note_for_teacher: statedKey ? null : "The file gives no key for this item; the suggested key needs your check.",
      // D1 gets a simpler version that keeps every term; D2 is already easy to read.
      accessible_version: statedKey && accessibleRequested
        ? { changed: true, stem: `${label}. What does local independence mean?`, options: simplerOptions,
            key_terms: ["local independence", "theta"], change_note: "Shorter question with more common words." }
        : { changed: false, stem: null, options: [], key_terms: accessibleRequested ? ["local independence"] : [], change_note: null }
    });
    const accessibleRequested = (request.input as { required_output?: { accessible_wording?: boolean } }).required_output?.accessible_wording === true;
    return done({
      schema_version: "existing-mcq-import-output-v2",
      items: [item("D1", "B"), item("D2", null)],
      skipped: [{ source_label: "D3", reason: "The stem has no options." }]
    });
  }
}

async function blueprintDocx() {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  const lines = ["Cluster 2: Model assumptions", "D1. Which statement describes local independence?",
    ...options.map((option) => `${option.label}. ${option.text}`), "Key B. Required explanation evidence: conditions on theta."];
  zip.file("word/document.xml", `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${
    lines.map((line) => `<w:p><w:r><w:t>${line}</w:t></w:r></w:p>`).join("")}</w:body></w:document>`);
  return zip.generateAsync({ type: "nodebuffer" });
}

function workbook() {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ["Item", "Stem", "A", "B", "C", "D", "Key"],
    ["D2", "Which statement describes local independence?", ...options.map((option) => option.text), ""]
  ]), "Items");
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

async function main() {
  const suffix = `${Date.now()}_${randomUUID().slice(0, 8)}`;
  const userId = `existing_items_teacher_${suffix}`;
  const teacher = await prisma.user.create({
    data: { user_id: userId, user_id_normalized: normalizeUserId(userId), role: "teacher_researcher", password_hash: await hashSecret(randomUUID()) }
  });
  let assessmentPublicId: string | null = null;
  try {
    const assessment = await createAssessment({
      teacher_user_db_id: teacher.id,
      data: {
        title: `IRT model assumptions ${suffix}`,
        diagnostic_focus: "Explain local independence.",
        folder_label: "Existing items smoke",
        workflow_mode: "automatic",
        response_collection_mode: "llm_assisted",
        auto_create_primary_topic: true
      }
    });
    assessmentPublicId = assessment.assessment_public_id;
    const files = [
      { file_name: "lecture-4-blueprint.docx", media_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", bytes: await blueprintDocx() },
      { file_name: "items.txt", media_type: "text/plain", bytes: Buffer.from("D3. A stem without options.", "utf8") },
      { file_name: "items.csv", media_type: "text/csv", bytes: Buffer.from("Item,Stem,Key\nD4,Placeholder stem,A\n", "utf8") },
      { file_name: "items.xlsx", media_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", bytes: workbook() }
    ];
    const provider = new ImportProvider();
    const run = () => withItemGenerationProviderForTest({ provider, provider_label: "mock" }, () =>
      importExistingItemsFromMaterials({ teacher_user_db_id: teacher.id, assessment_public_id: assessmentPublicId!, files }));

    const result = await run();
    assert(result.imported_count === 2 && result.skipped_count === 1 && result.other_topic_count === 0 && !result.replayed, "Two items imported, one skipped.");
    assert(result.review_url.endsWith(`/import-mcq?batch=${result.batch_public_id}`), "The result links to the review page.");

    const readInput = JSON.stringify(provider.readRequests[0]?.input);
    for (const text of ["Key B. Required explanation evidence", "D3. A stem without options.", "D4,Placeholder stem,A", "Sheet: Items",
      "Item responses are independent once theta is held fixed."]) {
      assert(readInput.includes(text), `The read call sees the extracted text: ${text}`);
    }
    const checkInput = JSON.stringify(provider.checkRequests[0]?.input);
    assert(provider.checkRequests.length === 1 && !/stated_key|suggested_key|proposed_correct_option|rationale/.test(checkInput),
      "One check call answers the items without their keys or notes.");

    const { batch } = await getMcqItemImportBatch({ teacher_user_db_id: teacher.id, assessment_public_id: assessmentPublicId, batch_public_id: result.batch_public_id });
    assert(batch.source_type === "existing_items_from_materials", "The batch is marked as the instructor's own items.");
    const [first, second] = batch.candidates;
    assert(first && second, "Two candidates.");
    assert(first.stem === "D1. What does local independence mean?" && first.wording_version === "accessible",
      "An item whose simpler version passed the checks starts with it.");
    const firstWording = (first.suggestion as Record<string, unknown>).accessible_wording as Record<string, unknown>;
    assert((firstWording.original as { stem: string }).stem === "D1. Which statement describes local independence?", "The original wording is kept.");
    assert(second.stem === "D2. Which statement describes local independence?" && second.wording_version === "as_written", "Unchanged wording stays as written.");
    assert(JSON.stringify(provider.checkRequests[0]?.input).includes("D1. What does local independence mean?"), "The check answers the wording the item starts with.");
    assert(first.imported_key === "B" && first.llm_suggested_key === null, "A stated key is kept as the imported key.");
    assert(first.target_reasoning_note?.startsWith("Once ability is held fixed"), "A stated target reasoning fills the field.");
    assert(first.option_rationales.some((entry) => entry.label === "A" && entry.rationale === "Drops the conditioning on theta."), "A stated note fills the field.");
    const firstSuggestion = first.suggestion as Record<string, unknown>;
    assert(Array.isArray(firstSuggestion.suggested_option_rationales) && firstSuggestion.suggested_option_rationales.length === 2, "Proposed notes wait for review.");
    assert(String(firstSuggestion.evidence_justification_summary).startsWith("From your file: stem, options, key, target reasoning, essential elements and notes on incorrect options."),
      "The review page says where each field came from.");
    assert(second.imported_key === null && second.llm_suggested_key === "B" && second.issue_flags.includes("key_missing"), "Without a stated key, the key is only suggested.");
    const secondSuggestion = second.suggestion as Record<string, unknown>;
    assert(secondSuggestion.suggested_target_reasoning_note && secondSuggestion.suggested_strong_reasoning_should_mention, "Missing specs are suggested.");
    assert(String(secondSuggestion.evidence_justification_summary).endsWith("The file gives no key for this item; the suggested key needs your check."),
      "The note for the teacher is kept after the source sentence.");
    assert((firstSuggestion.assistant_check as Record<string, unknown>)?.agrees_with_key === true, "The check result is shown on each item.");

    const calls = await prisma.agentCall.findMany({ where: { agent_invocation_key: { startsWith: `existing_item_import:${assessmentPublicId}:` } } });
    assert(calls.length === 2 && calls.every((call) => call.call_status === "succeeded"), "Both calls are audited.");
    assert(calls.some((call) => call.prompt_version === "existing-mcq-import-v4"), "The read call records its prompt version.");
    assert(!calls.some((call) => JSON.stringify(call.input_payload).includes(userId)), "No account identifiers reach the provider context.");

    const replay = await run();
    assert(replay.replayed && replay.batch_public_id === result.batch_public_id && provider.readRequests.length === 1,
      "The same files are not read again; the same review batch opens.");

    // The teacher switches D1 back to the original wording; D2 is added as it is. Only D1 changes.
    const committed = await commitMcqItemImport({
      teacher_user_db_id: teacher.id, assessment_public_id: assessmentPublicId, batch_public_id: result.batch_public_id,
      data: {
        expected_updated_at: batch.updated_at,
        selected_candidate_public_ids: [first.candidate_public_id, second.candidate_public_id],
        candidate_updates: [
          { candidate_public_id: first.candidate_public_id, wording_version: "as_written", teacher_confirmed_key: "B",
            stem: "D1. Which statement describes local independence?", options },
          { candidate_public_id: second.candidate_public_id, teacher_confirmed_key: "B" }
        ]
      }
    });
    assert(committed.imported_count === 2, "Both items are added.");
    const added = await prisma.item.findMany({ where: { item_public_id: { in: committed.imported_item_public_ids } }, orderBy: { item_order: "asc" } });
    const wordingOf = (rules: unknown) => ((rules as Record<string, Record<string, unknown>>).import_provenance?.wording ?? null) as Record<string, unknown> | null;
    assert(added[0]?.item_stem === "D1. Which statement describes local independence?", "The item contains the wording the teacher chose for it.");
    assert(wordingOf(added[0]?.administration_rules)?.wording_version === "as_written" &&
      wordingOf(added[0]?.administration_rules)?.edited_by_teacher === false &&
      wordingOf(added[0]?.administration_rules)?.prompt_version === "existing-mcq-import-v4", "Provenance records the item's wording choice.");
    assert(wordingOf(added[1]?.administration_rules)?.status === "unchanged" && wordingOf(added[1]?.administration_rules)?.wording_version === "as_written",
      "Each item records its own wording.");

    // With the setting off, the items are read again and every item stays as written.
    const asWritten = await withItemGenerationProviderForTest({ provider, provider_label: "mock" }, () =>
      importExistingItemsFromMaterials({ teacher_user_db_id: teacher.id, assessment_public_id: assessmentPublicId!, files, accessible_wording: false }));
    assert(!asWritten.replayed && (provider.readRequests.length as number) === 2, "A different setting is a new import.");
    const offBatch = (await getMcqItemImportBatch({ teacher_user_db_id: teacher.id, assessment_public_id: assessmentPublicId, batch_public_id: asWritten.batch_public_id })).batch;
    assert(offBatch.candidates[0]?.stem === "D1. Which statement describes local independence?" && offBatch.candidates[0]?.wording_version === "as_written",
      "With the setting off, the wording stays as written.");

    provider.belongsToTopic = false;
    let rejected: unknown = null;
    try {
      await withItemGenerationProviderForTest({ provider, provider_label: "mock" }, () =>
        importExistingItemsFromMaterials({ teacher_user_db_id: teacher.id, assessment_public_id: assessmentPublicId!,
          files: [{ file_name: "other.txt", media_type: "text/plain", bytes: Buffer.from("Another topic's items.", "utf8") }] }));
    } catch (error) {
      rejected = error;
    }
    assert(rejected instanceof ContentServiceError && rejected.status === 422 &&
      rejected.message.startsWith("The materials have 2 complete items, but none for this mini test's topic."),
      "Items for another topic are not imported, and the message says why.");

    console.log("existing items import smoke passed");
  } finally {
    if (assessmentPublicId) {
      const assessment = await prisma.assessment.findUnique({
        where: { assessment_public_id: assessmentPublicId },
        include: { concept_units: { select: { id: true } } }
      });
      if (assessment) {
        await prisma.agentCall.deleteMany({ where: { agent_invocation_key: { startsWith: `existing_item_import:${assessmentPublicId}:` } } });
        await prisma.mcqItemImportBatch.deleteMany({ where: { assessment_db_id: assessment.id } });
        await prisma.item.deleteMany({ where: { concept_unit_db_id: { in: assessment.concept_units.map((unit) => unit.id) } } });
        await prisma.conceptUnit.deleteMany({ where: { assessment_db_id: assessment.id } });
        await prisma.assessment.delete({ where: { id: assessment.id } });
      }
    }
    await prisma.user.deleteMany({ where: { id: teacher.id } });
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
