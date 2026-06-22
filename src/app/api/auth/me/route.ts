import { NextResponse } from "next/server";
import { getCurrentUser, toClientUser } from "@/lib/auth";

export async function GET() {
  const user = await getCurrentUser();

  return NextResponse.json({ user: user ? toClientUser(user) : null });
}
