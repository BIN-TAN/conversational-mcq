import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SafeTutorMessageMarkdown } from "../src/components/safe-tutor-message-markdown";
import { renderTeacherReadableTranscriptMarkdown } from "../src/lib/services/teacher-review/readable-transcript";

function renderTutorMessage(message: string) {
  return renderToStaticMarkup(
    <SafeTutorMessageMarkdown message={message} />
  );
}

function occurrenceCount(value: string, marker: string) {
  return value.split(marker).length - 1;
}

const supportedMarkdown = [
  "A **strong distinction** can also be *explained gently*.",
  "",
  "- First idea",
  "- Second idea",
  "",
  "1. Check the claim",
  "2. Check the evidence",
  "",
  "> Keep the conclusion tied to the evidence.",
  "",
  "Use `score consistency` as an inline term."
].join("\n");
const supportedHtml = renderTutorMessage(supportedMarkdown);

assert(supportedHtml.includes("<strong>strong distinction</strong>"));
assert(supportedHtml.includes("<em>explained gently</em>"));
assert(supportedHtml.includes("<ul"));
assert(supportedHtml.includes("<ol"));
assert(supportedHtml.includes("<blockquote"));
assert(supportedHtml.includes("<code"));

const unsupportedMarkdown = [
  "# Unsupported heading",
  "",
  "<script>window.studentData = 'leaked'</script>",
  "",
  "![remote image](https://example.invalid/student.png)",
  "",
  "[unsafe link](javascript:alert('unsafe'))",
  "",
  "| Column A | Column B |",
  "| --- | --- |",
  "| value | value |",
  "",
  "```js",
  "window.hiddenPrompt = true;",
  "```"
].join("\n");
const sanitizedHtml = renderTutorMessage(unsupportedMarkdown);

for (const prohibitedRenderedConstruct of [
  "<script",
  "<img",
  "<a ",
  "<h1",
  "<table",
  "<pre",
  "javascript:",
  "https://example.invalid"
]) {
  assert.equal(
    sanitizedHtml.includes(prohibitedRenderedConstruct),
    false,
    `Tutor Markdown must not render ${prohibitedRenderedConstruct}.`
  );
}
assert(
  sanitizedHtml.includes("unsafe link"),
  "A disallowed link should retain its student-readable label without becoming clickable."
);

const plainText = "Plain tutor text stays exactly readable.";
const plainHtml = renderTutorMessage(plainText);
assert(plainHtml.includes(plainText));
for (const unexpectedFormattingTag of [
  "<strong",
  "<em",
  "<ul",
  "<ol",
  "<blockquote",
  "<code"
]) {
  assert.equal(plainHtml.includes(unexpectedFormattingTag), false);
}

const exportedMessage =
  "**Consistency** is not the same as *validity*; use `evidence` carefully.";
const readableTranscriptExport = renderTeacherReadableTranscriptMarkdown({
  session_public_id: "sess_markdown_smoke",
  student_display_label: "Student",
  assessment_label: "Assessment",
  turns: [
    {
      turn_index: 1,
      speaker: "agent",
      timestamp: "2026-07-28T00:00:00.000Z",
      phase_label: "Formative conversation",
      safe_context_label: null,
      message_text: exportedMessage,
      has_structured_payload_available_elsewhere: false,
      next_student_response_latency_ms: null,
      next_student_response_latency_seconds: null,
      next_student_response_latency_source: null
    }
  ],
  limitations: []
});
assert(
  readableTranscriptExport.includes(exportedMessage),
  "Readable transcript export must retain the original Markdown source text."
);

const studentUiSource = readFileSync(
  "src/components/student-assessment/assessment-session-client.tsx",
  "utf8"
);
assert(
  studentUiSource.includes(
    "<SafeTutorMessageMarkdown message={turn.message_text} />"
  ),
  "Student formative tutor messages must use the shared safe Markdown renderer."
);

const teacherUiSource = readFileSync(
  "src/components/teacher-review/session-detail-client.tsx",
  "utf8"
);
assert(
  occurrenceCount(teacherUiSource, "<SafeTutorMessageMarkdown") >= 3,
  "Teacher formative, readable, and structured transcript views must share the safe renderer."
);

console.log(
  JSON.stringify(
    {
      status: "passed",
      smoke: "student-formative-conversation-markdown",
      assertions: [
        "supported_markdown_rendered",
        "unsupported_constructs_not_rendered",
        "plain_text_unchanged",
        "student_and_teacher_views_share_renderer",
        "readable_transcript_export_preserves_source"
      ],
      provider_calls: 0
    },
    null,
    2
  )
);
