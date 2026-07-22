import { readFileSync } from "node:fs";
import path from "node:path";
import {
  E2A26A_ARTIFACT_ROOT,
  latestE2A26ARun
} from "@/lib/evaluation/formative/e2a26a-anchor-conclusion-consistency";

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index < 0 ? null : process.argv[index + 1] ?? null;
}

const requested = argument("--run");
const runDir = requested
  ? path.join(E2A26A_ARTIFACT_ROOT, requested)
  : latestE2A26ARun();
if (!runDir) throw new Error("e2a26a_report_run_missing");
const summary = JSON.parse(readFileSync(path.join(runDir, "summary.json"),
  "utf8")) as Record<string, unknown>;
console.log(JSON.stringify({ run_directory: runDir, ...summary }, null, 2));
