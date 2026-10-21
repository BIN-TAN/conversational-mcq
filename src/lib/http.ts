import { NextResponse } from "next/server";
import type { AppRole, PublicUser } from "@/types/auth";
import { getCurrentUser } from "@/lib/auth";

export function jsonError(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

export function jsonApiError(
  code: string,
  message: string,
  status: number,
  details: Record<string, unknown> = {}
): NextResponse {
  return NextResponse.json({ error: { code, message, details } }, { status });
}

export async function requireRole(role: AppRole): Promise<
  | {
      ok: true;
      user: PublicUser;
    }
  | {
      ok: false;
      response: NextResponse;
    }
> {
  const user = await getCurrentUser();

  if (!user) {
    return { ok: false, response: jsonError("Unauthorized", 401) };
  }

  if (user.role !== role) {
    return { ok: false, response: jsonError("Forbidden", 403) };
  }

  return { ok: true, user };
}

export async function requireRoleApi(role: AppRole): Promise<
  | {
      ok: true;
      user: PublicUser;
    }
  | {
      ok: false;
      response: NextResponse;
    }
> {
  const user = await getCurrentUser();

  if (!user) {
    return {
      ok: false,
      response: jsonApiError("unauthorized", "You are not signed in, or your sign-in has expired. Please sign in again.", 401)
    };
  }

  if (user.role !== role) {
    return {
      ok: false,
      response: jsonApiError("forbidden", "This page is for a different kind of account. Sign in with the right account to continue.", 403)
    };
  }

  return { ok: true, user };
}
