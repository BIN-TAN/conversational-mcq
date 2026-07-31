import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { z } from "zod";
import { SafeTutorMessageMarkdown } from "../src/components/safe-tutor-message-markdown";
import { FormativeConversationTranscriptTurnSchema } from "../src/lib/services/student-assessment/formative-conversation/agent-contract";
import { validateFormativeConversationStudentOutputFormat } from "../src/lib/services/student-assessment/formative-conversation/output-format";

const ReplaySchema = z
  .object({
    visible_turns: z.array(FormativeConversationTranscriptTurnSchema)
  })
  .passthrough();

const sourcePath =
  "config/operational-candidates/formative-conversation-host-v5-executable-v6/regressions/case8-exact-v5-output-replay.json";
const sourceText = readFileSync(sourcePath, "utf8");
const replay = ReplaySchema.parse(JSON.parse(sourceText));
const tableTurn = replay.visible_turns.find((turn) =>
  turn.message_text.includes("| Concept | Main question |")
);

assert(tableTurn, "The immutable Case 8 Markdown-table turn is required.");

const historicalHtml = renderToStaticMarkup(
  <SafeTutorMessageMarkdown message={tableTurn.message_text} />
);
assert.equal(
  historicalHtml.includes("<table"),
  false,
  "The safe renderer must not enable unsupported table elements."
);
assert(
  historicalHtml.includes("| Concept | Main question |"),
  "The immutable table degrades to visible pipe syntax in the actual renderer."
);
assert(
  validateFormativeConversationStudentOutputFormat(
    tableTurn.message_text
  ).some(
    (issue) => issue.code === "student_output_markdown_table_unsupported"
  ),
  "The output boundary must reject Markdown tables before tutor-turn persistence."
);

const supportedReplacement = [
  "**Reliability**",
  "- Main question: Are the scores sufficiently consistent?",
  "- Limit: It does not establish validity for a particular use.",
  "",
  "**Measurement error / SEM**",
  "- Main question: How much uncertainty surrounds an observed score?",
  "- Limit: It does not reveal an exact true score."
].join("\n");
assert.deepEqual(
  validateFormativeConversationStudentOutputFormat(supportedReplacement),
  []
);
const supportedHtml = renderToStaticMarkup(
  <SafeTutorMessageMarkdown message={supportedReplacement} />
);
assert(supportedHtml.includes("<strong>Reliability</strong>"));
assert(supportedHtml.includes("<ul"));

for (const unsafeMessage of [
  "<script>unsafe()</script>",
  "![image](https://example.invalid/image.png)",
  "[link](https://example.invalid)",
  "```text\nunsupported block\n```"
]) {
  assert(
    validateFormativeConversationStudentOutputFormat(unsafeMessage).length >
      0,
    "Unsupported student-visible output must fail closed."
  );
}

assert.equal(
  readFileSync(sourcePath, "utf8"),
  sourceText,
  "Rendering validation must not alter the immutable stored transcript artifact."
);

console.log(
  JSON.stringify(
    {
      status: "passed",
      provider_calls: 0,
      network_requests: 0,
      immutable_case8_renderer_result:
        "readable_content_but_confusing_literal_pipe_syntax",
      correction:
        "reject_unsupported_table_before_persistence_and_request_supported_markdown",
      stored_text_modified: false
    },
    null,
    2
  )
);
