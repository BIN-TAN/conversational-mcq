/**
 * Release CMCQ-20261024-12: snapshot of every exported Zod schema in src/lib, for the Zod 4 upgrade.
 *
 * For each module under src/lib (tests excluded) it imports the module and, for every export that
 * is a Zod schema, records:
 *   - json_schema: the JSON schema the OpenAI structured-output helper sends for it
 *     (zodTextFormat(schema).schema), or the error the helper raised;
 *   - samples: whether a few generic values (null, {}, [], "", 0, a 10-element array) parse.
 * Run it once before the upgrade and once after, then compare the two files:
 *
 *   npx tsx prisma/zod-schema-snapshot.ts --out <file.json>
 *   npx tsx prisma/zod-schema-snapshot.ts --compare <before.json> <after.json> --out <diff.json>
 *
 * The JSON schema is what the model sees, so any difference there in a schema that a provider call
 * uses is reported for review. No database query and no model call is made.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

process.env.DATABASE_URL ??= "postgresql://synthetic:synthetic@127.0.0.1:5432/zod_schema_snapshot";
process.env.SESSION_SECRET ??= "zod-schema-snapshot-session-secret-000000000000000000";
process.env.LLM_PROVIDER ??= "mock";
process.env.LLM_LIVE_CALLS_ENABLED ??= "false";

const args = process.argv.slice(2);
const option = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] ?? null : null;
};

type Entry = { json_schema?: unknown; json_schema_error?: string; samples: Record<string, boolean> };
type Snapshot = { modules: Record<string, Record<string, Entry>>; import_errors: Record<string, string> };

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value as object).sort().map((key) => [key, stable((value as Record<string, unknown>)[key])]));
  }
  return value;
}

function isZodSchema(value: unknown): value is { safeParse: (input: unknown) => { success: boolean } } {
  return Boolean(value) && typeof value === "object" && typeof (value as { safeParse?: unknown }).safeParse === "function"
    && ("_def" in (value as object) || "_zod" in (value as object));
}

function walk(dir: string, out: string[]) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name) && !name.endsWith(".d.ts")) out.push(full);
  }
}

async function snapshot(out: string) {
  const { zodTextFormat } = await import("openai/helpers/zod");
  const files: string[] = [];
  walk(path.join(process.cwd(), "src/lib"), files);
  files.sort();
  const result: Snapshot = { modules: {}, import_errors: {} };
  const samples: Record<string, unknown> = { null: null, empty_object: {}, empty_array: [], empty_string: "", zero: 0, array_10: Array.from({ length: 10 }, (_, i) => i) };
  for (const file of files) {
    const rel = path.relative(process.cwd(), file).split(path.sep).join("/");
    let mod: Record<string, unknown>;
    try {
      mod = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
    } catch (error) {
      result.import_errors[rel] = error instanceof Error ? error.message.split("\n")[0] : String(error);
      continue;
    }
    for (const [name, value] of Object.entries(mod)) {
      if (!isZodSchema(value)) continue;
      const entry: Entry = { samples: {} };
      try {
        entry.json_schema = stable(zodTextFormat(value as never, "schema").schema);
      } catch (error) {
        entry.json_schema_error = error instanceof Error ? error.message.split("\n")[0] : String(error);
      }
      for (const [label, sample] of Object.entries(samples)) {
        try {
          entry.samples[label] = value.safeParse(sample).success;
        } catch {
          entry.samples[label] = false;
        }
      }
      (result.modules[rel] ??= {})[name] = entry;
    }
  }
  writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
  const count = Object.values(result.modules).reduce((sum, entries) => sum + Object.keys(entries).length, 0);
  console.log(`${count} schemas in ${Object.keys(result.modules).length} modules; ${Object.keys(result.import_errors).length} modules could not be imported.`);
}

function compare(beforeFile: string, afterFile: string, out: string) {
  const before = JSON.parse(readFileSync(beforeFile, "utf8")) as Snapshot;
  const after = JSON.parse(readFileSync(afterFile, "utf8")) as Snapshot;
  const differences: Array<Record<string, unknown>> = [];
  const keys = new Set([...Object.keys(before.modules), ...Object.keys(after.modules)]);
  let same = 0;
  for (const rel of [...keys].sort()) {
    const names = new Set([...Object.keys(before.modules[rel] ?? {}), ...Object.keys(after.modules[rel] ?? {})]);
    for (const name of [...names].sort()) {
      const a = before.modules[rel]?.[name];
      const b = after.modules[rel]?.[name];
      if (!a || !b) {
        differences.push({ module: rel, export: name, kind: a ? "missing_after" : "new_after" });
        continue;
      }
      const schemaSame = JSON.stringify(a.json_schema ?? a.json_schema_error) === JSON.stringify(b.json_schema ?? b.json_schema_error);
      const samplesSame = JSON.stringify(a.samples) === JSON.stringify(b.samples);
      if (schemaSame && samplesSame) {
        same += 1;
        continue;
      }
      differences.push({
        module: rel,
        export: name,
        kind: schemaSame ? "parse_samples_changed" : "json_schema_changed",
        before: schemaSame ? a.samples : (a.json_schema ?? { error: a.json_schema_error }),
        after: schemaSame ? b.samples : (b.json_schema ?? { error: b.json_schema_error })
      });
    }
  }
  const importErrorsChanged = JSON.stringify(stable(before.import_errors)) !== JSON.stringify(stable(after.import_errors));
  const report = { same, different: differences.length, import_errors_changed: importErrorsChanged, import_errors_before: before.import_errors, import_errors_after: after.import_errors, differences };
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`${same} schemas identical, ${differences.length} different; import errors ${importErrorsChanged ? "changed" : "unchanged"}.`);
}

async function main() {
  const out = option("--out");
  if (!out) throw new Error("Name the output file with --out.");
  const compareIndex = args.indexOf("--compare");
  if (compareIndex >= 0) {
    compare(args[compareIndex + 1], args[compareIndex + 2], out);
    return;
  }
  await snapshot(out);
}

main().then(() => process.exit(process.exitCode ?? 0)).catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
