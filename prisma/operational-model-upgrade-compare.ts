import { loadEnvConfig } from "@next/env";
import { buildOperationalModelUpgradeComparison } from "../src/lib/operational/model-upgrade";

loadEnvConfig(process.cwd());

const comparison = buildOperationalModelUpgradeComparison();
console.log(JSON.stringify({
  status: "comparison_ready",
  no_provider_call: true,
  baseline: comparison.baseline,
  candidate: comparison.candidate,
  compatibility_ok: comparison.compatibility_ok,
  changed_roles: comparison.role_comparisons
    .filter((entry) => entry.changed_fields.length > 0)
    .map((entry) => ({
      role: entry.role,
      changed_fields: entry.changed_fields,
      baseline: entry.baseline,
      candidate: entry.candidate,
      compatibility_issues: entry.compatibility_issues
    }))
}, null, 2));
