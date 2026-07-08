import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getServerEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

function environmentName() {
  return process.env.APP_ENV || process.env.NODE_ENV || "unknown";
}

export async function GET() {
  const checkedAt = new Date().toISOString();

  try {
    getServerEnv();
    await prisma.$queryRaw`SELECT 1`;

    return NextResponse.json({
      app: "conversational-mcq",
      status: "ok",
      database_reachable: true,
      migration_readiness: "verify_with_prisma_migrate_status",
      llm_readiness: "verify_with_npm_run_llm_readiness",
      environment: environmentName(),
      server_time: checkedAt
    });
  } catch {
    return NextResponse.json(
      {
        app: "conversational-mcq",
        status: "error",
        database_reachable: false,
        migration_readiness: "unverified",
        llm_readiness: "verify_with_npm_run_llm_readiness",
        environment: environmentName(),
        server_time: checkedAt
      },
      { status: 503 }
    );
  }
}
