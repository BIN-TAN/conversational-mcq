import { PrismaClient, type Prisma } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  prismaByDatasource?: Record<string, PrismaClient>;
};

function prismaLogLevels(): Prisma.LogLevel[] {
  return process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"];
}

function operationalLiveCanaryDatasourceUrl() {
  if (process.env.OPERATIONAL_LIVE_CANARY_DATABASE_URL_ACTIVE !== "true") {
    return undefined;
  }

  return process.env.OPERATIONAL_LIVE_CANARY_DATABASE_URL?.trim() || undefined;
}

const datasourceUrl = operationalLiveCanaryDatasourceUrl();
const cacheKey = datasourceUrl ? `datasource:${datasourceUrl}` : "default";
const cachedPrisma = datasourceUrl
  ? globalForPrisma.prismaByDatasource?.[cacheKey]
  : globalForPrisma.prisma;

export const prisma =
  cachedPrisma ??
  new PrismaClient({
    ...(datasourceUrl
      ? {
          datasources: {
            db: {
              url: datasourceUrl
            }
          }
        }
      : {}),
    log: prismaLogLevels()
  });

if (process.env.NODE_ENV !== "production") {
  if (datasourceUrl) {
    globalForPrisma.prismaByDatasource ??= {};
    globalForPrisma.prismaByDatasource[cacheKey] = prisma;
  } else {
    globalForPrisma.prisma = prisma;
  }
}
