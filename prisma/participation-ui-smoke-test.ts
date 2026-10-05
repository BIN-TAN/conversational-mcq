import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createServer } from "node:http";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "tailwindcss";
import { chromium } from "playwright";
import config from "../tailwind.config";
import { buildProcessDataSummary } from "../src/lib/services/teacher-review/process-data-summary";

async function main() {
  const at = (s: number) => new Date(Date.UTC(2026, 0, 1, 12, 0, s));
  const observation = { conversation_public_id: "conversation-demo", concept_unit_public_id: "topic-demo", started_at: at(50),
    conversation_turns: [{ actor_type: "agent", sequence_index: 155, created_at: at(60) }], lifecycle_events: [] };
  const data = buildProcessDataSummary({ started_at: at(0), completed_at: null, last_activity_at: at(80),
    items: [{ item_public_id: "item-demo", item_order: 13, topic_title: "Reliability and score interpretation", revision_count: 1 }],
    events: [
      { event_type: "item_presented", occurred_at: at(0), item_public_id: "item-demo", payload: { item_position: 1 } },
      { event_type: "formative_feedback_shown", occurred_at: at(72), payload: { display_event_contract_version: "display-ack-v2",
        conversation_public_id: "conversation-demo", source_turn_sequence_index: 155, server_received_at: at(72).toISOString() } },
      { event_type: "attempt_paused", occurred_at: at(80), payload: { preserved_phase: "planning_completed", reason: "student_requested_pause" } },
      { event_type: "attempt_resumed", occurred_at: at(120) },
      { event_type: "attempt_paused", occurred_at: at(160), payload: { preserved_phase: "planning_completed" } }
    ],
    conversations: [{ topic_title: "Reliability and score interpretation", student_turn_count: 0, input_telemetry: [], lifecycle_events: [], observation }]
  });
  const directory = path.resolve(".data/participation-ui-check");
  await mkdir(directory, { recursive: true });
  const bundle = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
    import {ProcessDataSection} from './src/components/teacher-review/process-data-section';
    createRoot(document.getElementById('root')).render(<ProcessDataSection data={${JSON.stringify(data)}} sessionPublicId="synthetic-review"/>);`,
    resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' } });
  const css = await postcss([tailwind(config)]).process(await readFile("src/app/globals.css", "utf8"), { from: "src/app/globals.css" });
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Process data: synthetic review</title>
    <style>${css.css}main{max-width:1200px;margin:32px auto;padding:0 20px;font-family:Arial,sans-serif}</style>
    <main><div id="root"></div></main><script>${bundle.outputFiles[0].text.replaceAll("</script", "<\\/script")}</script></html>`;
  await writeFile(path.join(directory, "preview.html"), html);
  const server = createServer((_req, res) => { res.setHeader("Content-Type", "text/html"); res.end(html); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    for (const viewport of [{ width: 1440, height: 1100 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      await page.goto(`http://127.0.0.1:${address.port}`);
      await page.getByRole("heading", { name: "Pauses and returns" }).waitFor();
      assert.equal(await page.getByText("No resume recorded yet", { exact: true }).count(), 1);
      assert(await page.getByText("Item 1", { exact: true }).first().isVisible());
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "No document-level horizontal overflow");
      const downloadPromise = page.waitForEvent("download");
      await page.getByRole("button", { name: "Download process data", exact: true }).click();
      const download = await downloadPromise;
      const content = JSON.parse(await readFile((await download.path())!, "utf8"));
      assert.equal(content.pause_episodes.length, 2);
      assert.equal(content.pause_episodes[0].pause_duration_ms, 40000);
      assert.equal(content.pause_episodes[1].display_receipt_to_pause_ms, null);
      assert.equal(content.conversations[0].assessment_pause_count, 2);
      assert.equal(content.conversations[0].assessment_resume_count, 1);
      assert.equal(content.conversations[0].pause_count, 0);
      assert(await page.getByText("Assessment: 2 / 1", { exact: true }).isVisible());
      assert(await page.getByText("Display recorded on an earlier visit", { exact: true }).isVisible());
      await page.getByRole("combobox").selectOption("Feedback display");
      assert.equal(await page.locator("ol > li").count(), 1);
      await page.getByRole("combobox").selectOption("key_activity");
      await page.screenshot({ path: path.join(directory, `${viewport.width}.png`), fullPage: true });
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ status: "passed", viewports: [1440, 390], checks: ["render", "no_overflow", "filter", "downloaded_data", "no_browser_errors"], preview: path.join(directory, "preview.html") }));
  } finally {
    await browser?.close();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
