import { NextResponse } from "next/server";
import { z } from "zod";
import { createSessionToken, setSessionCookie, toClientUser, toPublicUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { jsonError } from "@/lib/http";
import { verifySecret } from "@/lib/password";

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
    const user = await prisma.user.findUnique({
      where: { user_id: payload.user_id },
      select: {
        id: true,
        user_id: true,
        role: true,
        password_hash: true,
        access_code_hash: true
      }
    });

    if (!user) {
      return jsonError("Invalid credentials.", 401);
    }

    const passwordMatches = payload.password
      ? await verifySecret(payload.password, user.password_hash)
      : false;
    const accessCodeMatches = payload.access_code
      ? await verifySecret(payload.access_code, user.access_code_hash)
      : false;

    const isAllowed =
      user.role === "teacher_researcher"
        ? passwordMatches
        : passwordMatches || accessCodeMatches;

    if (!isAllowed) {
      return jsonError("Invalid credentials.", 401);
    }

    const publicUser = toPublicUser(user);
    const response = NextResponse.json({ user: toClientUser(publicUser) });
    setSessionCookie(response, createSessionToken(publicUser));

    return response;
  } catch {
    return jsonError("Login is unavailable. Check database and environment configuration.", 503);
  }
}
