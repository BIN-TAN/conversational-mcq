import { NextResponse } from "next/server";
import { z } from "zod";
import { createSessionToken, setSessionCookie, toClientUser, toPublicUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { jsonError } from "@/lib/http";
import { verifySecret } from "@/lib/password";
import { normalizeUserId } from "@/lib/services/student-accounts/validation";

const loginSchema = z
  .object({
    user_id: z.string().min(1),
    password: z.string().min(1).optional(),
    access_code: z.string().min(1).optional()
  })
  .refine((value) => value.password || value.access_code, {
    message: "A password or access code is required."
  });

export async function POST(request: Request) {
  let payload: z.infer<typeof loginSchema>;

  try {
    payload = loginSchema.parse(await request.json());
  } catch {
    return jsonError("Invalid login payload.", 400);
  }

  try {
    const normalizedUserId = normalizeUserId(payload.user_id);
    const user = await prisma.user.findUnique({
      where: { user_id_normalized: normalizedUserId },
      select: {
        id: true,
        user_id: true,
        role: true,
        password_hash: true,
        access_code_hash: true,
        account_status: true,
        auth_version: true,
        must_change_password: true
      }
    });

    if (!user) {
      return jsonError("Invalid user ID or access code.", 401);
    }

    const passwordMatches = payload.password
      ? await verifySecret(payload.password, user.password_hash)
      : false;
    const accessCodeMatches = payload.access_code
      ? await verifySecret(payload.access_code, user.access_code_hash)
      : false;

    const isAllowed =
      user.role === "teacher_researcher" ? passwordMatches : passwordMatches || accessCodeMatches;

    if (!isAllowed) {
      return jsonError("Invalid user ID or access code.", 401);
    }

    if (user.role === "student" && user.account_status !== "active") {
      return jsonError("This account is currently unavailable.", 403);
    }

    const publicUser = toPublicUser(user);
    const response = NextResponse.json({ user: toClientUser(publicUser) });
    setSessionCookie(response, createSessionToken(publicUser));
    await prisma.user.update({
      where: { id: user.id },
      data: { last_login_at: new Date() }
    });

    return response;
  } catch {
    return jsonError("Login is unavailable. Check database and environment configuration.", 503);
  }
}
