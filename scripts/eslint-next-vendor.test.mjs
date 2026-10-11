import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import nextPlugin from "../tooling/eslint-next/dist/index.js";
import rootDirectoryUtils from "../tooling/eslint-next/dist/utils/get-root-dirs.js";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vendor = path.join(project, "tooling/eslint-next");
const baseline = JSON.parse(fs.readFileSync(path.join(vendor, "upstream-effective-config.json"), "utf8"));
const provenance = JSON.parse(fs.readFileSync(path.join(vendor, "provenance.json"), "utf8"));
const eslint = new ESLint({ cwd: project });

function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [
      key.replaceAll(project, "<PROJECT>").replaceAll("\\", "/"), normalize(child)
    ]));
  }
  return typeof value === "string" ? value.replaceAll(project, "<PROJECT>").replaceAll("\\", "/") : value;
}

function summarize(config) {
  if (!config) return null;
  return normalize({
    rules: config.rules,
    plugins: Object.keys(config.plugins).sort(),
    languageOptions: { ...config.languageOptions, parser: config.languageOptions.parser.meta },
    settings: config.settings,
    linterOptions: config.linterOptions
  });
}

test("all pre-existing effective lint rules, parsers, globals and settings are preserved", async () => {
  for (const [file, expected] of Object.entries(baseline.configs)) {
    assert.deepEqual(summarize(await eslint.calculateConfigForFile(file)), expected, file);
  }
});

test("the complete upstream plugin is retained with only the declared directory adapter change", () => {
  const allowedChanges = new Set(provenance.modifications.map((entry) => entry.path));
  for (const entry of provenance.files) {
    const bytes = fs.readFileSync(path.join(vendor, entry.path));
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    assert.equal(sha256, entry.deliveredSha256, entry.path);
    if (!allowedChanges.has(entry.path)) assert.equal(sha256, entry.upstreamSha256, entry.path);
  }
  for (const entry of provenance.adaptedConfiguration) {
    assert.equal(createHash("sha256").update(fs.readFileSync(path.join(vendor, entry.path))).digest("hex"), entry.deliveredSha256, entry.path);
  }
  assert.equal(createHash("sha256").update(fs.readFileSync(path.join(vendor, "LICENSE.md"))).digest("hex"), provenance.licenseSha256);
  assert.equal(Object.keys(nextPlugin.rules).length, 21);
  assert.deepEqual(
    Object.keys(nextPlugin.rules).map((name) => `@next/next/${name}`).sort(),
    Object.keys(baseline.configs["src/app/example.tsx"].rules).filter((name) => name.startsWith("@next/next/")).sort()
  );
  const adapter = fs.readFileSync(path.join(vendor, "dist/utils/get-root-dirs.js"), "utf8");
  assert.match(adapter, /require\("tinyglobby"\)/);
  assert.doesNotMatch(adapter, /require\("fast-glob"\)/);
});

test("Next client-component, image and inline-script checks still execute", async () => {
  const [client] = await eslint.lintText('"use client"; export default async function Example() { return <img src="/example.png" alt="Example" />; }', {
    filePath: "src/app/vendor-client-check.tsx"
  });
  for (const ruleId of ["@next/next/no-async-client-component", "@next/next/no-img-element"]) {
    assert.ok(client.messages.some((message) => message.ruleId === ruleId && message.severity === 1), ruleId);
  }
  const [script] = await eslint.lintText('import Script from "next/script"; export default function Example() { return <Script>{`console.log("example")`}</Script>; }', {
    filePath: "src/app/vendor-script-check.tsx"
  });
  assert.ok(script.messages.some((message) => message.ruleId === "@next/next/inline-script-id" && message.severity === 2));
});

test("the current project root, explicit roots and arrays retain directory semantics", () => {
  const { getRootDirs } = rootDirectoryUtils;
  assert.deepEqual(getRootDirs({ cwd: project, settings: {} }), [project]);
  assert.deepEqual(getRootDirs({ cwd: project, settings: { next: { rootDir: project } } }).map(path.normalize), [project]);
  assert.deepEqual(getRootDirs({ cwd: project, settings: { next: { rootDir: "src/app" } } }), ["src/app"]);
  assert.deepEqual(getRootDirs({ cwd: project, settings: { next: { rootDir: "." } } }), ["."]);
  assert.deepEqual(getRootDirs({ cwd: project, settings: { next: { rootDir: "package.json" } } }), []);
  assert.deepEqual(getRootDirs({ cwd: project, settings: { next: { rootDir: "missing-eslint-fixture-root" } } }), []);
  assert.deepEqual(getRootDirs({ cwd: project, settings: { next: { rootDir: ["src/app", null, "src/components"] } } }), ["src/app", "src/components"]);
});

test("root globs match directories only without recursively expanding literal directory roots", () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "cmcq-eslint-next-"));
  const { getRootDirs } = rootDirectoryUtils;
  try {
    for (const entry of ["app-one/nested", "app-two", ".hidden"]) fs.mkdirSync(path.join(fixture, entry), { recursive: true });
    fs.writeFileSync(path.join(fixture, "app-file.txt"), "synthetic fixture\n");
    const roots = (pattern) => getRootDirs({ cwd: project, settings: { next: { rootDir: pattern } } }).map(path.normalize).sort();
    assert.deepEqual(roots(fixture), [fixture]);
    const expected = [path.join(fixture, "app-one"), path.join(fixture, "app-two")].sort();
    assert.deepEqual(roots(`${fixture.replaceAll("\\", "/")}/*`), expected);
    assert.deepEqual(roots(`${fixture.replaceAll("\\", "/")}/{app-one,app-two}`), expected);
    if (process.platform === "win32") assert.deepEqual(roots(`${fixture}\\app-*`), expected);
  } finally {
    assert.equal(path.dirname(path.resolve(fixture)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(fixture).startsWith("cmcq-eslint-next-"));
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test("generated private material and vendored code are ignored while application sources stay checked", async () => {
  for (const file of [".data/example.ts", "docs/research/example.ts", "outputs/example.ts", "tooling/eslint-next/dist/index.js"]) {
    assert.equal(await eslint.isPathIgnored(path.join(project, file)), true, file);
  }
  for (const file of ["src/app/page.tsx", "src/components/example.tsx", "scripts/eslint-next-vendor.test.mjs"]) {
    assert.equal(await eslint.isPathIgnored(path.join(project, file)), false, file);
  }
});
