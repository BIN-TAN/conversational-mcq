import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getServerEnv } from "@/lib/env";

export async function GET() {
  try {
    getServerEnv();
    await prisma.$queryRaw`SELECT 1`;

    return NextResponse.json({
      status: "ok",
      database: "ok"
    });
  } catch {
    return NextResponse.json(
      {
        status: "error",
        database: "unavailable"
      },
      { status: 503 }
    );
  }
}
