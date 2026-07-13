import type { AccountSecurityTokenPurpose, Prisma, PrismaClient, User } from "@prisma/client";
import { z } from "zod";
import { prisma as defaultPrisma } from "@/lib/db";
import { getServerEnv } from "@/lib/env";
import { hashSecret, verifySecret } from "@/lib/password";
import { generatePublicId } from "@/lib/services/ids";
import {
  normalizeUserId,
  parseStudentPassword,
  parseUserId,
  userIdValidationError
} from "@/lib/services/student-accounts/validation";
import {
  appBaseUrl,
  configuredEmailProvider,
  type AccountSecurityEmailProvider,
  type AccountSecurityEmailResult
} from "./email-provider";
import { maskEmail, normalizeTeacherEmail, safeHash, safeNormalizeTeacherEmail } from "./email";
import {
  consumeAccountSecurityRateLimit,
  emailChangeRateLimitChecks,
  passwordResetRateLimitChecks,
  safeRequestHash
} from "./rate-limit";
import { generateAccountSecurityToken, hashAccountSecurityToken } from "./tokens";

export const PASSWORD_RESET_PUBLIC_RESPONSE =
  "If a verified teacher account is associated with that email, a password-reset link will be sent.";

export class AccountSecurityError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
    readonly safeDetails: Record<string, unknown> = {}
  ) {
    super(message);
  }
}

type ServiceContext = {
  prisma?: PrismaClient;
  emailProvider?: AccountSecurityEmailProvider;
  now?: Date;
};

function db(context?: ServiceContext) {
  return context?.prisma ?? defaultPrisma;
}

function provider(context?: ServiceContext) {
  return context?.emailProvider ?? configuredEmailProvider();
}

function minutesFromNow(minutes: number, now = new Date()) {
  return new Date(now.getTime() + minutes * 60_000);
}

function metadata(input: Record<string, unknown>): Prisma.InputJsonObject {
  return input as Prisma.InputJsonObject;
}

async function logSecurityEvent(input: {
  prisma: PrismaClient | Prisma.TransactionClient;
  userDbId?: string | null;
  performedByUserDbId?: string | null;
  eventType: string;
  status: string;
  metadata?: Record<string, unknown>;
}) {
  return input.prisma.accountSecurityEvent.create({
    data: {
      event_public_id: generatePublicId("account_security_event"),
      user_db_id: input.userDbId ?? null,
      performed_by_user_db_id: input.performedByUserDbId ?? null,
      event_type: input.eventType,
      status: input.status,
      metadata_json: input.metadata ? metadata(input.metadata) : undefined
    }
  });
}

function requestContext(request?: Request) {
  const forwardedFor = request?.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = request?.headers.get("x-real-ip")?.trim();
  const userAgent = request?.headers.get("user-agent")?.trim();
  return {
    ipHash: safeRequestHash(forwardedFor || realIp || null),
    userAgentHash: safeRequestHash(userAgent || null)
  };
}

async function invalidateActiveTokens(input: {
  prisma: PrismaClient | Prisma.TransactionClient;
  userDbId: string;
  purposes: AccountSecurityTokenPurpose[];
  now: Date;
}) {
  const result = await input.prisma.accountSecurityToken.updateMany({
    where: {
      user_db_id: input.userDbId,
      purpose: { in: input.purposes },
      used_at: null,
      invalidated_at: null
    },
    data: { invalidated_at: input.now }
  });
  return result.count;
}

async function assertEmailAvailable(input: {
  prisma: PrismaClient | Prisma.TransactionClient;
  normalizedEmail: string;
  currentUserDbId?: string;
}) {
  const existingCurrent = await input.prisma.user.findFirst({
    where: {
      email_normalized: input.normalizedEmail,
      ...(input.currentUserDbId ? { id: { not: input.currentUserDbId } } : {})
    },
    select: { id: true }
  });
  if (existingCurrent) {
    throw new AccountSecurityError("email_unavailable", "That email address cannot be used. Choose another address.", 409);
  }

  const existingPending = await input.prisma.user.findFirst({
    where: {
      pending_email_normalized: input.normalizedEmail,
      ...(input.currentUserDbId ? { id: { not: input.currentUserDbId } } : {})
    },
    select: { id: true }
  });
  if (existingPending) {
    throw new AccountSecurityError("email_unavailable", "That email address cannot be used. Choose another address.", 409);
  }
}

function parseOperatorUsername(value: unknown, variableName: string) {
  const issue = userIdValidationError(value);
  if (issue) {
    throw new AccountSecurityError("invalid_username", `${variableName}: ${issue}`, 400, {
      variable_name: variableName,
      validation_error: issue
    });
  }
  return parseUserId(value);
}

function passwordResetEmail(input: { to: string; token: string; expiresAt: Date }) {
  const resetUrl = `${appBaseUrl()}/auth/reset-password?token=${encodeURIComponent(input.token)}`;
  const expiration = input.expiresAt.toLocaleString("en-CA", { timeZone: "America/Edmonton" });
  const text = [
    "EDPY 507: Measurement Theory",
    "",
    "Use this one-time link to reset your teacher password:",
    resetUrl,
    "",
    `This link expires at ${expiration} and can be used once.`,
    "If you did not request this, ignore this email."
  ].join("\n");
  const html = [
    "<p>EDPY 507: Measurement Theory</p>",
    `<p><a href="${resetUrl}">Reset your teacher password</a></p>`,
    `<p>This link expires at ${expiration} and can be used once.</p>`,
    "<p>If you did not request this, ignore this email.</p>"
  ].join("");

  return {
    to: input.to,
    subject: "Reset your EDPY 507 teacher password",
    text,
    html
  };
}

function emailChangeVerificationEmail(input: { to: string; token: string; expiresAt: Date }) {
  const verifyUrl = `${appBaseUrl()}/teacher/account/verify-email?token=${encodeURIComponent(input.token)}`;
  const expiration = input.expiresAt.toLocaleString("en-CA", { timeZone: "America/Edmonton" });
  return {
    to: input.to,
    subject: "Verify your EDPY 507 teacher recovery email",
    text: [
      "EDPY 507: Measurement Theory",
      "",
      "Use this one-time link to verify your new recovery email address:",
      verifyUrl,
      "",
      `This link expires at ${expiration} and can be used once.`,
      "If you did not request this, contact the site operator."
    ].join("\n"),
    html: [
      "<p>EDPY 507: Measurement Theory</p>",
      `<p><a href="${verifyUrl}">Verify your new recovery email</a></p>`,
      `<p>This link expires at ${expiration} and can be used once.</p>`,
      "<p>If you did not request this, contact the site operator.</p>"
    ].join("")
  };
}

function notificationEmail(input: { to: string; subject: string; action: string }) {
  const timestamp = new Date().toISOString();
  const text = [
    "EDPY 507: Measurement Theory",
    "",
    input.action,
    `Timestamp: ${timestamp}`,
    "",
    "If this was not authorized, contact the site operator."
  ].join("\n");
  return {
    to: input.to,
    subject: input.subject,
    text,
    html: `<p>EDPY 507: Measurement Theory</p><p>${input.action}</p><p>Timestamp: ${timestamp}</p><p>If this was not authorized, contact the site operator.</p>`
  };
}

async function sendSecurityEmail(input: {
  emailProvider: AccountSecurityEmailProvider;
  email: Parameters<AccountSecurityEmailProvider["send"]>[0];
}) {
  return input.emailProvider.send(input.email);
}

async function logDeliveryFailure(input: {
  prisma: PrismaClient | Prisma.TransactionClient;
  userDbId?: string | null;
  result: AccountSecurityEmailResult;
  eventType?: string;
}) {
  if (input.result.status === "sent") {
    return;
  }

  await logSecurityEvent({
    prisma: input.prisma,
    userDbId: input.userDbId ?? null,
    eventType: input.eventType ?? "teacher_security_email_delivery_failed",
    status: input.result.status,
    metadata: {
      provider: input.result.provider,
      safe_error_code: input.result.safe_error_code,
      http_status: input.result.http_status ?? null
    }
  });
}

export async function requestTeacherPasswordReset(input: {
  email: unknown;
  request?: Request;
  context?: ServiceContext;
}) {
  const prisma = db(input.context);
  const now = input.context?.now ?? new Date();
  const parsedEmail = safeNormalizeTeacherEmail(input.email);
  const { ipHash, userAgentHash } = requestContext(input.request);

  if (!parsedEmail) {
    return { message: PASSWORD_RESET_PUBLIC_RESPONSE, email_sent: false, reason: "invalid_email" as const };
  }

  const rate = await consumeAccountSecurityRateLimit({
    prisma,
    checks: passwordResetRateLimitChecks({ normalizedEmail: parsedEmail.normalized, ipHash }),
    now
  });

  if (!rate.allowed) {
    return {
      message: PASSWORD_RESET_PUBLIC_RESPONSE,
      email_sent: false,
      reason: "rate_limited" as const,
      blocked_scope: rate.blocked_scope
    };
  }

  const teacher = await prisma.user.findFirst({
    where: {
      role: "teacher_researcher",
      account_status: "active",
      email_normalized: parsedEmail.normalized,
      email_verified_at: { not: null }
    },
    select: {
      id: true,
      user_id: true,
      email: true
    }
  });

  if (!teacher?.email) {
    return { message: PASSWORD_RESET_PUBLIC_RESPONSE, email_sent: false, reason: "no_eligible_teacher" as const };
  }

  const emailProvider = provider(input.context);
  const expiresAt = minutesFromNow(getServerEnv().PASSWORD_RESET_TOKEN_TTL_MINUTES, now);
  const token = generateAccountSecurityToken();
  const tokenHash = hashAccountSecurityToken(token);

  await invalidateActiveTokens({
    prisma,
    userDbId: teacher.id,
    purposes: ["teacher_password_reset"],
    now
  });
  await prisma.accountSecurityToken.create({
    data: {
      token_public_id: generatePublicId("account_security_token"),
      user_db_id: teacher.id,
      purpose: "teacher_password_reset",
      token_hash: tokenHash,
      expires_at: expiresAt,
      request_ip_hash: ipHash,
      request_user_agent_hash: userAgentHash,
      metadata_json: metadata({
        requested_email_hash: safeHash(parsedEmail.normalized),
        app_base_url_hash: safeHash(appBaseUrl())
      })
    }
  });

  const delivery = await sendSecurityEmail({
    emailProvider,
    email: passwordResetEmail({ to: teacher.email, token, expiresAt })
  });

  if (delivery.status !== "sent") {
    await prisma.accountSecurityToken.updateMany({
      where: { token_hash: tokenHash, used_at: null },
      data: { invalidated_at: now }
    });
    await logDeliveryFailure({ prisma, userDbId: teacher.id, result: delivery });
    return { message: PASSWORD_RESET_PUBLIC_RESPONSE, email_sent: false, reason: "delivery_failed" as const };
  }

  await logSecurityEvent({
    prisma,
    userDbId: teacher.id,
    eventType: "teacher_password_reset_requested",
    status: "sent",
    metadata: {
      provider: delivery.provider,
      provider_message_id_present: Boolean(delivery.provider_message_id),
      requested_email_hash: safeHash(parsedEmail.normalized)
    }
  });

  return { message: PASSWORD_RESET_PUBLIC_RESPONSE, email_sent: true, reason: "sent" as const };
}

function activeTokenWhere(tokenHash: string, purpose: AccountSecurityTokenPurpose, now: Date) {
  return {
    token_hash: tokenHash,
    purpose,
    used_at: null,
    invalidated_at: null,
    expires_at: { gt: now }
  };
}

export async function completeTeacherPasswordReset(input: {
  token: string;
  newPassword: unknown;
  confirmNewPassword: unknown;
  context?: ServiceContext;
}) {
  if (!input.token || input.token.length < 32) {
    throw new AccountSecurityError("invalid_or_expired_token", "This password-reset link is invalid or has expired. Request a new link.", 400);
  }

  const prisma = db(input.context);
  const now = input.context?.now ?? new Date();
  const tokenHash = hashAccountSecurityToken(input.token);
  const newPassword = parseStudentPassword(input.newPassword);
  const confirm = z.string().parse(input.confirmNewPassword);

  if (newPassword !== confirm) {
    throw new AccountSecurityError("password_confirmation_mismatch", "Password confirmation does not match.", 400);
  }

  const token = await prisma.accountSecurityToken.findFirst({
    where: activeTokenWhere(tokenHash, "teacher_password_reset", now),
    include: { user: true }
  });

  if (!token || token.user.role !== "teacher_researcher") {
    throw new AccountSecurityError("invalid_or_expired_token", "This password-reset link is invalid or has expired. Request a new link.", 400);
  }

  const passwordHash = await hashSecret(newPassword);
  const updated = await prisma.$transaction(async (tx) => {
    const user = await tx.user.update({
      where: { id: token.user_db_id },
      data: {
        password_hash: passwordHash,
        password_changed_at: now,
        credential_reset_at: now,
        credential_updated_at: now,
        auth_version: { increment: 1 }
      },
      select: { id: true, user_id: true, email: true, auth_version: true }
    });
    await tx.accountSecurityToken.update({
      where: { id: token.id },
      data: { used_at: now }
    });
    await invalidateActiveTokens({
      prisma: tx,
      userDbId: token.user_db_id,
      purposes: ["teacher_password_reset", "teacher_email_change_verification"],
      now
    });
    await logSecurityEvent({
      prisma: tx,
      userDbId: token.user_db_id,
      eventType: "teacher_password_reset_completed",
      status: "completed",
      metadata: { auth_version_incremented: true }
    });
    return user;
  });

  if (updated.email) {
    const delivery = await sendSecurityEmail({
      emailProvider: provider(input.context),
      email: notificationEmail({
        to: updated.email,
        subject: "Your EDPY 507 teacher password was changed",
        action: "Your teacher account password was changed."
      })
    });
    if (delivery.status !== "sent") {
      await logDeliveryFailure({ prisma, userDbId: updated.id, result: delivery });
    }
  }

  return { ok: true as const, user_id: updated.user_id };
}

export async function getTeacherAccountSecurity(input: { userDbId: string; context?: ServiceContext }) {
  const user = await db(input.context).user.findUnique({
    where: { id: input.userDbId },
    select: {
      user_id: true,
      role: true,
      email: true,
      email_verified_at: true,
      pending_email: true,
      email_change_requested_at: true,
      password_changed_at: true
    }
  });

  if (!user || user.role !== "teacher_researcher") {
    throw new AccountSecurityError("account_unavailable", "Account settings are unavailable.", 404);
  }

  return {
    user_id: user.user_id,
    email: user.email,
    masked_email: maskEmail(user.email),
    email_verified_at: user.email_verified_at,
    pending_email: user.pending_email,
    masked_pending_email: maskEmail(user.pending_email),
    email_change_requested_at: user.email_change_requested_at,
    password_changed_at: user.password_changed_at
  };
}

async function requireTeacherWithPassword(input: {
  prisma: PrismaClient | Prisma.TransactionClient;
  userDbId: string;
  currentPassword: unknown;
}) {
  const user = await input.prisma.user.findUnique({
    where: { id: input.userDbId },
    select: {
      id: true,
      user_id: true,
      role: true,
      password_hash: true,
      email: true,
      email_normalized: true
    }
  });

  if (!user || user.role !== "teacher_researcher") {
    throw new AccountSecurityError("account_unavailable", "Account settings are unavailable.", 404);
  }

  const matches = await verifySecret(String(input.currentPassword ?? ""), user.password_hash);
  if (!matches) {
    throw new AccountSecurityError("current_password_invalid", "Current password is incorrect.", 403);
  }

  return user;
}

export async function requestTeacherEmailChange(input: {
  userDbId: string;
  currentPassword: unknown;
  newEmail: unknown;
  context?: ServiceContext;
}) {
  const prisma = db(input.context);
  const now = input.context?.now ?? new Date();
  const normalized = normalizeTeacherEmail(input.newEmail);
  const user = await requireTeacherWithPassword({
    prisma,
    userDbId: input.userDbId,
    currentPassword: input.currentPassword
  });

  if (user.email_normalized === normalized.normalized) {
    throw new AccountSecurityError("same_email", "Choose a different email address.", 400);
  }

  const rate = await consumeAccountSecurityRateLimit({
    prisma,
    checks: emailChangeRateLimitChecks(user.id),
    now
  });
  if (!rate.allowed) {
    throw new AccountSecurityError("rate_limited", "Too many email-change requests. Try again later.", 429);
  }

  await assertEmailAvailable({ prisma, normalizedEmail: normalized.normalized, currentUserDbId: user.id });

  const emailProvider = provider(input.context);
  const expiresAt = minutesFromNow(getServerEnv().EMAIL_CHANGE_TOKEN_TTL_MINUTES, now);
  const rawToken = generateAccountSecurityToken();
  const tokenHash = hashAccountSecurityToken(rawToken);

  await invalidateActiveTokens({
    prisma,
    userDbId: user.id,
    purposes: ["teacher_email_change_verification"],
    now
  });
  await prisma.user.update({
    where: { id: user.id },
    data: {
      pending_email: normalized.display,
      pending_email_normalized: normalized.normalized,
      email_change_requested_at: now
    }
  });
  await prisma.accountSecurityToken.create({
    data: {
      token_public_id: generatePublicId("account_security_token"),
      user_db_id: user.id,
      purpose: "teacher_email_change_verification",
      token_hash: tokenHash,
      pending_email_normalized: normalized.normalized,
      expires_at: expiresAt,
      metadata_json: metadata({
        pending_email_hash: safeHash(normalized.normalized)
      })
    }
  });

  const delivery = await sendSecurityEmail({
    emailProvider,
    email: emailChangeVerificationEmail({ to: normalized.display, token: rawToken, expiresAt })
  });

  if (delivery.status !== "sent") {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        pending_email: null,
        pending_email_normalized: null,
        email_change_requested_at: null
      }
    });
    await prisma.accountSecurityToken.updateMany({
      where: { token_hash: tokenHash, used_at: null },
      data: { invalidated_at: now }
    });
    await logDeliveryFailure({ prisma, userDbId: user.id, result: delivery });
    throw new AccountSecurityError(
      "email_delivery_unavailable",
      "Email delivery is temporarily unavailable. Your account information has not been changed.",
      503
    );
  }

  await logSecurityEvent({
    prisma,
    userDbId: user.id,
    performedByUserDbId: user.id,
    eventType: "teacher_email_change_requested",
    status: "sent",
    metadata: {
      pending_email_masked: maskEmail(normalized.display),
      provider: delivery.provider,
      provider_message_id_present: Boolean(delivery.provider_message_id)
    }
  });

  if (user.email) {
    const notify = await sendSecurityEmail({
      emailProvider,
      email: notificationEmail({
        to: user.email,
        subject: "EDPY 507 recovery email change requested",
        action: `A recovery email change was requested for your teacher account. New address: ${maskEmail(normalized.display)}.`
      })
    });
    if (notify.status !== "sent") {
      await logDeliveryFailure({ prisma, userDbId: user.id, result: notify });
    }
  }

  return {
    ok: true as const,
    pending_email: normalized.display,
    masked_pending_email: maskEmail(normalized.display)
  };
}

export async function cancelTeacherEmailChange(input: {
  userDbId: string;
  currentPassword: unknown;
  context?: ServiceContext;
}) {
  const prisma = db(input.context);
  const now = input.context?.now ?? new Date();
  const user = await requireTeacherWithPassword({
    prisma,
    userDbId: input.userDbId,
    currentPassword: input.currentPassword
  });

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: {
        pending_email: null,
        pending_email_normalized: null,
        email_change_requested_at: null
      }
    });
    await invalidateActiveTokens({
      prisma: tx,
      userDbId: user.id,
      purposes: ["teacher_email_change_verification"],
      now
    });
    await logSecurityEvent({
      prisma: tx,
      userDbId: user.id,
      performedByUserDbId: user.id,
      eventType: "teacher_email_change_cancelled",
      status: "completed"
    });
  });

  return { ok: true as const };
}

export async function verifyTeacherEmailChangeToken(input: {
  token: string;
  context?: ServiceContext;
}) {
  if (!input.token || input.token.length < 32) {
    throw new AccountSecurityError("invalid_or_expired_token", "This email verification link is invalid or has expired.", 400);
  }

  const prisma = db(input.context);
  const now = input.context?.now ?? new Date();
  const tokenHash = hashAccountSecurityToken(input.token);
  const token = await prisma.accountSecurityToken.findFirst({
    where: activeTokenWhere(tokenHash, "teacher_email_change_verification", now),
    include: { user: true }
  });

  if (!token || token.user.role !== "teacher_researcher" || !token.pending_email_normalized) {
    throw new AccountSecurityError("invalid_or_expired_token", "This email verification link is invalid or has expired.", 400);
  }

  const pendingEmail = token.user.pending_email;
  const pendingNormalized = token.user.pending_email_normalized;

  if (!pendingEmail || pendingNormalized !== token.pending_email_normalized) {
    throw new AccountSecurityError("invalid_or_expired_token", "This email verification link is invalid or has expired.", 400);
  }

  await assertEmailAvailable({
    prisma,
    normalizedEmail: token.pending_email_normalized,
    currentUserDbId: token.user_db_id
  });

  const oldEmail = token.user.email;
  const updated = await prisma.$transaction(async (tx) => {
    const user = await tx.user.update({
      where: { id: token.user_db_id },
      data: {
        email: pendingEmail,
        email_normalized: token.pending_email_normalized,
        email_verified_at: now,
        pending_email: null,
        pending_email_normalized: null,
        email_change_requested_at: null,
        auth_version: { increment: 1 }
      },
      select: { id: true, user_id: true, email: true }
    });
    await tx.accountSecurityToken.update({
      where: { id: token.id },
      data: { used_at: now }
    });
    await invalidateActiveTokens({
      prisma: tx,
      userDbId: token.user_db_id,
      purposes: ["teacher_password_reset"],
      now
    });
    await logSecurityEvent({
      prisma: tx,
      userDbId: token.user_db_id,
      eventType: "teacher_email_changed",
      status: "completed",
      metadata: {
        old_email_present: Boolean(oldEmail),
        new_email_masked: maskEmail(pendingEmail),
        auth_version_incremented: true
      }
    });
    return user;
  });

  const emailProvider = provider(input.context);
  for (const email of [oldEmail, updated.email].filter(Boolean) as string[]) {
    const delivery = await sendSecurityEmail({
      emailProvider,
      email: notificationEmail({
        to: email,
        subject: "EDPY 507 recovery email changed",
        action: "The recovery email for your teacher account was changed."
      })
    });
    if (delivery.status !== "sent") {
      await logDeliveryFailure({ prisma, userDbId: updated.id, result: delivery });
    }
  }

  return { ok: true as const, user_id: updated.user_id, email: updated.email };
}

export async function changeAuthenticatedTeacherPassword(input: {
  userDbId: string;
  currentPassword: unknown;
  newPassword: unknown;
  confirmNewPassword: unknown;
  context?: ServiceContext;
}) {
  const prisma = db(input.context);
  const now = input.context?.now ?? new Date();
  const user = await requireTeacherWithPassword({
    prisma,
    userDbId: input.userDbId,
    currentPassword: input.currentPassword
  });
  const newPassword = parseStudentPassword(input.newPassword, user.user_id);
  const confirm = z.string().parse(input.confirmNewPassword);

  if (newPassword !== confirm) {
    throw new AccountSecurityError("password_confirmation_mismatch", "Password confirmation does not match.", 400);
  }

  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.user.update({
      where: { id: user.id },
      data: {
        password_hash: await hashSecret(newPassword),
        password_changed_at: now,
        credential_updated_at: now,
        auth_version: { increment: 1 }
      },
      select: {
        id: true,
        user_id: true,
        role: true,
        auth_version: true,
        email: true
      }
    });
    await invalidateActiveTokens({
      prisma: tx,
      userDbId: user.id,
      purposes: ["teacher_password_reset"],
      now
    });
    await logSecurityEvent({
      prisma: tx,
      userDbId: user.id,
      performedByUserDbId: user.id,
      eventType: "teacher_password_changed",
      status: "completed",
      metadata: { auth_version_incremented: true }
    });
    return next;
  });

  if (updated.email) {
    const delivery = await sendSecurityEmail({
      emailProvider: provider(input.context),
      email: notificationEmail({
        to: updated.email,
        subject: "Your EDPY 507 teacher password was changed",
        action: "Your teacher account password was changed."
      })
    });
    if (delivery.status !== "sent") {
      await logDeliveryFailure({ prisma, userDbId: updated.id, result: delivery });
    }
  }

  return updated;
}

export async function setTeacherEmailByOperator(input: {
  username: string;
  email: string;
  markVerified: boolean;
  context?: ServiceContext;
}) {
  const prisma = db(input.context);
  const now = input.context?.now ?? new Date();
  const username = parseOperatorUsername(input.username, "TEACHER_USERNAME");
  const normalized = normalizeTeacherEmail(input.email);
  const teacher = await prisma.user.findUnique({
    where: { user_id_normalized: normalizeUserId(username) },
    select: {
      id: true,
      user_id: true,
      role: true,
      email_normalized: true,
      email_verified_at: true
    }
  });

  if (!teacher) {
    throw new AccountSecurityError("teacher_not_found", "Teacher account was not found.", 404);
  }

  if (teacher.role !== "teacher_researcher") {
    throw new AccountSecurityError("not_teacher_account", "This command can only update teacher/research accounts.", 403);
  }

  if (teacher.email_normalized === normalized.normalized && (input.markVerified ? teacher.email_verified_at : true)) {
    return {
      status: "already_configured" as const,
      user_id: teacher.user_id,
      masked_email: maskEmail(normalized.display)
    };
  }

  await assertEmailAvailable({
    prisma,
    normalizedEmail: normalized.normalized,
    currentUserDbId: teacher.id
  });

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id: teacher.id },
      data: {
        email: normalized.display,
        email_normalized: normalized.normalized,
        email_verified_at: input.markVerified ? now : null,
        pending_email: null,
        pending_email_normalized: null,
        email_change_requested_at: null,
        auth_version: { increment: 1 }
      },
      select: { auth_version: true }
    });
    const invalidatedTokenCount = await invalidateActiveTokens({
      prisma: tx,
      userDbId: teacher.id,
      purposes: ["teacher_password_reset", "teacher_email_change_verification"],
      now
    });
    const audit = await logSecurityEvent({
      prisma: tx,
      userDbId: teacher.id,
      eventType: "teacher_recovery_email_operator_set",
      status: input.markVerified ? "verified" : "unverified",
      metadata: {
        email_masked: maskEmail(normalized.display),
        auth_version_incremented: true,
        invalidated_token_count: invalidatedTokenCount
      }
    });

    return {
      auth_version: updated.auth_version,
      invalidated_token_count: invalidatedTokenCount,
      audit_event_public_id: audit.event_public_id
    };
  });

  return {
    status: "updated" as const,
    user_id: teacher.user_id,
    masked_email: maskEmail(normalized.display),
    verified: input.markVerified,
    auth_version_incremented: true,
    invalidated_token_count: result.invalidated_token_count,
    audit_event_public_id: result.audit_event_public_id
  };
}

export async function updateTeacherAccountByOperator(input: {
  currentUsername: string;
  newUsername: string;
  newEmail?: string | null;
  markEmailVerified?: boolean;
  context?: ServiceContext;
}) {
  const prisma = db(input.context);
  const now = input.context?.now ?? new Date();
  const currentUsername = parseOperatorUsername(input.currentUsername, "CURRENT_TEACHER_USERNAME");
  const newUsername = parseOperatorUsername(input.newUsername, "NEW_TEACHER_USERNAME");
  const currentNormalized = normalizeUserId(currentUsername);
  const newNormalized = normalizeUserId(newUsername);
  const normalizedEmail = input.newEmail ? normalizeTeacherEmail(input.newEmail) : null;

  let teacher = await prisma.user.findUnique({
    where: { user_id_normalized: currentNormalized },
    select: {
      id: true,
      user_id: true,
      user_id_normalized: true,
      role: true,
      email: true,
      email_normalized: true,
      email_verified_at: true,
      password_hash: true,
      auth_version: true
    }
  });
  let alreadyUsingNewUsername = false;

  if (!teacher && currentNormalized !== newNormalized) {
    teacher = await prisma.user.findUnique({
      where: { user_id_normalized: newNormalized },
      select: {
        id: true,
        user_id: true,
        user_id_normalized: true,
        role: true,
        email: true,
        email_normalized: true,
        email_verified_at: true,
        password_hash: true,
        auth_version: true
      }
    });
    alreadyUsingNewUsername = Boolean(teacher);
  }

  if (!teacher) {
    throw new AccountSecurityError("teacher_not_found", "Teacher account was not found.", 404, {
      current_username: currentUsername,
      new_username: newUsername
    });
  }

  if (teacher.role !== "teacher_researcher") {
    throw new AccountSecurityError("not_teacher_account", "This command can only update teacher/research accounts.", 403);
  }

  const emailMatches = normalizedEmail ? teacher.email_normalized === normalizedEmail.normalized : true;
  const verificationMatches =
    input.markEmailVerified === undefined ||
    (input.markEmailVerified ? Boolean(teacher.email_verified_at) : !teacher.email_verified_at);
  const usernameMatches = teacher.user_id_normalized === newNormalized;

  if (alreadyUsingNewUsername && usernameMatches && emailMatches && verificationMatches) {
    return {
      status: "already_configured" as const,
      current_username: currentUsername,
      new_username: teacher.user_id,
      masked_email: maskEmail(normalizedEmail?.display ?? teacher.email),
      verified: Boolean(teacher.email_verified_at),
      auth_version_incremented: false,
      invalidated_token_count: 0,
      audit_event_public_id: null
    };
  }

  if (!usernameMatches) {
    const conflictingUsername = await prisma.user.findUnique({
      where: { user_id_normalized: newNormalized },
      select: { id: true, role: true }
    });
    if (conflictingUsername && conflictingUsername.id !== teacher.id) {
      throw new AccountSecurityError("username_unavailable", "That username cannot be used. Choose another username.", 409, {
        new_username: newUsername,
        existing_role: conflictingUsername.role
      });
    }
  }

  if (normalizedEmail) {
    await assertEmailAvailable({
      prisma,
      normalizedEmail: normalizedEmail.normalized,
      currentUserDbId: teacher.id
    });
  }

  if (usernameMatches && emailMatches && verificationMatches) {
    return {
      status: "already_configured" as const,
      current_username: currentUsername,
      new_username: teacher.user_id,
      masked_email: maskEmail(normalizedEmail?.display ?? teacher.email),
      verified: Boolean(teacher.email_verified_at),
      auth_version_incremented: false,
      invalidated_token_count: 0,
      audit_event_public_id: null
    };
  }

  const updated = await prisma.$transaction(async (tx) => {
    const nextEmailVerifiedAt =
      input.markEmailVerified === undefined
        ? teacher.email_verified_at
        : input.markEmailVerified
          ? now
          : null;

    const next = await tx.user.update({
      where: { id: teacher.id },
      data: {
        user_id: newUsername,
        user_id_normalized: newNormalized,
        ...(normalizedEmail
          ? {
              email: normalizedEmail.display,
              email_normalized: normalizedEmail.normalized,
              email_verified_at: nextEmailVerifiedAt,
              pending_email: null,
              pending_email_normalized: null,
              email_change_requested_at: null
            }
          : {
              email_verified_at: nextEmailVerifiedAt
            }),
        auth_version: { increment: 1 }
      },
      select: {
        id: true,
        user_id: true,
        email: true,
        email_verified_at: true,
        auth_version: true,
        password_hash: true,
        role: true
      }
    });
    const invalidatedTokenCount = await invalidateActiveTokens({
      prisma: tx,
      userDbId: teacher.id,
      purposes: ["teacher_password_reset", "teacher_email_change_verification"],
      now
    });
    const audit = await logSecurityEvent({
      prisma: tx,
      userDbId: teacher.id,
      eventType: "teacher_account_operator_updated",
      status: "completed",
      metadata: {
        old_username: teacher.user_id,
        new_username: next.user_id,
        email_updated: Boolean(normalizedEmail),
        email_masked: maskEmail(next.email),
        email_verified: Boolean(next.email_verified_at),
        auth_version_incremented: true,
        invalidated_token_count: invalidatedTokenCount
      }
    });

    return {
      user: next,
      invalidated_token_count: invalidatedTokenCount,
      audit_event_public_id: audit.event_public_id
    };
  });

  return {
    status: "updated" as const,
    current_username: currentUsername,
    new_username: updated.user.user_id,
    masked_email: maskEmail(updated.user.email),
    verified: Boolean(updated.user.email_verified_at),
    auth_version_incremented: true,
    invalidated_token_count: updated.invalidated_token_count,
    audit_event_public_id: updated.audit_event_public_id
  };
}

export function publicAccountSecurityError(error: unknown) {
  if (error instanceof AccountSecurityError) {
    return {
      code: error.code,
      message: error.message,
      status: error.status,
      details: error.safeDetails
    };
  }

  return {
    code: "account_security_unavailable",
    message: "Account security is temporarily unavailable.",
    status: 503,
    details: {}
  };
}

export function teacherUserToPublicSession(user: Pick<User, "id" | "user_id" | "role" | "auth_version">) {
  return {
    user_db_id: user.id,
    user_id: user.user_id,
    role: user.role,
    auth_version: user.auth_version
  };
}
