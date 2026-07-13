import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getServerEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

function environmentName() {
  return process.env.APP_ENV || process.env.NODE_ENV || "unknown";
}

async function productionSchemaReady() {
  const requiredUserColumns = [
    "email_normalized",
    "email_verified_at",
    "pending_email",
    "pending_email_normalized",
    "email_change_requested_at"
  ];
  const requiredTables = [
    "account_security_tokens",
    "account_security_rate_limits",
    "account_security_events"
  ];
  const [userColumns, securityTables] = await Promise.all([
    prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'users'
        AND column_name IN ('email_normalized', 'email_verified_at', 'pending_email', 'pending_email_normalized', 'email_change_requested_at')
    `,
    prisma.$queryRaw<Array<{ table_name: string }>>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('account_security_tokens', 'account_security_rate_limits', 'account_security_events')
    `
  ]);
  const existingColumns = new Set(userColumns.map((column) => column.column_name));
  const existingTables = new Set(securityTables.map((table) => table.table_name));

  return (
    requiredUserColumns.every((column) => existingColumns.has(column)) &&
    requiredTables.every((table) => existingTables.has(table))
  );
}

export async function GET() {
  const checkedAt = new Date().toISOString();

  try {
    getServerEnv();
    await prisma.$queryRaw`SELECT 1`;
    const databaseSchemaReady = await productionSchemaReady();

    return NextResponse.json(
      {
      app: "conversational-mcq",
      status: databaseSchemaReady ? "ok" : "not_ready",
      database_reachable: true,
      database_schema_ready: databaseSchemaReady,
      migration_readiness: databaseSchemaReady ? "ready" : "migration_required",
      llm_readiness: "verify_with_npm_run_llm_readiness",
      environment: environmentName(),
      server_time: checkedAt
      },
      { status: databaseSchemaReady ? 200 : 503 }
    );
  } catch (error) {
    console.error("health_check_failed", {
      code: "database_or_environment_unavailable",
      error_name: error instanceof Error ? error.name : "unknown"
    });
    return NextResponse.json(
      {
        app: "conversational-mcq",
        status: "error",
        database_reachable: false,
        database_schema_ready: false,
        migration_readiness: "unverified",
        llm_readiness: "verify_with_npm_run_llm_readiness",
        environment: environmentName(),
        server_time: checkedAt
      },
      { status: 503 }
    );
  }
}
