import { access, mkdir } from "node:fs/promises";
import { constants } from "node:fs";
import { prisma } from "@/lib/db";
import { exportStorageDirectory } from "@/lib/services/master-export/storage";
import {
  buildAnalysisReadyDictionaryEntries,
  buildProcessEventCodebookEntries,
  buildInternalSchemaAppendixEntries,
  buildExcludedPlatformVariableEntries,
  ANALYSIS_READY_EXPORT_VERSION
} from "./dictionary";
import {
  RESEARCH_PSEUDONYMIZATION_HMAC_VERSION,
  ResearchPseudonymizationConfigError,
  researchPseudonymizationMetadata
} from "./pseudonymization";

export const RESEARCH_EXPORT_READINESS_VERSION = "research-export-readiness-v1" as const;

export type ResearchExportReadiness = {
  ready: boolean;
  environment: string;
  pseudonymization_method: "HMAC-SHA-256" | "legacy namespace SHA-256" | "unavailable";
  pseudonymization_version: string;
  key_configured: boolean;
  safe_key_fingerprint: string | null;
  required_configuration: string[];
  blocking_reasons: Array<{ code: string; label: string; operator_action: string }>;
  warnings: string[];
  export_schema_version: string;
  readiness_version: typeof RESEARCH_EXPORT_READINESS_VERSION;
  artifact_path_writable: boolean;
  database_ready: boolean;
  dictionary_registry_ready: boolean;
  restricted_export_authorization_supported: boolean;
};

function environment(env: NodeJS.ProcessEnv) {
  return env.APP_ENV?.trim() || env.NODE_ENV?.trim() || "local";
}

function keyConfigured(env: NodeJS.ProcessEnv) {
  return Boolean(env.RESEARCH_PSEUDONYMIZATION_KEY?.trim());
}

function reasonForConfigError(error: ResearchPseudonymizationConfigError) {
  switch (error.code) {
    case "research_pseudonymization_key_missing":
      return {
        code: error.code,
        label: "Missing RESEARCH_PSEUDONYMIZATION_KEY",
        operator_action: "Set RESEARCH_PSEUDONYMIZATION_KEY on the server and rerun the export."
      };
    case "research_pseudonymization_key_inadequate":
      return {
        code: error.code,
        label: "RESEARCH_PSEUDONYMIZATION_KEY is too short",
        operator_action: "Set a longer random server-side research pseudonymization key."
      };
    case "research_pseudonymization_version_invalid":
      return {
        code: error.code,
        label: "Invalid RESEARCH_PSEUDONYMIZATION_VERSION",
        operator_action: "Use hmac_sha256_v1 for production research exports."
      };
    case "legacy_pseudonymization_not_allowed_in_production":
      return {
        code: error.code,
        label: "Legacy pseudonymization is not allowed in production",
        operator_action: "Use hmac_sha256_v1 with a server-side key."
      };
  }
}

async function artifactPathWritable() {
  try {
    await mkdir(exportStorageDirectory(), { recursive: true });
    await access(exportStorageDirectory(), constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

async function databaseReady() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

function dictionaryRegistryReady() {
  return (
    buildAnalysisReadyDictionaryEntries().length > 0 &&
    buildProcessEventCodebookEntries().length > 0 &&
    buildInternalSchemaAppendixEntries().length > 0 &&
    buildExcludedPlatformVariableEntries().length > 0
  );
}

export async function getResearchExportReadiness(
  env: NodeJS.ProcessEnv = process.env
): Promise<ResearchExportReadiness> {
  const blocking_reasons: ResearchExportReadiness["blocking_reasons"] = [];
  const warnings: string[] = [];
  let pseudonymization_method: ResearchExportReadiness["pseudonymization_method"] = "unavailable";
  let pseudonymization_version: string = RESEARCH_PSEUDONYMIZATION_HMAC_VERSION;
  let safe_key_fingerprint: string | null = null;

  try {
    const metadata = researchPseudonymizationMetadata(env);
    pseudonymization_method = metadata.pseudonymization_method;
    pseudonymization_version = metadata.research_pseudonym_version;
    safe_key_fingerprint = metadata.pseudonymization_key_fingerprint;
    if (!metadata.production_ready) {
      warnings.push("Using non-production deterministic pseudonymization configuration.");
    }
  } catch (error) {
    if (error instanceof ResearchPseudonymizationConfigError) {
      blocking_reasons.push(reasonForConfigError(error));
      pseudonymization_version = env.RESEARCH_PSEUDONYMIZATION_VERSION?.trim() || RESEARCH_PSEUDONYMIZATION_HMAC_VERSION;
    } else {
      blocking_reasons.push({
        code: "research_export_configuration_unreadable",
        label: "Research export configuration could not be read",
        operator_action: "Check server environment configuration and application logs."
      });
    }
  }

  const [artifact_path_writable, database_ready] = await Promise.all([
    artifactPathWritable(),
    databaseReady()
  ]);
  const dictionary_registry_ready = dictionaryRegistryReady();

  if (!artifact_path_writable) {
    blocking_reasons.push({
      code: "research_export_artifact_path_unwritable",
      label: "Research export artifact path is not writable",
      operator_action: "Verify the server can write to the configured export artifact directory."
    });
  }
  if (!database_ready) {
    blocking_reasons.push({
      code: "research_export_database_unavailable",
      label: "Database is unavailable",
      operator_action: "Verify database connectivity before generating research exports."
    });
  }
  if (!dictionary_registry_ready) {
    blocking_reasons.push({
      code: "research_export_dictionary_registry_unavailable",
      label: "Research export registry is unavailable",
      operator_action: "Verify research dictionary/export registry initialization."
    });
  }

  return {
    ready: blocking_reasons.length === 0,
    environment: environment(env),
    pseudonymization_method,
    pseudonymization_version,
    key_configured: keyConfigured(env),
    safe_key_fingerprint,
    required_configuration: ["RESEARCH_PSEUDONYMIZATION_KEY"],
    blocking_reasons,
    warnings,
    export_schema_version: ANALYSIS_READY_EXPORT_VERSION,
    readiness_version: RESEARCH_EXPORT_READINESS_VERSION,
    artifact_path_writable,
    database_ready,
    dictionary_registry_ready,
    restricted_export_authorization_supported: true
  };
}
