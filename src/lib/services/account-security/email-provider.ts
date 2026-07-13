import { getServerEnv } from "@/lib/env";

export type AccountSecurityEmail = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

export type AccountSecurityEmailResult =
  | {
      status: "sent";
      provider: string;
      provider_message_id?: string | null;
    }
  | {
      status: "unavailable" | "failed";
      provider: string;
      safe_error_code: string;
      http_status?: number | null;
    };

export type AccountSecurityEmailProvider = {
  providerName: string;
  send(message: AccountSecurityEmail): Promise<AccountSecurityEmailResult>;
};

export function disabledEmailProvider(): AccountSecurityEmailProvider {
  return {
    providerName: "disabled",
    async send() {
      return {
        status: "unavailable",
        provider: "disabled",
        safe_error_code: "email_provider_not_configured"
      };
    }
  };
}

export function configuredEmailProvider(): AccountSecurityEmailProvider {
  const env = getServerEnv();

  if (env.EMAIL_PROVIDER === "disabled") {
    return disabledEmailProvider();
  }

  if (env.EMAIL_PROVIDER === "resend") {
    return {
      providerName: "resend",
      async send(message) {
        if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
          return {
            status: "unavailable",
            provider: "resend",
            safe_error_code: "email_provider_not_configured"
          };
        }

        try {
          const response = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${env.RESEND_API_KEY}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              from: env.EMAIL_FROM,
              to: [message.to],
              reply_to: env.EMAIL_REPLY_TO || undefined,
              subject: message.subject,
              text: message.text,
              html: message.html
            })
          });
          const body = (await response.json().catch(() => null)) as { id?: string } | null;

          if (!response.ok) {
            return {
              status: "failed",
              provider: "resend",
              safe_error_code: "email_provider_rejected",
              http_status: response.status
            };
          }

          return {
            status: "sent",
            provider: "resend",
            provider_message_id: body?.id ?? null
          };
        } catch {
          return {
            status: "failed",
            provider: "resend",
            safe_error_code: "email_provider_network_failed"
          };
        }
      }
    };
  }

  return disabledEmailProvider();
}

export function appBaseUrl() {
  const env = getServerEnv();
  return env.APP_BASE_URL.replace(/\/+$/, "");
}

