import { loadEnvConfig } from "@next/env";
import { loadE2A10Canary } from
  "@/lib/evaluation/formative/e2a10-v7-topic-dialogue-canary";

loadEnvConfig(process.cwd());

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

console.log(JSON.stringify(loadE2A10Canary(argument("--run")), null, 2));
