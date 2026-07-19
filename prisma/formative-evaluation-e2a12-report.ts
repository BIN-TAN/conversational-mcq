import { loadEnvConfig } from "@next/env";
import { loadE2A12Canary } from
  "@/lib/evaluation/formative/e2a12-v8-runtime-canary";

loadEnvConfig(process.cwd());

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

console.log(JSON.stringify(loadE2A12Canary(argument("--run")), null, 2));
