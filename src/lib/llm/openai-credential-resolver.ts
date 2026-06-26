import { createHash } from "node:crypto";
import { statSync, readFileSync } from "node:fs";
import path from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";

export const OPENAI_CREDENTIAL_RESOLVER_VERSION = "openai-credential-resolver-v1";

export type OpenAICredentialSource =
  | "environment"
  | "file"
  | "matching_environment_and_file";

export type PublicOpenAICredentialResolution = {
  source: OpenAICredentialSource;
  fingerprint: string;
  fingerprint_prefix: string;
  length: number;
  asciiOnly: boolean;
  embeddedWhitespace: boolean;
  basicShapeValid: boolean;
  resolver_version: typeof OPENAI_CREDENTIAL_RESOLVER_VERSION;
};

export type ResolvedOpenAICredential = PublicOpenAICredentialResolution & {
  credential: string;
};

export type OpenAICredentialResolution =
  | {
      ok: true;
      credential: ResolvedOpenAICredential;
    }
  | {
      ok: false;
      code:
        | "credential_missing"
        | "credential_file_unreadable"
        | "credential_file_permissions_insecure"
        | "credential_source_conflict"
        | "credential_embedded_whitespace"
        | "credential_control_character"
        | "credential_non_ascii"
        | "credential_bom_or_zero_width"
        | "credential_surrounding_quotes"
        | "credential_malformed_prefix";
      message: string;
      source: "none" | "environment" | "file" | "environment_and_file" | "matching_environment_and_file";
      public_resolution?: Partial<PublicOpenAICredentialResolution>;
    };

const credentialStorage = new AsyncLocalStorage<ResolvedOpenAICredential>();

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function present(value: string | undefined) {
  return typeof value === "string" && value.length > 0;
}

function stripOneTrailingLineEnding(value: string) {
  if (value.endsWith("\r\n")) {
    return value.slice(0, -2);
  }
  if (value.endsWith("\n")) {
    return value.slice(0, -1);
  }
  return value;
}

function readCredentialFile(filePath: string) {
  const resolved = path.resolve(filePath);
  let stat;
  try {
    stat = statSync(resolved);
  } catch {
    return {
      ok: false as const,
      code: "credential_file_unreadable" as const,
      message: "OPENAI_API_KEY_FILE could not be read."
    };
  }

  if (process.platform !== "win32" && (stat.mode & 0o077) !== 0) {
    return {
      ok: false as const,
      code: "credential_file_permissions_insecure" as const,
      message: "OPENAI_API_KEY_FILE must not be group/world readable."
    };
  }

  try {
    return { ok: true as const, value: stripOneTrailingLineEnding(readFileSync(resolved, "utf8")) };
  } catch {
    return {
      ok: false as const,
      code: "credential_file_unreadable" as const,
      message: "OPENAI_API_KEY_FILE could not be read."
    };
  }
}

function validateCredential(value: string, source: OpenAICredentialSource): OpenAICredentialResolution {
  const fingerprint = sha256(value);
  const publicResolution: PublicOpenAICredentialResolution = {
    source,
    fingerprint,
    fingerprint_prefix: fingerprint.slice(0, 12),
    length: value.length,
    asciiOnly: /^[\x00-\x7F]*$/.test(value),
    embeddedWhitespace: /\s/.test(value),
    basicShapeValid: /^sk-[A-Za-z0-9_-]{20,}$/.test(value),
    resolver_version: OPENAI_CREDENTIAL_RESOLVER_VERSION
  };

  if (/^\uFEFF/.test(value) || /[\u200B-\u200D\u2060\uFEFF]/u.test(value)) {
    return {
      ok: false,
      code: "credential_bom_or_zero_width",
      message: "OpenAI credential contains a BOM or zero-width character.",
      source,
      public_resolution: publicResolution
    };
  }
  if (!publicResolution.asciiOnly) {
    return {
      ok: false,
      code: "credential_non_ascii",
      message: "OpenAI credential contains non-ASCII characters.",
      source,
      public_resolution: publicResolution
    };
  }
  if (/[\x00-\x1F\x7F]/.test(value)) {
    return {
      ok: false,
      code: "credential_control_character",
      message: "OpenAI credential contains control characters.",
      source,
      public_resolution: publicResolution
    };
  }
  if (publicResolution.embeddedWhitespace) {
    return {
      ok: false,
      code: "credential_embedded_whitespace",
      message: "OpenAI credential contains whitespace.",
      source,
      public_resolution: publicResolution
    };
  }
  if (/^['"`]|['"`]$/.test(value)) {
    return {
      ok: false,
      code: "credential_surrounding_quotes",
      message: "OpenAI credential must not be surrounded by quotes.",
      source,
      public_resolution: publicResolution
    };
  }
  if (!publicResolution.basicShapeValid) {
    return {
      ok: false,
      code: "credential_malformed_prefix",
      message: "OpenAI credential must use the expected server-side key prefix shape.",
      source,
      public_resolution: publicResolution
    };
  }

  return {
    ok: true,
    credential: {
      ...publicResolution,
      credential: value
    }
  };
}

export function publicOpenAICredentialResolution(
  credential: ResolvedOpenAICredential
): PublicOpenAICredentialResolution {
  return {
    source: credential.source,
    fingerprint: credential.fingerprint,
    fingerprint_prefix: credential.fingerprint_prefix,
    length: credential.length,
    asciiOnly: credential.asciiOnly,
    embeddedWhitespace: credential.embeddedWhitespace,
    basicShapeValid: credential.basicShapeValid,
    resolver_version: credential.resolver_version
  };
}

export function resolveOpenAICredentialFromEnv(env: NodeJS.ProcessEnv = process.env): OpenAICredentialResolution {
  const environmentValue = env.OPENAI_API_KEY;
  const filePath = env.OPENAI_API_KEY_FILE;
  const envPresent = present(environmentValue);
  const filePresent = present(filePath);

  if (!envPresent && !filePresent) {
    return {
      ok: false,
      code: "credential_missing",
      message: "Neither OPENAI_API_KEY nor OPENAI_API_KEY_FILE is configured.",
      source: "none"
    };
  }

  let fileValue: string | null = null;
  if (filePresent) {
    const fileRead = readCredentialFile(filePath!);
    if (!fileRead.ok) {
      return {
        ok: false,
        code: fileRead.code,
        message: fileRead.message,
        source: envPresent ? "environment_and_file" : "file"
      };
    }
    fileValue = fileRead.value;
  }

  if (envPresent && fileValue !== null) {
    const envFingerprint = sha256(environmentValue!);
    const fileFingerprint = sha256(fileValue);
    if (envFingerprint !== fileFingerprint) {
      return {
        ok: false,
        code: "credential_source_conflict",
        message: "OPENAI_API_KEY and OPENAI_API_KEY_FILE resolve to different credentials.",
        source: "environment_and_file",
        public_resolution: {
          source: "matching_environment_and_file",
          fingerprint: envFingerprint,
          fingerprint_prefix: envFingerprint.slice(0, 12),
          length: environmentValue!.length
        }
      };
    }
    return validateCredential(environmentValue!, "matching_environment_and_file");
  }

  return validateCredential(envPresent ? environmentValue! : fileValue!, envPresent ? "environment" : "file");
}

export function currentResolvedOpenAICredential() {
  return credentialStorage.getStore() ?? null;
}

export async function withResolvedOpenAICredential<T>(
  credential: ResolvedOpenAICredential,
  callback: () => Promise<T>
): Promise<T> {
  return credentialStorage.run(credential, callback);
}
