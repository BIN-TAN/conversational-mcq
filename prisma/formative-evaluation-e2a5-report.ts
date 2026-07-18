import { loadEnvConfig } from "@next/env";
import { loadLatestE2A5Adjudication } from "@/lib/evaluation/formative/e2a5-progression-adjudication";

loadEnvConfig(process.cwd());

console.log(JSON.stringify(loadLatestE2A5Adjudication(), null, 2));
