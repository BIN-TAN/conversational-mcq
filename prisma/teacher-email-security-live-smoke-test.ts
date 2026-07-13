import { loadEnvConfig } from "@next/env";
import { configuredEmailProvider } from "../src/lib/services/account-security/email-provider";
import { getServerEnv } from "../src/lib/env";

loadEnvConfig(process.cwd());

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  if (process.env.RUN_LIVE_TEACHER_EMAIL_SECURITY_SMOKE !== "1") {
    console.log(
      JSON.stringify(
        {
          status: "skipped",
          reason: "RUN_LIVE_TEACHER_EMAIL_SECURITY_SMOKE is not 1",
          provider_call_occurred: false,
          email_sent: false,
          raw_token_printed: false,
          plaintext_password_sent: false
        },
        null,
        2
      )
    );
    return;
  }

  const recipient = process.env.LIVE_TEACHER_EMAIL_SMOKE_RECIPIENT?.trim();
  assert(recipient, "LIVE_TEACHER_EMAIL_SMOKE_RECIPIENT is required for the live email smoke.");
  const env = getServerEnv();
  assert(env.EMAIL_PROVIDER !== "disabled", "EMAIL_PROVIDER must be configured for the live email smoke.");
  assert(env.EMAIL_FROM, "EMAIL_FROM is required for the live email smoke.");

  const provider = configuredEmailProvider();
  const result = await provider.send({
    to: recipient,
    subject: "EDPY 507 email security smoke",
    text: [
      "EDPY 507: Measurement Theory",
      "",
      "This is an operator-triggered email delivery smoke test.",
      "No password, reset token, or assessment content is included."
    ].join("\n"),
    html: [
      "<p>EDPY 507: Measurement Theory</p>",
      "<p>This is an operator-triggered email delivery smoke test.</p>",
      "<p>No password, reset token, or assessment content is included.</p>"
    ].join("")
  });

  assert(result.status === "sent", "Live email provider did not accept the smoke message.");

  console.log(
    JSON.stringify(
      {
        status: "passed",
        provider: result.provider,
        provider_message_id_present: Boolean(result.provider_message_id),
        provider_call_occurred: true,
        email_sent: true,
        raw_token_printed: false,
        plaintext_password_sent: false,
        no_openai_call_occurred: true
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        status: "failed",
        error: error instanceof Error ? error.message : "unknown_error",
        raw_token_printed: false,
        plaintext_password_sent: false,
        no_openai_call_occurred: true
      },
      null,
      2
    )
  );
  process.exit(1);
});
