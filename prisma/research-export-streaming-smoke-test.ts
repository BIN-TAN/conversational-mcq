import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, symlink, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import JSZip from "jszip";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import { cleanupStaleResearchSpools, ResearchExportSpool, withResearchExportSlot } from "../src/lib/services/teacher-research-data/export-spool";
import { researchCoverageFiles } from "../src/lib/services/teacher-research-data/coverage-report";

async function main() {
  const root = await mkdtemp(path.join(tmpdir(), "cmcq-export-streaming-test-"));
  const spool = await ResearchExportSpool.create(root);
  try {
    const columns = ["actor_type", "message_text", "duration_ms", "accepted"];
    const rows = [
      { actor_type: "student", message_text: 'First line\n"Second line", third', duration_ms: 0, accepted: false },
      { actor_type: "agent", message_text: "A brief explanation.", duration_ms: null, accepted: true },
      { actor_type: "student", message_text: "", duration_ms: 27, accepted: true }
    ];
    const file = (values: typeof rows) => ({ path: "conversation_turns.csv", data: stringify(values, { header: true, columns }) });
    await spool.append(file([]));
    for (const row of rows) await spool.append(file([row]));
    await spool.append({ path: "example_dictionary.csv", data: "variable,definition\nvalue,Meaning\n" });
    await spool.append({ path: "example_dictionary.csv", data: "variable,definition\nvalue,Meaning\n" });
    await assert.rejects(spool.append({ path: "conversation_turns.csv", data: "wrong,columns\n1,2\n" }), /incompatible/);
    await assert.rejects(spool.append({ path: "../escape.csv", data: "x\n1\n" }), /invalid/);
    await spool.finishCoverage();
    const metadata = spool.manifestEntries();
    await spool.append({ path: "research_manifest.json", data: JSON.stringify({ entries: metadata }) });
    const destination = path.join(root, "result.zip");
    await assert.rejects(stat(destination));
    await spool.publishZip(destination);
    const zip = await JSZip.loadAsync(await readFile(destination), { checkCRC32: true });
    assert.equal(await zip.file("conversation_turns.csv")!.async("string"), file(rows).data);
    assert.equal(spool.rowCounts()["conversation_turns.csv"], 3);
    assert.equal(spool.rowCounts()["example_dictionary.csv"], 1);
    for (const entry of metadata) {
      const data = await zip.file(entry.path)!.async("nodebuffer");
      assert.equal(entry.bytes, data.length);
      assert.equal(entry.sha256, createHash("sha256").update(data).digest("hex"));
    }
    const normalized = (csv: string) => (parse(csv, { columns: true }) as object[]).map(row => JSON.stringify(row)).sort();
    assert.deepEqual(normalized(await zip.file("data_coverage.csv")!.async("string")),
      normalized(researchCoverageFiles([file(rows)])[0].data));
    await assert.rejects(withResearchExportSlot(async () => withResearchExportSlot(async () => true)),
      (error: unknown) => (error as { code: string }).code === "research_export_busy");
    assert.equal(await withResearchExportSlot(async () => "released"), "released");
    const oldDate = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const abandoned = path.join(root, ".research-export-abandoned");
    const recent = path.join(root, ".research-export-recent");
    const unrelated = path.join(root, "preserve-this-directory");
    for (const directory of [abandoned, recent, unrelated]) await mkdir(directory);
    for (const directory of [abandoned, unrelated, spool.directory]) await utimes(directory, oldDate, oldDate);
    const linked = path.join(root, ".research-export-linked");
    await symlink(unrelated, linked);
    await cleanupStaleResearchSpools(root);
    await assert.rejects(stat(abandoned), { code: "ENOENT" });
    for (const directory of [recent, unrelated, linked, spool.directory]) assert((await stat(directory)).isDirectory());
    const failed = await ResearchExportSpool.create(root);
    try {
      await failed.append({ path: "values.csv", data: "value\n1\n" });
      await assert.rejects(failed.publishZip(path.join(root, "missing-parent", "result.zip")));
    } finally { await failed.dispose(); }
    await assert.rejects(stat(failed.directory), { code: "ENOENT" });
    console.log("PASS streaming ZIP, multiline CSV, exact row counts, SHA-256, CRC, coverage equivalence, single-export admission, failure cleanup");

    if (process.argv.includes("--stress")) {
      const baseline = process.memoryUsage().rss;
      let peak = baseline;
      const sampler = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss); }, 20);
      const stress = await ResearchExportSpool.create(root);
      const start = Date.now();
      try {
        const content = stringify(Array.from({ length: 512 }, (_, index) => ({
          actor_type: "student", message_text: `Synthetic row ${index}: ${"sample text ".repeat(100)}\nA second line.`
        })), { header: true, columns: ["actor_type", "message_text"] });
        for (let batch = 0; batch < 128; batch++) await stress.append({ path: "stress_events.csv", data: content });
        await stress.finishCoverage();
        const entry = stress.manifestEntries().find(file => file.path === "stress_events.csv")!;
        assert.equal(entry.rows, 128 * 512);
        assert(entry.bytes > 64 * 1024 * 1024, "Stress data should exceed 64 MiB, without holding it in memory.");
        const target = path.join(root, "stress.zip");
        await stress.publishZip(target);
        const compressed = await readFile(target);
        const archive = await JSZip.loadAsync(compressed);
        const hash = createHash("sha256");
        let bytes = 0;
        await pipeline(archive.file("stress_events.csv")!.nodeStream(), new Writable({
          write(chunk: Buffer, _encoding, callback) {
            hash.update(chunk);
            bytes += chunk.length;
            callback();
          }
        }));
        assert.equal(bytes, entry.bytes);
        assert.equal(hash.digest("hex"), entry.sha256);
        peak = Math.max(peak, process.memoryUsage().rss);
        console.log(JSON.stringify({ stress: "passed", rows: entry.rows, uncompressed_bytes: bytes,
          zip_bytes: compressed.length, baseline_rss_bytes: baseline, observed_peak_rss_bytes: peak,
          rss_increase_bytes: peak - baseline, duration_ms: Date.now() - start }));
      } finally { clearInterval(sampler); await stress.dispose(); }
    }
  } finally { await spool.dispose(); await rm(root, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
