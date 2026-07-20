import { loadEnvConfig } from "@next/env";
import { loadE2A13Evaluation } from
  "@/lib/evaluation/formative/e2a13-v8-30-case-evaluation";

loadEnvConfig(process.cwd());

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

console.log(JSON.stringify(loadE2A13Evaluation(argument("--run")), null, 2));
