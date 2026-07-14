import { loadEnvConfig } from "@next/env";
import { summarizeModelUpgradePreflight } from "../src/lib/operational/model-upgrade";

loadEnvConfig(process.cwd());

console.log(JSON.stringify(summarizeModelUpgradePreflight(), null, 2));
