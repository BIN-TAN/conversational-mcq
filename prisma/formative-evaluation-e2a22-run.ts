import { executeE2A22 } from
  "@/lib/evaluation/formative/e2a22-evidence-first-profile-routing";

async function main() {
  const result = await executeE2A22();
  console.log(JSON.stringify({
    run_id: result.runId,
    run_directory: result.runDir,
    summary: result.summary
  }, null, 2));
  if (result.summary.status !==
    "e2a22_profile_first_routing_corrected_e2a23_ready") {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "e2a22_run_failed");
  process.exitCode = 1;
});
