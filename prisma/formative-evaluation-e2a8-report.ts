import { loadEnvConfig } from "@next/env";
import { loadE2A8Canary } from
  "@/lib/evaluation/formative/e2a8-v6-topic-dialogue-canary";

loadEnvConfig(process.cwd());

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

console.log(JSON.stringify(loadE2A8Canary(argument("--run")), null, 2));
