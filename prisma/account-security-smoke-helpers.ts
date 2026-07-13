import { PrismaClient, type User } from "@prisma/client";
import { hashSecret } from "../src/lib/password";
import type {
  AccountSecurityEmail,
  AccountSecurityEmailProvider,
  AccountSecurityEmailResult
} from "../src/lib/services/account-security/email-provider";
import { normalizeTeacherEmail } from "../src/lib/services/account-security/email";
import { normalizeUserId } from "../src/lib/services/student-accounts/validation";

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

export class MockAccountSecurityEmailProvider implements AccountSecurityEmailProvider {
  readonly providerName = "mock";
  readonly messages: AccountSecurityEmail[] = [];

  async send(message: AccountSecurityEmail): Promise<AccountSecurityEmailResult> {
    this.messages.push(message);
    return {
      status: "sent",
      provider: "mock",
      provider_message_id: `mock_message_${this.messages.length}`
    };
  }

  reset() {
    this.messages.splice(0, this.messages.length);
  }
}

export function latestTokenFromProvider(provider: MockAccountSecurityEmailProvider, purpose: "reset" | "verify") {
  const marker = purpose === "reset" ? "/auth/reset-password?token=" : "/teacher/account/verify-email?token=";
  const message = provider.messages
    .slice()
    .reverse()
    .find((candidate) => candidate.text.includes(marker));
  assert(message, `Expected a ${purpose} email to be captured.`);
  const markerIndex = message.text.indexOf(marker);
  assert(markerIndex >= 0, `Expected a ${purpose} token link in the mock email.`);
  const tokenStart = markerIndex + marker.length;
  const token = message.text.slice(tokenStart).split(/\s/u)[0];
  assert(token, `Expected a ${purpose} token link in the mock email.`);
  return decodeURIComponent(token);
}

export async function cleanupAccountSecuritySmokeUsers(prisma: PrismaClient, prefix: string) {
  const users = await prisma.user.findMany({
    where: { user_id: { startsWith: prefix } },
    select: { id: true }
  });
  const userIds = users.map((user) => user.id);
  if (userIds.length === 0) {
    return;
  }

  await prisma.accountSecurityToken.deleteMany({ where: { user_db_id: { in: userIds } } });
  await prisma.accountSecurityEvent.deleteMany({
    where: {
      OR: [
        { user_db_id: { in: userIds } },
        { performed_by_user_db_id: { in: userIds } }
      ]
    }
  });
  await prisma.studentAccountEvent.deleteMany({
    where: {
      OR: [
        { student_user_db_id: { in: userIds } },
        { performed_by_user_db_id: { in: userIds } }
      ]
    }
  });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

export async function createSmokeTeacher(input: {
  prisma: PrismaClient;
  userId: string;
  password: string;
  email?: string;
  verified?: boolean;
}) {
  const normalizedEmail = input.email ? normalizeTeacherEmail(input.email) : null;
  return input.prisma.user.create({
    data: {
      id: crypto.randomUUID(),
      user_id: input.userId,
      user_id_normalized: normalizeUserId(input.userId),
      display_name: "Account Security Smoke Teacher",
      role: "teacher_researcher",
      account_status: "active",
      auth_version: 1,
      password_hash: await hashSecret(input.password),
      credential_updated_at: new Date(),
      email: normalizedEmail?.display ?? null,
      email_normalized: normalizedEmail?.normalized ?? null,
      email_verified_at: normalizedEmail && input.verified !== false ? new Date() : null
    }
  });
}

export async function createSmokeStudent(input: {
  prisma: PrismaClient;
  userId: string;
  password: string;
  email?: string;
  teacher?: User;
}) {
  const normalizedEmail = input.email ? normalizeTeacherEmail(input.email) : null;
  return input.prisma.user.create({
    data: {
      id: crypto.randomUUID(),
      user_id: input.userId,
      user_id_normalized: normalizeUserId(input.userId),
      display_name: "Account Security Smoke Student",
      role: "student",
      account_status: "active",
      auth_version: 1,
      must_change_password: true,
      password_hash: await hashSecret(input.password),
      credential_updated_at: new Date(),
      email: normalizedEmail?.display ?? null,
      email_normalized: normalizedEmail?.normalized ?? null,
      email_verified_at: normalizedEmail ? new Date() : null,
      created_by_teacher_user_id: input.teacher?.id ?? null
    }
  });
}

export function accountSecuritySmokePrefix(label: string) {
  return `${label}_${Date.now().toString(36)}_`;
}
