import { loadEnvConfig } from "@next/env";
import { loadLatestE2A4Evaluation } from "@/lib/evaluation/formative/e2a4-topic-dialogue-evaluation";

loadEnvConfig(process.cwd());

console.log(JSON.stringify(loadLatestE2A4Evaluation(), null, 2));
