/**
 * Release CMCQ-20261021-07, database smoke test: the assistant formats a mini-test file that the
 * lenient reading cannot import, the call is audited and replayed for the same file, and the result
 * stages a review like any file. A file with another structure is staged directly with its changes.
 * Uses a stub provider; no live calls. Needs the database.
 * Run with: npx tsx prisma/mini-test-json-format-smoke-test.ts
 */
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { hashSecret } from "../src/lib/password";
import type { LlmProvider, StructuredAgentRequest, StructuredAgentResult } from "../src/lib/llm/providers/types";
import { ContentServiceError } from "../src/lib/services/content/errors";
import { formatMiniTestJsonWithAssistant, withItemGenerationProviderForTest } from "../src/lib/services/content/item-design";
import { getMcqItemImportBatch } from "../src/lib/services/content/mcq-import";
import { stageMiniTestJsonImport } from "../src/lib/services/content/mini-test-json-import";
import { normalizeUserId } from "../src/lib/services/student-accounts/validation";

const prisma = new PrismaClient();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

class FormatProvider implements LlmProvider {
  requests: Array<StructuredAgentRequest<unknown, unknown>> = [];
  items = 2;
  async executeStructured<TInput, TOutput>(request: StructuredAgentRequest<TInput, TOutput>): Promise<StructuredAgentResult<TOutput>> {
    this.requests.push(request as StructuredAgentRequest<unknown, unknown>);
    assert(request.metadata?.purpose === "teacher_mini_test_json_format", "Only the formatting call is made.");
    const item = (number: number, key: "B" | null) => ({
      item_label: `Q${number}`,
      stem: `Question ${number}: which statement is defensible?`,
      options: [{ label: "A", text: "Raw scores establish ability." }, { label: "B", text: "Theta estimates are compared on a common scale." }, { label: "C", text: "Item difficulty never matters." }],
      key,
      target_reasoning_note: key ? "Common calibration supports comparing ability estimates." : null,
      essential_elements: key ? ["Distinguishes theta from the raw score"] : [],
      option_notes: [{ label: "A", rationale: "Treats the raw score as ability.", idea_label: "raw score as ability" }],
      objective_ids: [],
      misconception_hypothesis_ids: [],
      cognitive_demand: "evaluate",
      source_reference: null
    });
    const output = {
      schema_version: "mini-test-json-format-output-v1",
      assessment: { title: "Lecture 4: ability invariance", diagnostic_focus: null, folder_label: null },
      design: null,
      items: Array.from({ length: this.items }, (_unused, index) => item(index + 1, index === 0 ? "B" : null)),
      changes: ["Read \"q\" as the stem in every item.", "Lettered the options A to C."],
      could_not_read: [{ where: "Question 3", reason: "It has a stem but no options." }]
    };
    return {
      provider: "mock", client_request_id: request.client_request_id, provider_request_id: `mock_${request.client_request_id}`,
      provider_response_id: `mock_${request.client_request_id}_response`, status: "completed", parsed_output: output as TOutput,
      raw_output: output, usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 }, latency_ms: 1
    };
  }
}

async function main() {
  const suffix = `${Date.now()}_${randomUUID().slice(0, 8)}`;
  const userId = `json_format_teacher_${suffix}`;
  const teacher = await prisma.user.create({
    data: { user_id: userId, user_id_normalized: normalizeUserId(userId), role: "teacher_researcher", password_hash: await hashSecret(randomUUID()) }
  });
  const staged: string[] = [];
  try {
    // A file in another tool's shape: not JSON the lenient reading can import.
    const rough = `Lecture 4 quiz (${suffix})\nQ1. Which statement is defensible?\n  a) Raw scores establish ability\n  b) Theta estimates are compared on a common scale *correct*\n  c) Item difficulty never matters\nQ2. ...`;
    const provider = new FormatProvider();
    const run = () => withItemGenerationProviderForTest({ provider, provider_label: "mock" },
      () => formatMiniTestJsonWithAssistant({ teacher_user_db_id: teacher.id, source_text: rough, file_name: "lecture-4.json" }));

    const result = await run();
    assert(result.item_count === 2 && result.remaining_problems.length === 0, "Two items, and the result validates.");
    assert(result.changes[0] === "Read \"q\" as the stem in every item.", "The assistant's changes come first.");
    assert(result.could_not_read.join(" ").includes("Question 3: It has a stem but no options."), "Unreadable entries are listed.");
    const formatted = JSON.parse(result.json_text);
    assert(formatted.schema_version === "mini-test-import-v1" && formatted.items[0].key === "B" && formatted.items[1].key === null,
      "Keys appear only where the file states them.");
    const input = JSON.stringify(provider.requests[0]?.input);
    assert(input.includes("Lecture 4 quiz") && !input.includes(userId) && !input.includes(teacher.id), "The file reaches the model; account identifiers do not.");

    const calls = await prisma.agentCall.findMany({ where: { agent_invocation_key: { startsWith: "mini_test_json_format:" }, input_payload: { path: ["file_text"], string_contains: suffix } } });
    assert(calls.length === 1 && calls[0]!.call_status === "succeeded" && calls[0]!.prompt_version === "mini-test-json-format-v4", "The call is audited.");

    const replay = await run();
    assert(replay.replayed && provider.requests.length === 1 && replay.json_text === result.json_text, "The same file is not formatted twice.");

    const stagedFormatted = await stageMiniTestJsonImport({ teacher_user_db_id: teacher.id, source_text: result.json_text, source_file_name: "lecture-4.json" });
    staged.push(stagedFormatted.assessment_public_id);
    const { batch } = await getMcqItemImportBatch({ teacher_user_db_id: teacher.id, assessment_public_id: stagedFormatted.assessment_public_id, batch_public_id: stagedFormatted.batch_public_id });
    assert(batch.candidates.length === 2 && batch.candidates[0]!.imported_key === "B" && batch.candidates[1]!.imported_key === null, "The formatted file stages a review.");

    // A file with another structure that the lenient reading imports directly.
    const lenient = JSON.stringify({ title: `Lenient ${suffix}`, questions: [{ question: "Which is a person parameter?", choices: ["b", "theta"], answer: "B", difficulty: "hard" }] });
    const stagedLenient = await stageMiniTestJsonImport({ teacher_user_db_id: teacher.id, source_text: lenient, source_file_name: "lenient.json" });
    staged.push(stagedLenient.assessment_public_id);
    const lenientBatch = await getMcqItemImportBatch({ teacher_user_db_id: teacher.id, assessment_public_id: stagedLenient.assessment_public_id, batch_public_id: stagedLenient.batch_public_id });
    const candidate = lenientBatch.batch.candidates[0]!;
    assert(candidate.stem === "Which is a person parameter?" && candidate.imported_key === "B" && candidate.options[1]!.text === "theta", "Read with its changes.");
    const stored = await prisma.mcqItemImportBatch.findUniqueOrThrow({ where: { batch_public_id: stagedLenient.batch_public_id } });
    const changes = (stored.validation_summary as { source_context?: { format_changes?: string[] } }).source_context?.format_changes ?? [];
    assert(changes.some((change) => change.includes("\"difficulty\"")) && changes.includes("Used \"questions\" as the items."), "The changes are kept with the review.");

    provider.items = 0;
    let rejected: unknown = null;
    try {
      await withItemGenerationProviderForTest({ provider, provider_label: "mock" },
        () => formatMiniTestJsonWithAssistant({ teacher_user_db_id: teacher.id, source_text: `Notes only ${suffix}`, file_name: null }));
    } catch (error) { rejected = error; }
    assert(rejected instanceof ContentServiceError && rejected.status === 422, "A file without items says so.");

    console.log("mini-test JSON format smoke passed");
  } finally {
    await prisma.agentCall.deleteMany({ where: { agent_invocation_key: { startsWith: "mini_test_json_format:" }, input_payload: { path: ["file_text"], string_contains: suffix } } });
    for (const assessmentPublicId of staged) {
      const assessment = await prisma.assessment.findUnique({ where: { assessment_public_id: assessmentPublicId }, include: { concept_units: { select: { id: true } } } });
      if (!assessment) continue;
      await prisma.mcqItemImportBatch.deleteMany({ where: { assessment_db_id: assessment.id } });
      await prisma.item.deleteMany({ where: { concept_unit_db_id: { in: assessment.concept_units.map((unit) => unit.id) } } });
      await prisma.conceptUnit.deleteMany({ where: { assessment_db_id: assessment.id } });
      await prisma.assessment.delete({ where: { id: assessment.id } });
    }
    await prisma.user.deleteMany({ where: { id: teacher.id } });
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
