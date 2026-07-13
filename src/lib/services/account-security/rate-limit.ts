import type { PrismaClient } from "@prisma/client";
import { getServerEnv } from "@/lib/env";
import { safeHash } from "./email";

type RateLimitInput = {
  prisma: PrismaClient;
  checks: Array<{
    scope: string;
    value: string;
    limit: number;
  }>;
  now?: Date;
};

function hourWindow(date: Date) {
  const window = new Date(date);
  window.setUTCMinutes(0, 0, 0);
  return window;
}

export async function consumeAccountSecurityRateLimit(input: RateLimitInput) {
  const now = input.now ?? new Date();
  const windowStart = hourWindow(now);

  for (const check of input.checks) {
    const scopeHash = safeHash(check.value);
    const existing = await input.prisma.accountSecurityRateLimit.findUnique({
      where: {
        scope_scope_hash_window_start: {
          scope: check.scope,
          scope_hash: scopeHash,
          window_start: windowStart
        }
      },
      select: { request_count: true }
    });

    if ((existing?.request_count ?? 0) >= check.limit) {
      return {
        allowed: false,
        blocked_scope: check.scope
      } as const;
    }
  }

  for (const check of input.checks) {
    const scopeHash = safeHash(check.value);
    await input.prisma.accountSecurityRateLimit.upsert({
      where: {
        scope_scope_hash_window_start: {
          scope: check.scope,
          scope_hash: scopeHash,
          window_start: windowStart
        }
      },
      update: {
        request_count: { increment: 1 },
        last_request_at: now
      },
      create: {
        scope: check.scope,
        scope_hash: scopeHash,
        window_start: windowStart,
        request_count: 1,
        last_request_at: now
      }
    });
  }

  return { allowed: true } as const;
}

export function passwordResetRateLimitChecks(input: { normalizedEmail: string; ipHash: string | null }) {
  const env = getServerEnv();
  return [
    {
      scope: "teacher_password_reset_email",
      value: input.normalizedEmail,
      limit: env.TEACHER_PASSWORD_RESET_EMAIL_MAX_PER_HOUR
    },
    {
      scope: "teacher_password_reset_ip",
      value: input.ipHash ?? "missing-ip",
      limit: env.TEACHER_PASSWORD_RESET_IP_MAX_PER_HOUR
    },
    {
      scope: "teacher_password_reset_global",
      value: "global",
      limit: env.TEACHER_PASSWORD_RESET_GLOBAL_MAX_PER_HOUR
    }
  ];
}

export function emailChangeRateLimitChecks(userDbId: string) {
  const env = getServerEnv();
  return [
    {
      scope: "teacher_email_change_user",
      value: userDbId,
      limit: env.TEACHER_EMAIL_CHANGE_MAX_PER_HOUR
    }
  ];
}

export function safeRequestHash(value: string | null | undefined) {
  if (!value) {
    return null;
  }
  return safeHash(value).slice(0, 32);
}

