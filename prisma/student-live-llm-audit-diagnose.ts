import { PrismaClient } from "@prisma/client";
import { sanitizedAuditSummary, type LiveAuditCall } from "./student-live-llm-diagnostics";

const prisma = new PrismaClient();

function argValue(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const agentCallId = argValue("--agent-call-id") ?? argValue("--id") ?? process.argv[2];

  if (!agentCallId || agentCallId.startsWith("--")) {
    console.log(JSON.stringify({
      status: "usage",
      message: "Provide --agent-call-id <agent_call_id>. No prompts, raw outputs, or secrets are printed."
    }, null, 2));
    process.exitCode = 1;
    return;
  }

  const call = await prisma.agentCall.findUnique({
    where: { id: agentCallId },
    select: {
      id: true,
      agent_name: true,
      schema_version: true,
      provider: true,
      model_name: true,
      live_call_allowed: true,
      output_payload: true,
      output_validated: true,
      validation_error: true,
      error_category: true,
      call_status: true,
      provider_request_id: true,
      provider_response_id: true,
      client_request_id: true,
      prompt_version: true,
      raw_output: true,
      token_usage: true,
      created_at: true,
      completed_at: true
    }
  });

  if (!call) {
    console.log(JSON.stringify({
      status: "not_found",
      agent_call_id: agentCallId,
      note: "The row is not present in the current local database. Live smoke cleanup may have removed the synthetic session."
    }, null, 2));
    return;
  }

  console.log(JSON.stringify({
    status: "found",
    diagnostic: sanitizedAuditSummary(call as LiveAuditCall)
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
