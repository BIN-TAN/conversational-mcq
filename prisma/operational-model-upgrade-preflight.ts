import { loadEnvConfig } from "@next/env";
import { summarizeModelUpgradePreflight } from "../src/lib/operational/model-upgrade";
import { candidateManifestArg } from "./operational-model-upgrade-cli-args";

loadEnvConfig(process.cwd());

console.log(JSON.stringify(summarizeModelUpgradePreflight({
  manifestPath: candidateManifestArg()
}), null, 2));
