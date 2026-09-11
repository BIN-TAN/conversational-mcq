import assert from "node:assert/strict";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { deepmerge } from "deepmerge-ts";
import { loadConfigFromFile } from "@prisma/config";
import JSZip from "jszip";
import postcss from "postcss";
import sharp from "sharp";
import * as XLSX from "xlsx";
import { safeDependencyFailure, validateAuditResult, verifyPublisherDependency } from "../scripts/dependency-security-check.mjs";
import { extractDocxForMcqImport } from "../src/lib/services/content/mcq-docx-parser";
import { readBoundedOfficeArchive } from "../src/lib/services/content/office-archive";

async function main() {
  const passed: string[] = [];
  const check = async (name: string, test: () => unknown | Promise<unknown>) => {
    await test();
    passed.push(name);
  };
  const manifest = JSON.parse(await readFile("package.json", "utf8"));
  const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
  await check("official patched SheetJS is pinned with integrity", () => verifyPublisherDependency(manifest, lock));
  await check("missing publisher integrity fails closed", () => {
    const bad = structuredClone(lock);
    delete bad.packages["node_modules/xlsx"].integrity;
    assert.throws(() => verifyPublisherDependency(manifest, bad));
  });
  const clean = {
    auditReportVersion: 2, vulnerabilities: {},
    metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 } }
  };
  await check("clean advisory report passes", () => validateAuditResult({ status: 0, stdout: JSON.stringify(clean) }));
  await check("advisories, failed audit, and incomplete reports block release", () => {
    for (const report of [{}, { error: { code: "service_unavailable" } }, {
      ...clean, vulnerabilities: { next: { severity: "critical" } }
    }, { ...clean, metadata: { vulnerabilities: { ...clean.metadata.vulnerabilities, high: 1, total: 1 } } }]) {
      assert.throws(() => validateAuditResult({ status: 0, stdout: JSON.stringify(report) }));
    }
    assert.throws(() => validateAuditResult({ status: 1, stdout: JSON.stringify(clean) }));
    assert.throws(() => validateAuditResult({ status: 0, stdout: "invalid json" }));
    assert.throws(() => validateAuditResult({ error: new Error("timeout"), status: null, stdout: "" }));
  });
  await check("every installed security-sensitive package meets patched floor", () => {
    const floors: Record<string, string> = {
      next: "15.5.24", sharp: "0.35.4", postcss: "8.5.23", "csv-parse": "7.0.2",
      "fast-xml-parser": "5.10.1", "@xmldom/xmldom": "0.8.15", "deepmerge-ts": "8.0.0",
      "js-yaml": "4.3.2", browserslist: "4.28.7", "baseline-browser-mapping": "2.11.0", nanoid: "3.3.18"
    };
    for (const [location, entry] of Object.entries(lock.packages) as Array<[string, { version: string }]>) {
      const name = location.split("node_modules/").at(-1)!;
      const floor = name === "brace-expansion" ? (entry.version.startsWith("1.") ? "1.1.18" : "5.0.9") : floors[name];
      if (!floor) continue;
      const actual = entry.version.split(".").map(Number);
      const minimum = floor.split(".").map(Number);
      assert.equal(actual.length, 3);
      assert(actual.every(Number.isSafeInteger), `${name}: no unreviewed prereleases`);
      const delta = actual.map((value, i) => value - minimum[i]).find((value) => value !== 0) ?? 0;
      assert(delta >= 0, `${location} below patched floor`);
    }
  });
  await check("audit errors never echo raw service responses or configuration", () => {
    for (const error of [new SyntaxError('Unexpected token: synthetic-private-value'), new Error('https://user:synthetic-password@registry.invalid'), null]) {
      assert.equal(safeDependencyFailure(error), "dependency_security_verification_failed");
    }
    assert.equal(safeDependencyFailure(new Error("dependency_audit_high_findings")), "dependency_audit_high_findings");
  });
  await check("CSV prototype-like headers do not alter row prototypes", () => {
    const rows = parse('__proto__,constructor,stem\n"malicious","untrusted","line one\nline two"', { columns: true }) as Array<Record<string, string>>;
    assert.equal(Object.getPrototypeOf(rows[0]), Object.prototype);
    assert.equal(rows[0].stem, "line one\nline two");
    assert.equal(({} as Record<string, unknown>).malicious, undefined);
    const grouped = parse('__proto__,__proto__,stem\nx,y,measurement', { columns: true, group_columns_by_name: true }) as Array<Record<string, unknown>>;
    assert.equal(Object.getPrototypeOf(grouped[0]), Object.prototype);
    assert.deepEqual(Object.getOwnPropertyDescriptor(grouped[0], "__proto__")?.value, ["x", "y"]);
  });
  await check("patched Excel reader preserves Unicode, keys and literal formulas", () => {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet([{ stem: "Measurement \u03b8", key: "F", reasoning: "=1+1" }]), "Items");
    const copy = XLSX.read(XLSX.write(book, { type: "buffer", bookType: "xlsx" }), { type: "buffer", cellFormula: false });
    assert.deepEqual(XLSX.utils.sheet_to_json(copy.Sheets.Items), [{ stem: "Measurement \u03b8", key: "F", reasoning: "=1+1" }]);
  });
  const archive = async (files: Record<string, string | Buffer>, compressed = false) => {
    const zip = new JSZip();
    for (const [name, data] of Object.entries(files)) zip.file(name, data);
    return zip.generateAsync({ type: "nodebuffer", compression: compressed ? "DEFLATE" : "STORE" });
  };
  const docx = {
    "[Content_Types].xml": '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    "word/document.xml": '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Reliability &amp; validity</w:t></w:r></w:p></w:body></w:document>'
  };
  await check("Word extraction retains normal entity-decoded educational text", async () => {
    const extracted = await extractDocxForMcqImport({ bytes: await archive(docx), sourceFileName: "course.docx" });
    assert.match(extracted.raw_text, /Reliability & validity/);
    assert.equal(extracted.blocks[0]?.kind, "paragraph");
  });
  await check("ZIP traversal paths are rejected before JSZip normalization hides them", async () => {
    await assert.rejects(readBoundedOfficeArchive(await archive({ "../secret.xml": "hidden" })), /cannot be imported safely/);
  });
  await check("macro packages are rejected", async () => {
    await assert.rejects(readBoundedOfficeArchive(await archive({ ...docx, "word/vbaProject.bin": "macro" })), /Macro-enabled/);
  });
  await check("XML DTD and entity declarations never reach document parsers", async () => {
    for (const declaration of ['<!DOCTYPE x [<!ENTITY y "expanded">]>', '<!ENTITY y "expanded">']) {
      await assert.rejects(extractDocxForMcqImport({ bytes: await archive({ ...docx, "word/styles.xml": declaration }), sourceFileName: "course.docx" }));
    }
  });
  await check("compressed expansion and too many archive members are bounded", async () => {
    await assert.rejects(readBoundedOfficeArchive(await archive({ "large.bin": "x".repeat(1_000_000) }, true)));
    await assert.rejects(readBoundedOfficeArchive(await archive(Object.fromEntries(Array.from({ length: 1001 }, (_, i) => [`${i}.bin`, "x"])))));
  });
  await check("forged ZIP size cannot bypass actual-byte limits", async () => {
    const bytes = await archive({ "large.bin": "x".repeat(1_000_000) }, true);
    const central = bytes.indexOf(Buffer.from([0x50, 0x4b, 1, 2]));
    assert(central > 0);
    bytes.writeUInt32LE(1, central + 24);
    bytes.writeUInt32LE(1, 22);
    await assert.rejects(readBoundedOfficeArchive(bytes));
  });
  await check("patched image library produces valid PNG and WebP", async () => {
    const input = { create: { width: 12, height: 8, channels: 3 as const, background: "#007c41" } };
    for (const format of ["png", "webp"] as const) {
      const bytes = await sharp(input).toFormat(format).toBuffer();
      const metadata = await sharp(bytes).metadata();
      assert.equal(metadata.width, 12);
      assert.equal(metadata.height, 8);
    }
  });
  await check("PostCSS preserves normal CSS and source maps", async () => {
    const result = await postcss([]).process(".item { color: green; }", { from: "input.css", to: "output.css", map: { inline: false } });
    assert.match(result.css, /color: green/);
    assert(result.map);
  });
  await check("Prisma config dependency handles cycles and existing plain config", async () => {
    const cycle: { label: string; self?: unknown } = { label: "synthetic" };
    cycle.self = cycle;
    assert.doesNotThrow(() => deepmerge(cycle, cycle));
    const dir = await mkdtemp(path.join(tmpdir(), "cmcq-prisma-config-security-"));
    try {
      await writeFile(path.join(dir, "prisma.config.mjs"), 'export default { schema: "schema.prisma" };\n');
      const config = await loadConfigFromFile({ configRoot: dir });
      assert.equal(config.error, undefined);
      assert.equal(config.config?.schema, path.join(await realpath(dir), "schema.prisma"));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  console.log(JSON.stringify({ status: "passed", count: passed.length, checks: passed, provider_calls: 0, model_auth_requests: 0, dispatch_checkpoints: 0 }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
