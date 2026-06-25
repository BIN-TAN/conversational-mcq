import { runOperationalLiveCanaryTransportProbe } from "../src/lib/services/operational-live-canary/service";

async function main() {
  process.stdout.write(JSON.stringify({
    event: "transport_probe_cli_progress",
    current_stage: "preflight",
    dispatch_started: false,
    verified_provider_request_count: 0
  }) + "\n");
  const result = await runOperationalLiveCanaryTransportProbe({
    confirmPaidApi: process.argv.includes("--confirm-paid-api")
  });
  const providerRequestCount =
    "provider_request_count" in result && typeof result.provider_request_count === "number"
      ? result.provider_request_count
      : 0;
  process.stdout.write(JSON.stringify({
    event: "transport_probe_cli_progress",
    run_public_id: "run_public_id" in result ? result.run_public_id : null,
    resolved_provider: "resolved_provider" in result ? result.resolved_provider : "openai",
    resolved_transport: "resolved_transport" in result ? result.resolved_transport : "openai_responses",
    current_stage: result.status,
    dispatch_started: providerRequestCount > 0,
    verified_provider_request_count: providerRequestCount,
    usage_status: "usage_status" in result ? result.usage_status : "not_available",
    final_status: result.status
  }) + "\n");
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Operational live canary transport probe failed.");
  process.exitCode = 1;
});
