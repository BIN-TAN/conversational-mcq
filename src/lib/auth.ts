import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthEnv } from "@/lib/env";
import type { AppRole, ClientUser, PublicUser } from "@/types/auth";

export const SESSION_COOKIE_NAME = "cmcq_session";
const SESSION_TTL_SECONDS = 60 * 60 * 8;

type SessionClaims = {
  user_db_id: string;
  user_id: string;
  role: AppRole;
  auth_version: number;
  iat: number;
  exp: number;
};

function encodeBase64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decodeBase64Url(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function signaturesMatch(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);

  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

export function toPublicUser(user: {
  id: string;
  user_id: string;
  role: AppRole;
  auth_version: number;
  must_change_password?: boolean;
}): PublicUser {
  return {
    user_db_id: user.id,
    user_id: user.user_id,
    role: user.role,
    auth_version: user.auth_version,
    must_change_password: user.role === "student" ? Boolean(user.must_change_password) : undefined
  };
}

export function toClientUser(user: PublicUser): ClientUser {
  return {
    user_id: user.user_id,
    role: user.role,
    must_change_password: user.role === "student" ? Boolean(user.must_change_password) : undefined
  };
}

export function createSessionToken(user: PublicUser): string {
  const env = getAuthEnv();
  const now = Math.floor(Date.now() / 1000);
  const claims: SessionClaims = {
    user_db_id: user.user_db_id,
    user_id: user.user_id,
    role: user.role,
    auth_version: user.auth_version,
    iat: now,
    exp: now + SESSION_TTL_SECONDS
  };
  const payload = encodeBase64Url(JSON.stringify(claims));
  const signature = sign(payload, env.SESSION_SECRET);

  return `${payload}.${signature}`;
}

export function verifySessionToken(token?: string): SessionClaims | null {
  if (!token) {
    return null;
  }

  const env = getAuthEnv();
  const [payload, signature] = token.split(".");

  if (!payload || !signature) {
    return null;
  }

  const expectedSignature = sign(payload, env.SESSION_SECRET);

  if (!signaturesMatch(signature, expectedSignature)) {
    return null;
  }

  try {
    const claims = JSON.parse(decodeBase64Url(payload)) as SessionClaims;
    const now = Math.floor(Date.now() / 1000);

    if (!claims.exp || claims.exp < now) {
      return null;
    }

    return claims;
  } catch {
    return null;
  }
}

export function setSessionCookie(response: NextResponse, token: string): void {
  response.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS
  });
}

export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0
  });
}

export async function getUserForSessionToken(token?: string): Promise<PublicUser | null> {
  const claims = verifySessionToken(token);

  if (!claims) {
    return null;
  }

  const user = await prisma.user
    .findUnique({
      where: { id: claims.user_db_id },
      select: {
        id: true,
        user_id: true,
        role: true,
        account_status: true,
        auth_version: true,
        must_change_password: true
      }
    })
    .catch(() => null);

  if (
    !user ||
    user.user_id !== claims.user_id ||
    user.role !== claims.role ||
    user.auth_version !== claims.auth_version ||
    (user.role === "student" && user.account_status !== "active")
  ) {
    return null;
  }

  return toPublicUser(user);
}

export async function getCurrentUser(): Promise<PublicUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  return getUserForSessionToken(token);
}
