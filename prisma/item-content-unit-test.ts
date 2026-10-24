/**
 * Rich item content (release CMCQ-20261024-11): formulas, tables, images and videos in every
 * part of an item a student or instructor sees.
 * - Plain text is shown exactly as before; only text with formulas ($...$, $$...$$, \( \),
 *   \[ \]), Markdown pipe tables, bold text or https links goes through the Markdown renderer.
 * - Prices such as "$5 and $10" stay text; the renderer allows no raw HTML, scripts or
 *   non-https links; KaTeX runs without trusted commands.
 * - Videos: YouTube (youtube-nocookie.com) and Vimeo (player.vimeo.com) embeds in a sandboxed
 *   frame, direct https .mp4/.webm/.ogg files in a native player, anything else a link; never
 *   inside an answer button (links not interactive there).
 * - Media placement explanation (answer review only); item_stem and option read as before.
 * - Word tables become Markdown pipe tables in imported text.
 * No database or provider calls. Run with: npx tsx prisma/item-content-unit-test.ts
 * When react-dom/server and the Markdown packages are installed (after npm install), the
 * renderer itself is also checked.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { ItemMediaAsset } from "@prisma/client";
import {
  ITEM_CONTENT_AUTHORING_HINT,
  findMathSpans,
  hasMarkdownTable,
  hasRichItemContent,
  prepareItemContentMarkdown,
  safeItemContentUrl
} from "../src/lib/item-content/rich-text";
import {
  VIDEO_EMBED_ALLOW,
  VIDEO_EMBED_REFERRER_POLICY,
  VIDEO_EMBED_SANDBOX,
  videoPresentationForUrl
} from "../src/lib/item-content/video-embed";
import {
  ANSWERING_MEDIA_PLACEMENTS,
  ITEM_MEDIA_PLACEMENTS,
  isAnsweringMediaPlacement,
  parseItemMediaPlacement
} from "../src/lib/item-content/media-placement";
import {
  docxTableLinearText,
  htmlToTextWithMarkdownTables,
  joinStemLines,
  rowsToMarkdownTable
} from "../src/lib/item-content/docx-tables";
import { ItemMediaAssetInputSchema } from "../src/lib/services/content/item-media";
import { MiniTestJsonSchema } from "../src/lib/services/content/mini-test-json-contract";
import { serializeStudentSafeItem, studentSafeExplanationMedia } from "../src/lib/services/student-assessment/serializers";
import { PackageResultsSchema, StudentSafeMediaAssetSchema } from "../src/lib/student-assessment-ui/types";

let passed = 0;
let skipped = 0;
async function check(name: string, run: () => void | Promise<void | "skipped">) {
  const result = await run();
  if (result === "skipped") {
    skipped += 1;
    console.log(`skip - ${name}`);
    return;
  }
  passed += 1;
  console.log(`ok - ${name}`);
}
const source = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

const PLAIN_TEXTS = [
  "Which statement about reliability is correct?",
  "A test costs $5 and a retest $10.",
  "The fee rose from $5-$10 last year.",
  "Scores: 5 | 7 | 9 were recorded.",
  "Use x_1 and x_2, then 2 * 3 * 4.",
  "Line one\nLine two\n\n  indented line",
  "1. First step\n- a dash line\n# not a heading for plain text",
  "<b>not bold</b> and <script>alert(1)</script>",
  "A single $ sign, a backslash \\ and *one star*.",
  "Read [the notes](http://example.com) first."
];

function mediaAsset(overrides: Partial<ItemMediaAsset>): ItemMediaAsset {
  return {
    id: "00000000-0000-0000-0000-000000000000",
    media_public_id: "media_1",
    item_db_id: "00000000-0000-0000-0000-000000000001",
    option_label: null,
    placement: "item_stem",
    media_type: "image",
    source_type: "external_url",
    storage_key: null,
    public_or_signed_url: null,
    external_url: "https://example.org/figure.png",
    title: "Figure",
    alt_text_or_description: "A beam with a point load",
    student_alt_text: null,
    teacher_llm_media_description: null,
    caption: null,
    transcript_or_content_summary: null,
    source_attribution: null,
    media_context_hash: "hash",
    order_index: 0,
    active: true,
    media_version: 1,
    supersedes_media_public_id: null,
    created_at: new Date("2026-10-24T00:00:00Z"),
    updated_at: new Date("2026-10-24T00:00:00Z"),
    ...overrides
  } as ItemMediaAsset;
}

async function main() {
  await check("1. Plain text is not rich: it renders exactly as before", () => {
    for (const text of PLAIN_TEXTS) {
      assert.equal(hasRichItemContent(text), false, `plain: ${JSON.stringify(text)}`);
    }
    assert.equal(hasRichItemContent(null), false);
    assert.equal(hasRichItemContent(""), false);
  });

  await check("2. Formulas, tables, bold text and https links are rich", () => {
    for (const text of [
      "Find $x^2$ when $x = 3$.",
      "The stiffness matrix is\n$$K = \\begin{bmatrix} k & -k \\\\ -k & k \\end{bmatrix}$$",
      "Use \\(F = ma\\).",
      "\\[\\sigma = \\frac{F}{A}\\]",
      "| Member | Force (kN) |\n| --- | ---: |\n| AB | 12 |",
      "This is **important**.",
      "See [the notes](https://example.org/notes)."
    ]) {
      assert.equal(hasRichItemContent(text), true, `rich: ${JSON.stringify(text)}`);
    }
  });

  await check("3. Pandoc dollar rules: prices stay text, formulas are found", () => {
    assert.deepEqual(findMathSpans("It costs $5 and $10."), []);
    assert.deepEqual(findMathSpans("$5-$10"), []);
    assert.deepEqual(findMathSpans("a $ b $ c"), []);
    assert.deepEqual(findMathSpans("Escaped \\$x\\$ stays text"), []);
    assert.deepEqual(findMathSpans("`$x$` is code"), []);
    assert.deepEqual(findMathSpans("$x^2$ and $y$").map((span) => span.tex), ["x^2", "y"]);
    assert.deepEqual(findMathSpans("$$a$$").map((span) => span.display), [true]);
    assert.deepEqual(findMathSpans("\\(a\\) \\[b\\]").map((span) => [span.tex, span.display]), [["a", false], ["b", true]]);
    assert.deepEqual(findMathSpans("$a\n\nb$"), [], "a formula never spans an empty line");
  });

  await check("4. Display-time preparation escapes stray dollars and never changes formulas", () => {
    assert.equal(prepareItemContentMarkdown("Costs $5 and $x$."), "Costs \\$5 and $x$.");
    assert.equal(prepareItemContentMarkdown("Use \\(F = ma\\) here."), "Use $F = ma$ here.");
    assert.equal(prepareItemContentMarkdown("Inline \\[a\\] display."), "Inline $\\displaystyle a$ display.");
    assert.equal(prepareItemContentMarkdown("Given\n$$K = k$$\nFind u."), "Given\n\n\n$$\nK = k\n$$\n\n\nFind u.");
    assert.equal(
      prepareItemContentMarkdown("Data:\n| a | b |\n| --- | --- |\n| 1 | $x$ |\nAfter."),
      "Data:\n\n| a | b |\n| --- | --- |\n| 1 | $x$ |\n\nAfter.",
      "a table gets empty lines around it"
    );
    assert.equal(prepareItemContentMarkdown("| a | b |\n| --- | --- |", { tables: false }), "| a | b |\n| --- | --- |");
    assert.equal(hasMarkdownTable("a | b\n--- | ---"), true);
    assert.equal(hasMarkdownTable("a | b\nc | d"), false);
  });

  await check("5. Only https links open; anything else is shown as text", () => {
    assert.equal(safeItemContentUrl("https://example.org/a?b=1"), "https://example.org/a?b=1");
    for (const unsafe of ["javascript:alert(1)", "http://example.org", "data:text/html,x", "//example.org", "https://user:pw@example.org", "", null]) {
      assert.equal(safeItemContentUrl(unsafe), null, String(unsafe));
    }
  });

  await check("6. Video URLs: privacy-enhanced embeds, native files, everything else a link", () => {
    const id = "dQw4w9WgXcQ";
    for (const url of [
      `https://www.youtube.com/watch?v=${id}`,
      `https://youtube.com/watch?v=${id}&list=x`,
      `https://m.youtube.com/watch?v=${id}`,
      `https://youtu.be/${id}`,
      `https://www.youtube.com/shorts/${id}`
    ]) {
      assert.deepEqual(videoPresentationForUrl(url), { kind: "youtube", video_id: id, embed_url: `https://www.youtube-nocookie.com/embed/${id}` }, url);
    }
    assert.equal((videoPresentationForUrl(`https://youtu.be/${id}?t=1m30s`) as { embed_url: string }).embed_url, `https://www.youtube-nocookie.com/embed/${id}?start=90`);
    assert.deepEqual(videoPresentationForUrl("https://vimeo.com/76979871"), { kind: "vimeo", video_id: "76979871", embed_url: "https://player.vimeo.com/video/76979871" });
    assert.equal((videoPresentationForUrl("https://vimeo.com/76979871/0a1b2c3d4e") as { embed_url: string }).embed_url, "https://player.vimeo.com/video/76979871?h=0a1b2c3d4e");
    assert.deepEqual(videoPresentationForUrl("https://cdn.example.org/clips/truss.MP4"), { kind: "file", file_url: "https://cdn.example.org/clips/truss.MP4", mime_type: "video/mp4" });
    assert.equal(videoPresentationForUrl("https://cdn.example.org/clips/truss.webm").kind, "file");
    assert.equal(videoPresentationForUrl("https://cdn.example.org/clips/truss.ogg").kind, "file");
    for (const url of [
      `http://youtu.be/${id}`,
      `http://cdn.example.org/clip.mp4`,
      `https://youtube.com.evil.example/watch?v=${id}`,
      `https://evil.example/youtu.be/${id}`,
      `https://notyoutube.com/watch?v=${id}`,
      `https://user:pw@youtu.be/${id}`,
      `https://youtu.be:8443/${id}`,
      "https://www.youtube.com/watch?v=short",
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ%22onload",
      "https://www.youtube.com/channel/abc",
      "https://vimeo.com/channels/staffpicks",
      "https://vimeo.com/abc",
      "javascript:alert(1)",
      "https://cdn.example.org/clip.mov",
      "https://example.org/watch"
    ]) {
      assert.deepEqual(videoPresentationForUrl(url), { kind: "link" }, url);
    }
    assert.equal(VIDEO_EMBED_SANDBOX, "allow-scripts allow-same-origin allow-presentation");
    assert.equal(VIDEO_EMBED_ALLOW, "encrypted-media; picture-in-picture");
    assert.equal(VIDEO_EMBED_REFERRER_POLICY, "strict-origin-when-cross-origin");
  });

  await check("7. Media placements: explanation added, stored item_stem and option still parse", () => {
    assert.deepEqual([...ITEM_MEDIA_PLACEMENTS], ["item_stem", "option", "explanation"]);
    assert.deepEqual([...ANSWERING_MEDIA_PLACEMENTS], ["item_stem", "option"]);
    assert.equal(parseItemMediaPlacement("item_stem"), "item_stem");
    assert.equal(parseItemMediaPlacement("option"), "option");
    assert.equal(parseItemMediaPlacement("explanation"), "explanation");
    assert.equal(parseItemMediaPlacement("stem"), null);
    assert.equal(isAnsweringMediaPlacement("explanation"), false);
    const base = { media_type: "image", source_type: "external_url", external_url: "https://example.org/a.png", alt_text_or_description: "Free-body diagram" };
    assert.equal(ItemMediaAssetInputSchema.safeParse(base).data?.placement, "item_stem", "old default");
    assert(ItemMediaAssetInputSchema.safeParse({ ...base, placement: "option", option_label: "B" }).success);
    assert(ItemMediaAssetInputSchema.safeParse({ ...base, placement: "explanation" }).success);
    assert(!ItemMediaAssetInputSchema.safeParse({ ...base, placement: "explanation", option_label: "B" }).success);
    assert(!ItemMediaAssetInputSchema.safeParse({ ...base, placement: "answer" }).success);
    const schema = source("prisma/schema.prisma").replace(/\r\n/g, "\n");
    assert.match(schema, /enum ItemMediaPlacement \{\n  item_stem\n  option\n  explanation\n\}/);
    const migrations = readdirSync(path.join(process.cwd(), "prisma/migrations")).filter((name) => name.includes("item_media_explanation_placement"));
    assert.equal(migrations.length, 1);
    assert.match(source(`prisma/migrations/${migrations[0]}/migration.sql`), /ALTER TYPE "ItemMediaPlacement" ADD VALUE IF NOT EXISTS 'explanation';/);
    assert(StudentSafeMediaAssetSchema.safeParse({ media_public_id: "m", placement: "explanation", option_label: null, media_type: "video", url: null, title: null, alt_text_or_description: "x", caption: null, transcript_or_content_summary: null, source_attribution: null }).success);
  });

  await check("8. JSON import accepts explanation media and formulas; old files still read", () => {
    const document = (media: Record<string, unknown>[]) => ({
      schema_version: "mini-test-import-v1",
      assessment: { title: "ENGG 130 statics" },
      items: [{
        stem: "A beam carries $P = 10\\,\\text{kN}$ at midspan.\n\n| Support | Reaction |\n| --- | --- |\n| A | ? |",
        options: [{ label: "A", text: "$5\\,\\text{kN}$" }, { label: "B", text: "$10\\,\\text{kN}$" }],
        key: "A",
        target_reasoning_note: "By symmetry $R_A = R_B = P/2$.",
        media_assets: media
      }]
    });
    const media = { media_type: "video", source_type: "external_url", external_url: "https://youtu.be/dQw4w9WgXcQ", alt_text_or_description: "Worked solution", transcript_or_content_summary: "Summing moments about A." };
    const parsed = MiniTestJsonSchema.parse(document([{ ...media, placement: "explanation" }]));
    assert.equal(parsed.items[0]!.media_assets[0]!.placement, "explanation");
    assert.equal(parsed.items[0]!.stem.includes("| Support | Reaction |"), true, "stored as written");
    assert.equal(MiniTestJsonSchema.parse(document([media])).items[0]!.media_assets[0]!.placement, "item_stem");
    assert(!MiniTestJsonSchema.safeParse(document([{ ...media, placement: "explanation", option_label: "A" }])).success);
  });

  await check("9. Students never receive explanation media while answering; the answer review does", () => {
    const item = {
      item_public_id: "item_1",
      item_order: 1,
      item_stem: "Stem",
      options: [{ label: "A", text: "One" }, { label: "B", text: "Two" }],
      version: 1,
      media_assets: [
        mediaAsset({ media_public_id: "stem_media" }),
        mediaAsset({ media_public_id: "option_media", placement: "option", option_label: "B" }),
        mediaAsset({ media_public_id: "explanation_media", placement: "explanation" as ItemMediaAsset["placement"], media_type: "video", external_url: "https://youtu.be/dQw4w9WgXcQ" }),
        mediaAsset({ media_public_id: "inactive_explanation", placement: "explanation" as ItemMediaAsset["placement"], active: false })
      ]
    };
    const safe = serializeStudentSafeItem(item);
    assert.deepEqual(safe.media_assets.map((asset) => asset.media_public_id), ["stem_media", "option_media"]);
    assert.deepEqual(studentSafeExplanationMedia(item).map((asset) => asset.media_public_id), ["explanation_media"]);
    const results = PackageResultsSchema.parse({
      result_summary: "You got 1 of 1 question right.", answer_reveal_policy: "x", result_status_reveal_policy: "x", full_answer_revealed: true,
      items: [{ item_public_id: "item_1", item_position: 1, selected_option: "A", status_label: "Correct", confidence: "high", answer_revealed: true,
        revealed_answer: "A", student_answer: "A", answer_explanation_revealed: true, answer_explanation: "Why", distractor_boundary: null,
        explanation_media: studentSafeExplanationMedia(item) }]
    });
    assert.equal(results.items[0]!.explanation_media?.length, 1);
    const service = source("src/lib/services/student-assessment/service.ts");
    const helper = service.slice(service.indexOf("function withExplanationMedia"), service.indexOf("async function getOrCreateInitialResponsePackage"));
    assert(helper.includes("if (!entry.answer_explanation_revealed || !entry.answer_explanation) return entry;"), "only with a shown explanation");
  });

  await check("10. Word tables become Markdown pipe tables; item parts keep the earlier form", () => {
    assert.equal(rowsToMarkdownTable([["Member", "Force"], ["AB", "12 kN"], ["a|b"]]), "| Member | Force |\n| --- | --- |\n| AB | 12 kN |\n| a\\|b |  |");
    assert.equal(rowsToMarkdownTable([]), "");
    assert.equal(
      htmlToTextWithMarkdownTables("<p>Given:</p><table><tr><td><p>Member</p></td><td><p>Force</p></td></tr><tr><td><p>AB</p></td><td><p>5 &amp; 6</p></td></tr></table><p>A. 5<br />kN</p><ul><li>x</li></ul>"),
      "Given:\n\n| Member | Force |\n| --- | --- |\n| AB | 5 & 6 |\n\nA. 5\nkN\n\nx\n\n"
    );
    assert.equal(docxTableLinearText([["Load", "Value"], ["P", "10 kN"]]), "\n| Load | Value |\n| --- | --- |\n| P | 10 kN |\n");
    assert.equal(docxTableLinearText([["A.", "5 kN"], ["B.", "10 kN"]]), "A. | 5 kN\nB. | 10 kN", "option rows stay readable by the item parser");
    assert.equal(joinStemLines(["A beam is loaded", "as shown."]), "A beam is loaded as shown.", "prose joined as before");
    assert.equal(
      joinStemLines(["The table gives loads:", "| Load | Value |", "| --- | --- |", "| P | 10 kN |", "Find R."]),
      "The table gives loads:\n\n| Load | Value |\n| --- | --- |\n| P | 10 kN |\n\nFind R."
    );
    const parser = source("src/lib/services/content/mcq-docx-parser.ts");
    assert(parser.includes("mammoth.convertToHtml") && parser.includes("let textWithTables = rawText;"), "no table: raw text unchanged");
    assert(source("src/lib/services/content/item-design-materials.ts").includes("extraction.text_with_tables"));
    assert(source("src/lib/services/content/mcq-import.ts").includes("const stem = joinStemLines(stemLines);"));
  });

  await check("11. Every item text a student sees uses the item renderer", () => {
    const client = source("src/components/student-assessment/assessment-session-client.tsx");
    for (const expected of [
      '<ItemContent className="mt-2 whitespace-pre-wrap text-[0.95rem] leading-7 text-ink" text={item.item_stem} />',
      '<ItemContent inline linksInteractive={false} text={option.text} />',
      '<ItemContent className="mt-2 whitespace-pre-wrap text-sm leading-6 text-ink" text={item.item_stem} />',
      '<ItemContent className="whitespace-pre-wrap text-sm leading-6 text-ink" text={item.item_stem} />',
      'text={item.answer_explanation} />',
      'text={item.distractor_boundary} />',
      '<StudentMediaList mediaAssets={item.explanation_media ?? []} />',
      '<ItemContent className="whitespace-pre-wrap text-sm leading-6" text={displayTranscriptText(entry)} />'
    ]) {
      assert(client.includes(expected), expected);
    }
    assert.equal(client.split("<ItemContent inline linksInteractive={false} text={option.text} />").length - 1, 4, "answer, tempting-option and both edit buttons");
    assert(!/<\/span> \{option\.text\}/.test(client), "no option rendered as plain text only");
    assert(!client.includes("{item.item_stem}</p>"), "no stem rendered as plain text only");
    const mediaList = client.slice(client.indexOf("function StudentMediaList"), client.indexOf("function AgentItemMessage"));
    const interactive = mediaList.slice(mediaList.indexOf("asset.url && linksInteractive ? ("), mediaList.indexOf(") : asset.url ? ("));
    assert(interactive.includes("<ItemVideoEmbed"), "embed only where links are interactive");
    assert.equal(mediaList.split("<ItemVideoEmbed").length - 1, 1);
  });

  await check("12. Instructor views and authoring use the same renderer, with the hint", () => {
    const files: Record<string, string[]> = {
      "src/components/teacher-content/item-editor-client.tsx": ["ItemContentAuthoringPreview", "<ItemContent", "Explanation (answer review)", 'media.placement === "explanation"'],
      "src/components/teacher-content/assessment-preview.tsx": ["<ItemContent", "ItemVideoEmbed", 'asset.placement === "explanation"'],
      "src/components/teacher-content/mcq-import-client.tsx": ["ItemContentAuthoringPreview", "<ItemContent"],
      "src/components/teacher-content/import-json-client.tsx": ["ITEM_CONTENT_AUTHORING_HINT", "<ItemContent"],
      "src/components/teacher-content/concept-unit-detail-client.tsx": ["<ItemContent"],
      "src/components/teacher-dashboard/item-review-panel.tsx": ["<ItemContent"],
      "src/components/teacher-dashboard/assessment-dashboard-client.tsx": ["<ItemContent"],
      "src/components/teacher-dashboard/attempt-comparison-panel.tsx": ["<ItemContent"],
      "src/components/teacher-review/session-detail-client.tsx": ["<ItemContent"]
    };
    for (const [file, needles] of Object.entries(files)) {
      const text = source(file);
      for (const needle of needles) assert(text.includes(needle), `${file}: ${needle}`);
    }
    assert.equal(ITEM_CONTENT_AUTHORING_HINT, "You can use $...$ for formulas and | tables |.");
  });

  await check("13. Renderer safety: no raw HTML, no trusted KaTeX commands, https links only", () => {
    const renderer = source("src/components/item-content.tsx");
    assert(!renderer.includes("rehype-raw") && !renderer.includes("dangerouslySetInnerHTML"));
    assert(renderer.includes("trust: false") && renderer.includes("allowedElements={ALLOWED_ITEM_CONTENT_ELEMENTS}"));
    assert(renderer.includes("urlTransform={(url: string) => safeItemContentUrl(url)}"));
    assert(renderer.includes('rel="noreferrer"') && renderer.includes('target="_blank"'));
    assert(!/"script"|"iframe"|"style"|"object"|"embed"|"form"|"input"/.test(renderer.slice(renderer.indexOf("MARKDOWN_ELEMENTS"), renderer.indexOf("ALLOWED_ITEM_CONTENT_ELEMENTS: string[]"))));
    const video = source("src/components/item-media-video.tsx");
    for (const needle of ["sandbox={VIDEO_EMBED_SANDBOX}", "allow={VIDEO_EMBED_ALLOW}", "referrerPolicy={VIDEO_EMBED_REFERRER_POLICY}", 'loading="lazy"', "title={title}", 'preload="metadata"', "controls"]) {
      assert(video.includes(needle), needle);
    }
    const tutor = source("src/components/safe-tutor-message-markdown.tsx");
    assert(tutor.includes("remarkMath") && !tutor.includes("remark-gfm"), "tutor: formulas yes, tables still rejected");
    assert(source("src/app/layout.tsx").includes('import "katex/dist/katex.min.css";'));
    const packageJson = JSON.parse(source("package.json")) as { dependencies: Record<string, string> };
    assert.deepEqual(
      ["katex", "rehype-katex", "remark-gfm", "remark-math"].map((name) => packageJson.dependencies[name]),
      ["^0.16.11", "^7.0.1", "^4.0.0", "^6.0.0"]
    );
  });

  await check("14. Rendered output (needs react-dom/server and the Markdown packages)", async () => {
    let render: ((element: unknown) => string) | null = null;
    let ItemContent: ((props: Record<string, unknown>) => unknown) | null = null;
    let createElement: ((type: unknown, props: unknown) => unknown) | null = null;
    try {
      if (!existsSync(path.join(process.cwd(), "node_modules/react-markdown")) || !existsSync(path.join(process.cwd(), "node_modules/react-dom/server.js"))) {
        return "skipped";
      }
      const server = await import("react-dom/server");
      const react = await import("react");
      const component = await import("../src/components/item-content");
      render = server.renderToStaticMarkup as unknown as (element: unknown) => string;
      ItemContent = component.ItemContent as unknown as (props: Record<string, unknown>) => unknown;
      createElement = react.createElement as unknown as (type: unknown, props: unknown) => unknown;
    } catch {
      return "skipped";
    }
    const html = (props: Record<string, unknown>) => render!(createElement!(ItemContent!, props));
    for (const text of PLAIN_TEXTS) {
      const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      assert.equal(html({ text, className: "mt-2 whitespace-pre-wrap text-sm" }), `<p class="mt-2 whitespace-pre-wrap text-sm">${escaped}</p>`);
      assert.equal(html({ text, inline: true }), escaped);
    }
    const table = html({ text: "| Member | Force |\n| --- | --- |\n| AB | $12\\,\\text{kN}$ |" });
    assert(table.includes("<table") && table.includes("item-content-table") && table.includes("katex"));
    const formula = html({ text: "Find $x^2$.\n<script>alert(1)</script>\n[bad](javascript:alert(1)) [good](https://example.org)" });
    assert(formula.includes("katex") && !formula.includes("<script") && !formula.includes("javascript:"));
    assert(formula.includes('href="https://example.org/"') && formula.includes('rel="noreferrer"'));
    assert(!html({ text: "**A** [good](https://example.org)", linksInteractive: false }).includes("<a "));
    assert(!html({ text: "$\\href{https://evil.example}{x}$" }).includes("evil.example\""), "no trusted KaTeX links");
  });

  console.log(`\n${passed} item content checks passed${skipped ? `, ${skipped} skipped (renderer packages not installed)` : ""}; no database or provider calls.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
