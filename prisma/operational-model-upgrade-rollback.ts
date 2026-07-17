import { loadEnvConfig } from "@next/env";
import {
  OperationalApprovalBundleError,
  rollbackOperationalApprovalBundle
} from "../src/lib/operational/active-approval-bundle";

loadEnvConfig(process.cwd());

function argValue(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const expectedCurrentRuntimeHash = argValue("--expected-current-runtime-hash");
const expectedRollbackHash = argValue("--expected-rollback-hash");
const confirmation = argValue("--confirm");

if (!expectedCurrentRuntimeHash || !expectedRollbackHash || !confirmation) {
  console.error(JSON.stringify({
    status: "blocked",
    reason: "missing_rollback_arguments",
    required_arguments: [
      "--expected-current-runtime-hash <sha256>",
      "--expected-rollback-hash <sha256>",
      "--confirm \"rollback to approved gpt-5.4 baseline\""
    ],
    no_provider_call: true
  }, null, 2));
  process.exit(1);
}

try {
  console.log(JSON.stringify(rollbackOperationalApprovalBundle({
    expectedCurrentRuntimeHash,
    expectedRollbackHash,
    confirmation
  }), null, 2));
} catch (error) {
  console.error(JSON.stringify({
    status: "blocked",
    reason: error instanceof OperationalApprovalBundleError ? error.code : "rollback_failed",
    details: error instanceof OperationalApprovalBundleError ? error.details ?? null : null,
    no_provider_call: true
  }, null, 2));
  process.exit(1);
}
