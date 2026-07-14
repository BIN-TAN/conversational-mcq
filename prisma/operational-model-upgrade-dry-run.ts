import { loadEnvConfig } from "@next/env";
import { buildOperationalModelUpgradeComparison } from "../src/lib/operational/model-upgrade";

loadEnvConfig(process.cwd());

const comparison = buildOperationalModelUpgradeComparison();
console.log(JSON.stringify({
  status: "dry_run_complete",
  no_provider_call: true,
  candidate_hash: comparison.candidate.candidate_configuration_hash,
  baseline_hash: comparison.baseline.approved_active_configuration_hash,
  fixtures: comparison.fixtures,
  role_comparisons: comparison.role_comparisons.map((entry) => ({
    role: entry.role,
    surface: entry.surface,
    baseline: entry.baseline,
    candidate: entry.candidate,
    changed_fields: entry.changed_fields,
    compatibility_status: entry.compatibility_status,
    approval_boundary: entry.approval_boundary
  })),
  auto_approval_permitted: comparison.auto_approval_permitted
}, null, 2));
