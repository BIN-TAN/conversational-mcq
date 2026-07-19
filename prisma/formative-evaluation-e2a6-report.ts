import { loadEnvConfig } from "@next/env";
import { loadE2A6Evaluation } from
  "@/lib/evaluation/formative/e2a6-v5-topic-dialogue-evaluation";

loadEnvConfig(process.cwd());

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

console.log(JSON.stringify(loadE2A6Evaluation(argument("--run")), null, 2));
