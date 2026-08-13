import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  unlink
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip, { type JSZipObject } from "jszip";
import { z } from "zod";
import { stableHash } from "@/lib/operational/stable-hash";

export const FORMATIVE_CONVERSATION_V18R1_CONTROL_SCHEMA_VERSION =
  "formative-conversation-v18r1-artifact-control-v1" as const;
export const FORMATIVE_CONVERSATION_V18R1_ARTIFACT_MANIFEST_VERSION =
  "formative-conversation-v18r1-finalized-artifact-manifest-v1" as const;
export const FORMATIVE_CONVERSATION_V18R1_PREVENTIVE_SCANNER_VERSION =
  "formative-conversation-v18r1-preventive-artifact-scanner-v1" as const;
export const FORMATIVE_CONVERSATION_V18R1_SCAN_ATTESTATION_VERSION =
  "formative-conversation-v18r1-preventive-scan-attestation-v1" as const;
export const FORMATIVE_CONVERSATION_V18R1_RELEASE_POLICY_VERSION =
  "formative-conversation-v18r1-owner-only-atomic-release-v1" as const;
export const FORMATIVE_CONVERSATION_V18R1_SECURITY_WRAPPER_VERSION =
  "formative-conversation-v18r1-security-wrapper-v1" as const;

export const FORMATIVE_CONVERSATION_V18R1_SECURITY_WRAPPER_SOURCE_PATHS = [
  "scripts/operational-formative-conversation-v5-v18r1-process-local-runner.mjs",
  "scripts/operational-formative-conversation-v5-v18r1-launcher.mjs",
  "prisma/operational-formative-conversation-v5-v18r1-evaluate.ts",
  "src/lib/operational/formative-conversation-v5-evaluation-v18r1/security-release.ts",
  "src/lib/operational/formative-conversation-v5-evaluation-v18r1/service.ts",
  "src/lib/operational/formative-conversation-v5-evaluation-v18r1/deployed-provenance.ts"
] as const;

export function formativeConversationV18SecurityWrapperFingerprint(
  fileSha256ByPath: Readonly<Record<string, string>>
) {
  const files = FORMATIVE_CONVERSATION_V18R1_SECURITY_WRAPPER_SOURCE_PATHS.map(
    (sourcePath) => ({
      path: sourcePath,
      sha256: HashSchema.parse(fileSha256ByPath[sourcePath])
    })
  );
  return stableHash({
    wrapper_version: FORMATIVE_CONVERSATION_V18R1_SECURITY_WRAPPER_VERSION,
    control_schema_version: FORMATIVE_CONVERSATION_V18R1_CONTROL_SCHEMA_VERSION,
    artifact_manifest_version:
      FORMATIVE_CONVERSATION_V18R1_ARTIFACT_MANIFEST_VERSION,
    scanner_version: FORMATIVE_CONVERSATION_V18R1_PREVENTIVE_SCANNER_VERSION,
    release_policy_version: FORMATIVE_CONVERSATION_V18R1_RELEASE_POLICY_VERSION,
    attestation_version: FORMATIVE_CONVERSATION_V18R1_SCAN_ATTESTATION_VERSION,
    attestation_schema_fingerprint:
      FORMATIVE_CONVERSATION_V18R1_SCAN_ATTESTATION_SCHEMA_FINGERPRINT,
    files
  });
}

export const FORMATIVE_CONVERSATION_V18R1_DATA_ROOT =
  ".data/operational-formative-conversation-v5-evaluation-v18r1";
export const FORMATIVE_CONVERSATION_V18R1_STAGING_ROOT =
  `${FORMATIVE_CONVERSATION_V18R1_DATA_ROOT}/staging`;
export const FORMATIVE_CONVERSATION_V18R1_RELEASE_ROOT =
  `${FORMATIVE_CONVERSATION_V18R1_DATA_ROOT}/runs`;
export const FORMATIVE_CONVERSATION_V18R1_FAILURE_ROOT =
  `${FORMATIVE_CONVERSATION_V18R1_DATA_ROOT}/quarantine/failures`;
export const FORMATIVE_CONVERSATION_V18R1_ATTESTATION_FILENAME =
  "artifact-scan-attestation.json";
export const FORMATIVE_CONVERSATION_V18R1_MANIFEST_FILENAME =
  "finalized-artifact-manifest.json";

const HashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const NonEmptyRelativePathSchema = z
  .string()
  .min(1)
  .refine((value) => !path.isAbsolute(value), "absolute_path_forbidden")
  .refine(
    (value) => {
      const normalized = path.posix.normalize(value.replaceAll("\\", "/"));
      return (
        normalized === value.replaceAll("\\", "/") &&
        normalized !== "." &&
        normalized !== ".." &&
        !normalized.startsWith("../") &&
        !normalized.includes("/../")
      );
    },
    "path_traversal_forbidden"
  );

const ZipEntrySchema = z
  .object({
    path: NonEmptyRelativePathSchema,
    sha256: HashSchema,
    bytes: z.number().int().nonnegative()
  })
  .strict();

const ArtifactEntrySchema = z
  .object({
    path: NonEmptyRelativePathSchema,
    kind: z.enum(["regular", "zip"]),
    sha256: HashSchema,
    bytes: z.number().int().nonnegative(),
    zip_entries: z.array(ZipEntrySchema)
  })
  .strict()
  .superRefine((value, context) => {
    if (value.kind === "regular" && value.zip_entries.length > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "regular_artifact_zip_entries_forbidden"
      });
    }
  });

export const FormativeConversationV18R1ArtifactManifestSchema = z
  .object({
    artifact_version: z.literal(
      FORMATIVE_CONVERSATION_V18R1_ARTIFACT_MANIFEST_VERSION
    ),
    evaluation_revision: z.literal(
      "formative-conversation-host-v5-executable-v18r1"
    ),
    package_id: z.string().regex(/^fcv5v18r1_[a-z0-9_]+$/),
    finalized_at: z.string().datetime(),
    artifacts: z.array(ArtifactEntrySchema).min(1),
    post_scan_attestation_path: z.literal(
      FORMATIVE_CONVERSATION_V18R1_ATTESTATION_FILENAME
    ),
    expected_regular_file_count: z.number().int().positive(),
    expected_zip_file_count: z.number().int().nonnegative(),
    expected_uncompressed_zip_entry_count: z
      .number()
      .int()
      .nonnegative()
  })
  .strict();

export type FormativeConversationV18R1ArtifactManifest = z.infer<
  typeof FormativeConversationV18R1ArtifactManifestSchema
>;

export const FormativeConversationV18R1ControlPayloadSchema = z
  .object({
    schema_version: z.literal(
      FORMATIVE_CONVERSATION_V18R1_CONTROL_SCHEMA_VERSION
    ),
    record_type: z.literal("finalized_artifact_package"),
    evaluation_revision: z.literal(
      "formative-conversation-host-v5-executable-v18r1"
    ),
    control_nonce: z.string().regex(/^[a-f0-9]{32}$/),
    mode: z.literal("live"),
    staging_root: z.string().min(1),
    release_root: z.string().min(1),
    artifact_manifest_path: z.string().min(1),
    artifact_manifest_sha256: HashSchema,
    artifacts_finalized_at: z.string().datetime(),
    provider_run_id: z.string().regex(/^fcv5v18r1_provider_[a-z0-9_]+$/),
    derived_evaluation_id: z.string().regex(/^fcv5v18r1_derived_[a-z0-9_]+$/)
  })
  .strict();

export type FormativeConversationV18R1ControlPayload = z.infer<
  typeof FormativeConversationV18R1ControlPayloadSchema
>;

const ScanAttestationPayloadSchema = z
  .object({
    attestation_version: z.literal(
      FORMATIVE_CONVERSATION_V18R1_SCAN_ATTESTATION_VERSION
    ),
    scanner_version: z.literal(
      FORMATIVE_CONVERSATION_V18R1_PREVENTIVE_SCANNER_VERSION
    ),
    release_policy_version: z.literal(
      FORMATIVE_CONVERSATION_V18R1_RELEASE_POLICY_VERSION
    ),
    evaluation_revision: z.literal(
      "formative-conversation-host-v5-executable-v18r1"
    ),
    package_id: z.string().min(1),
    manifest_hash: HashSchema,
    expected_regular_file_count: z.number().int().positive(),
    actual_regular_file_count: z.number().int().positive(),
    expected_zip_file_count: z.number().int().nonnegative(),
    actual_zip_file_count: z.number().int().nonnegative(),
    expected_uncompressed_zip_entry_count: z
      .number()
      .int()
      .nonnegative(),
    actual_uncompressed_zip_entry_count: z
      .number()
      .int()
      .nonnegative(),
    exact_secret_count_checked: z.number().int().positive(),
    exact_match_count: z.literal(0),
    generic_credential_pattern_match_count: z.literal(0),
    buffered_outputs_checked: z.number().int().nonnegative(),
    artifact_hashes_unchanged: z.literal(true),
    manifest_unchanged: z.literal(true),
    secret_values_recorded: z.literal(false),
    secret_hashes_or_fingerprints_recorded: z.literal(false),
    scan_status: z.literal("passed"),
    scanned_at: z.string().datetime()
  })
  .strict();

export const FormativeConversationV18R1ScanAttestationSchema = z
  .object({
    payload: ScanAttestationPayloadSchema,
    attestation_hash: HashSchema
  })
  .strict()
  .superRefine((value, context) => {
    if (stableHash(value.payload) !== value.attestation_hash) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "scan_attestation_hash_mismatch"
      });
    }
  });

export const FORMATIVE_CONVERSATION_V18R1_SCAN_ATTESTATION_SCHEMA_FINGERPRINT =
  stableHash({
    version: FORMATIVE_CONVERSATION_V18R1_SCAN_ATTESTATION_VERSION,
    fields: [
      "scanner_version",
      "release_policy_version",
      "package_id",
      "manifest_hash",
      "expected_regular_file_count",
      "actual_regular_file_count",
      "expected_zip_file_count",
      "actual_zip_file_count",
      "expected_uncompressed_zip_entry_count",
      "actual_uncompressed_zip_entry_count",
      "exact_secret_count_checked",
      "exact_match_count",
      "generic_credential_pattern_match_count",
      "buffered_outputs_checked",
      "artifact_hashes_unchanged",
      "manifest_unchanged",
      "secret_values_recorded",
      "secret_hashes_or_fingerprints_recorded",
      "scan_status",
      "scanned_at",
      "attestation_hash"
    ]
  });

const GENERIC_SECRET_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
  /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  /\b(?:postgres|postgresql):\/\/[^\s:@/]+:[^\s@/]+@/gi,
  /\b(?:api[_-]?key|session[_-]?secret|password|private[_-]?key)\b\s*[:=]\s*["']?[A-Za-z0-9_./+=-]{12,}/gi
] as const;

type ScanCounts = {
  exact_matches: number;
  generic_matches: number;
};

export type FormativeConversationV18R1PreventiveReleaseReport = {
  status: "released";
  scanner_version: typeof FORMATIVE_CONVERSATION_V18R1_PREVENTIVE_SCANNER_VERSION;
  release_policy_version: typeof FORMATIVE_CONVERSATION_V18R1_RELEASE_POLICY_VERSION;
  released_root: string;
  manifest_hash: string;
  attestation_path: string;
  attestation_hash: string;
  expected_regular_file_count: number;
  actual_regular_file_count: number;
  expected_zip_file_count: number;
  actual_zip_file_count: number;
  expected_uncompressed_zip_entry_count: number;
  actual_uncompressed_zip_entry_count: number;
  exact_secret_count_checked: number;
  exact_match_count: 0;
  generic_credential_pattern_match_count: 0;
  buffered_outputs_checked: number;
  secrets_cleared_before_release: true;
  atomic_release_completed: true;
};

export class FormativeConversationV18R1PreventiveReleaseError extends Error {
  readonly failure_record_path: string | null;

  constructor(code: string, failureRecordPath: string | null = null) {
    super(code);
    this.name = "FormativeConversationV18R1PreventiveReleaseError";
    this.failure_record_path = failureRecordPath;
  }
}

function sha256(content: Buffer | string) {
  return createHash("sha256").update(content).digest("hex");
}

async function sha256File(filePath: string) {
  return sha256(await readFile(filePath));
}

function errorCode(error: unknown) {
  if (error instanceof z.ZodError) {
    return "formative_conversation_v18r1_schema_validation_failed";
  }
  const code =
    error instanceof Error ? error.message.split(":", 1)[0] : "";
  return /^formative_conversation_v18r1_[a-z0-9_]+$/.test(code)
    ? code
    : "formative_conversation_v18r1_preventive_release_failed";
}

function isContained(parent: string, candidate: string) {
  return candidate === parent || candidate.startsWith(`${parent}${path.sep}`);
}

async function assertOwnerOnlyDirectory(directoryPath: string) {
  const metadata = await lstat(directoryPath);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    (metadata.mode & 0o077) !== 0 ||
    (typeof process.getuid === "function" && metadata.uid !== process.getuid())
  ) {
    throw new Error("formative_conversation_v18r1_owner_only_directory_invalid");
  }
}

async function hardenOwnerOnlyTree(root: string) {
  await assertOwnerOnlyDirectory(root);
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error("formative_conversation_v18r1_symlink_detected");
    }
    if (entry.isDirectory()) {
      await chmod(entryPath, 0o700);
      await hardenOwnerOnlyTree(entryPath);
      continue;
    }
    if (!entry.isFile()) {
      throw new Error("formative_conversation_v18r1_special_file_detected");
    }
    await chmod(entryPath, 0o600);
  }
}

async function assertNoSymlinkComponents(
  rootPath: string,
  candidatePath: string
) {
  const relative = path.relative(rootPath, candidatePath);
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error("formative_conversation_v18r1_path_traversal_detected");
  }
  let current = rootPath;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const metadata = await lstat(current);
    if (metadata.isSymbolicLink()) {
      throw new Error("formative_conversation_v18r1_symlink_detected");
    }
  }
}

async function regularFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name)
  )) {
    const entryPath = path.join(root, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error("formative_conversation_v18r1_symlink_detected");
    }
    if (entry.isDirectory()) {
      files.push(...(await regularFiles(entryPath)));
      continue;
    }
    if (!entry.isFile()) {
      throw new Error("formative_conversation_v18r1_special_file_detected");
    }
    files.push(entryPath);
  }
  return files.sort();
}

function scanContent(content: Buffer, exactSecrets: readonly string[]): ScanCounts {
  if (
    exactSecrets.length === 0 ||
    exactSecrets.some((secret) => secret.length === 0)
  ) {
    throw new Error("formative_conversation_v18r1_exact_secrets_unavailable");
  }
  let exactMatches = 0;
  for (const secret of exactSecrets) {
    if (secret.length > 0 && content.indexOf(Buffer.from(secret, "utf8")) >= 0) {
      exactMatches += 1;
    }
  }
  const text = content.toString("utf8");
  let genericMatches = 0;
  for (const pattern of GENERIC_SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) {
      genericMatches += 1;
    }
  }
  return { exact_matches: exactMatches, generic_matches: genericMatches };
}

function assertSafeZipEntryName(entryName: string) {
  const normalized = path.posix.normalize(entryName.replaceAll("\\", "/"));
  if (
    entryName.startsWith("/") ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("/../")
  ) {
    throw new Error("formative_conversation_v18r1_zip_path_traversal_detected");
  }
}

function zipEntryIsSymlink(entry: JSZipObject) {
  const permissions = entry.unixPermissions;
  return typeof permissions === "number" && (permissions & 0o170000) === 0o120000;
}

async function zipEntries(content: Buffer) {
  const archive = await JSZip.loadAsync(content);
  const entries = [];
  for (const entryName of Object.keys(archive.files).sort()) {
    const entry = archive.files[entryName];
    if (entry.dir) {
      continue;
    }
    assertSafeZipEntryName(entryName);
    if (zipEntryIsSymlink(entry)) {
      throw new Error("formative_conversation_v18r1_zip_symlink_detected");
    }
    const entryContent = await entry.async("nodebuffer");
    entries.push({
      path: entryName,
      sha256: sha256(entryContent),
      bytes: entryContent.byteLength,
      content: entryContent
    });
  }
  return entries;
}

async function writeOwnerOnlyJson(filePath: string, value: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  await chmod(path.dirname(filePath), 0o700);
  const handle = await open(filePath, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function writeOwnerOnlyJsonLine(filePath: string, value: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  await chmod(path.dirname(filePath), 0o700);
  const handle = await open(filePath, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function createFormativeConversationV18R1ControlChannel() {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "fcv5-v18-control-")
  );
  await chmod(directory, 0o700);
  return {
    directory,
    control_path: path.join(directory, "artifact-control.jsonl"),
    control_nonce: randomUUID().replaceAll("-", "")
  };
}

export async function assertFormativeConversationV18R1LiveControlEnvironment(input: {
  workspace_root: string;
  env: NodeJS.ProcessEnv;
}) {
  const controlPath = input.env.FORMATIVE_CONVERSATION_V5_V18R1_CONTROL_PATH;
  const controlNonce = input.env.FORMATIVE_CONVERSATION_V5_V18R1_CONTROL_NONCE;
  const stagingBase =
    input.env.FORMATIVE_CONVERSATION_V5_V18R1_STAGING_BASE_ROOT;
  if (!controlPath || !controlNonce || !stagingBase) {
    throw new Error("formative_conversation_v18r1_control_channel_not_configured");
  }
  if (!/^[a-f0-9]{32}$/.test(controlNonce)) {
    throw new Error("formative_conversation_v18r1_control_nonce_invalid");
  }
  const workspaceRoot = path.resolve(input.workspace_root);
  const stagingBoundary = path.resolve(
    workspaceRoot,
    FORMATIVE_CONVERSATION_V18R1_STAGING_ROOT
  );
  const resolvedStagingBase = path.resolve(stagingBase);
  const resolvedControlPath = path.resolve(controlPath);
  if (
    !path.isAbsolute(stagingBase) ||
    !path.isAbsolute(controlPath) ||
    stagingBase !== resolvedStagingBase ||
    controlPath !== resolvedControlPath ||
    !isContained(stagingBoundary, resolvedStagingBase) ||
    resolvedStagingBase === stagingBoundary ||
    path.basename(resolvedStagingBase) !== controlNonce
  ) {
    throw new Error("formative_conversation_v18r1_control_environment_path_invalid");
  }
  await assertOwnerOnlyDirectory(path.dirname(resolvedControlPath));
  await assertOwnerOnlyDirectory(resolvedStagingBase);
  await assertNoSymlinkComponents(stagingBoundary, resolvedStagingBase);
  if ((await realpath(resolvedStagingBase)) !== resolvedStagingBase) {
    throw new Error("formative_conversation_v18r1_staging_root_not_canonical");
  }
  try {
    await lstat(resolvedControlPath);
    throw new Error("formative_conversation_v18r1_control_payload_duplicate");
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message === "formative_conversation_v18r1_control_payload_duplicate" ||
        !("code" in error) ||
        error.code !== "ENOENT")
    ) {
      throw error;
    }
  }
  return {
    control_path: resolvedControlPath,
    control_nonce: controlNonce,
    staging_base_root: resolvedStagingBase
  };
}

export async function writeFormativeConversationV18R1ControlPayload(input: {
  control_path: string;
  payload: FormativeConversationV18R1ControlPayload;
}) {
  const payload = FormativeConversationV18R1ControlPayloadSchema.parse(
    input.payload
  );
  await assertOwnerOnlyDirectory(path.dirname(input.control_path));
  try {
    await writeOwnerOnlyJsonLine(input.control_path, payload);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") {
      throw new Error("formative_conversation_v18r1_control_payload_duplicate");
    }
    throw error;
  }
  await chmod(input.control_path, 0o600);
}

export async function readFormativeConversationV18R1ControlPayload(input: {
  control_path: string;
  expected_nonce: string;
}) {
  let raw: string;
  try {
    const metadata = await lstat(input.control_path);
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      (metadata.mode & 0o077) !== 0 ||
      (typeof process.getuid === "function" && metadata.uid !== process.getuid())
    ) {
      throw new Error("formative_conversation_v18r1_control_file_invalid");
    }
    raw = await readFile(input.control_path, "utf8");
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message === "formative_conversation_v18r1_control_file_invalid" ||
        ("code" in error && error.code !== "ENOENT"))
    ) {
      throw error;
    }
    throw new Error("formative_conversation_v18r1_control_payload_missing");
  }
  const records = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (records.length === 0) {
    throw new Error("formative_conversation_v18r1_control_payload_missing");
  }
  if (records.length > 1) {
    throw new Error("formative_conversation_v18r1_control_payload_duplicate");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(records[0]);
  } catch {
    throw new Error("formative_conversation_v18r1_control_payload_malformed");
  }
  const payload = FormativeConversationV18R1ControlPayloadSchema.safeParse(parsed);
  if (!payload.success) {
    throw new Error("formative_conversation_v18r1_control_payload_malformed");
  }
  if (payload.data.control_nonce !== input.expected_nonce) {
    throw new Error("formative_conversation_v18r1_control_payload_conflicting");
  }
  return payload.data;
}

export async function createFormativeConversationV18R1FinalizedManifest(input: {
  staging_root: string;
  package_id: string;
}) {
  await hardenOwnerOnlyTree(input.staging_root);
  await assertOwnerOnlyDirectory(input.staging_root);
  const manifestPath = path.join(
    input.staging_root,
    FORMATIVE_CONVERSATION_V18R1_MANIFEST_FILENAME
  );
  const attestationPath = path.join(
    input.staging_root,
    FORMATIVE_CONVERSATION_V18R1_ATTESTATION_FILENAME
  );
  const files = await regularFiles(input.staging_root);
  if (files.includes(manifestPath) || files.includes(attestationPath)) {
    throw new Error("formative_conversation_v18r1_package_already_finalized");
  }
  const artifacts: z.infer<typeof ArtifactEntrySchema>[] = [];
  for (const filePath of files) {
    await assertNoSymlinkComponents(input.staging_root, filePath);
    const content = await readFile(filePath);
    const isZip = path.extname(filePath).toLowerCase() === ".zip";
    artifacts.push({
      path: path.relative(input.staging_root, filePath).split(path.sep).join("/"),
      kind: isZip ? "zip" : "regular",
      sha256: sha256(content),
      bytes: content.byteLength,
      zip_entries: isZip
        ? (await zipEntries(content)).map(({ content: ignored, ...entry }) => {
            void ignored;
            return entry;
          })
        : []
    });
  }
  const manifest: FormativeConversationV18R1ArtifactManifest = {
    artifact_version:
      FORMATIVE_CONVERSATION_V18R1_ARTIFACT_MANIFEST_VERSION,
    evaluation_revision:
      "formative-conversation-host-v5-executable-v18r1",
    package_id: input.package_id,
    finalized_at: new Date().toISOString(),
    artifacts,
    post_scan_attestation_path:
      FORMATIVE_CONVERSATION_V18R1_ATTESTATION_FILENAME,
    expected_regular_file_count:
      artifacts.filter((entry) => entry.kind === "regular").length + 2,
    expected_zip_file_count: artifacts.filter((entry) => entry.kind === "zip")
      .length,
    expected_uncompressed_zip_entry_count: artifacts.reduce(
      (sum, entry) => sum + entry.zip_entries.length,
      0
    )
  };
  FormativeConversationV18R1ArtifactManifestSchema.parse(manifest);
  await writeOwnerOnlyJson(manifestPath, manifest);
  return {
    manifest,
    manifest_path: manifestPath,
    manifest_sha256: await sha256File(manifestPath)
  };
}

export async function writeFormativeConversationV18R1SafeFailureRecord(input: {
  workspace_root: string;
  failure_code: string;
  control_nonce: string;
}) {
  const failureRoot = path.resolve(
    input.workspace_root,
    FORMATIVE_CONVERSATION_V18R1_FAILURE_ROOT
  );
  await mkdir(failureRoot, { recursive: true, mode: 0o700 });
  await chmod(failureRoot, 0o700);
  const failurePath = path.join(
    failureRoot,
    `v18-security-failure-${input.control_nonce}.json`
  );
  try {
    await writeOwnerOnlyJson(failurePath, {
      artifact_version:
        "formative-conversation-v18r1-safe-security-failure-v1",
      status: "blocked",
      failure_code: input.failure_code,
      failed_at: new Date().toISOString(),
      package_released: false,
      review_links_available: false,
      secret_values_recorded: false,
      secret_hashes_or_fingerprints_recorded: false
    });
    return failurePath;
  } catch {
    return null;
  }
}

export function scanFormativeConversationV18R1BufferedOutputs(input: {
  exact_secret_values: readonly string[];
  buffered_outputs: readonly string[];
}) {
  if (
    input.exact_secret_values.length === 0 ||
    input.exact_secret_values.some((value) => value.length === 0)
  ) {
    throw new Error("formative_conversation_v18r1_exact_secrets_unavailable");
  }
  let exactMatches = 0;
  let genericMatches = 0;
  for (const output of input.buffered_outputs) {
    const scan = scanContent(Buffer.from(output, "utf8"), input.exact_secret_values);
    exactMatches += scan.exact_matches;
    genericMatches += scan.generic_matches;
  }
  if (exactMatches > 0 || genericMatches > 0) {
    throw new Error("formative_conversation_v18r1_secret_match_detected");
  }
  return {
    buffered_outputs_checked: input.buffered_outputs.length,
    exact_secret_count_checked: input.exact_secret_values.length,
    exact_match_count: 0 as const,
    generic_credential_pattern_match_count: 0 as const
  };
}

export function assertFormativeConversationV18R1ScanCoverage(input: {
  expected_regular_file_count: number;
  actual_regular_file_count: number;
  expected_zip_file_count: number;
  actual_zip_file_count: number;
  expected_uncompressed_zip_entry_count: number;
  actual_uncompressed_zip_entry_count: number;
}) {
  const expectedTotal =
    input.expected_regular_file_count +
    input.expected_zip_file_count +
    input.expected_uncompressed_zip_entry_count;
  const actualTotal =
    input.actual_regular_file_count +
    input.actual_zip_file_count +
    input.actual_uncompressed_zip_entry_count;
  if (expectedTotal > 0 && actualTotal === 0) {
    throw new Error("formative_conversation_v18r1_zero_scan_coverage");
  }
  if (
    input.expected_regular_file_count !== input.actual_regular_file_count ||
    input.expected_zip_file_count !== input.actual_zip_file_count ||
    input.expected_uncompressed_zip_entry_count !==
      input.actual_uncompressed_zip_entry_count
  ) {
    throw new Error("formative_conversation_v18r1_scan_coverage_mismatch");
  }
}

export type FormativeConversationV18R1ReleaseHooks = {
  after_initial_enumeration?: () => void | Promise<void>;
  before_manifest_recheck?: () => void | Promise<void>;
  before_attestation?: () => void | Promise<void>;
  before_release?: (state: {
    secrets_cleared: boolean;
    attestation_complete: boolean;
  }) => void | Promise<void>;
};

export async function releaseFormativeConversationV18R1Artifacts(input: {
  workspace_root: string;
  control: FormativeConversationV18R1ControlPayload;
  exact_secret_values: string[];
  buffered_outputs: readonly string[];
  clear_exact_secrets: () => void | Promise<void>;
  hooks?: FormativeConversationV18R1ReleaseHooks;
}): Promise<FormativeConversationV18R1PreventiveReleaseReport> {
  const control = FormativeConversationV18R1ControlPayloadSchema.parse(
    input.control
  );
  const workspaceRoot = path.resolve(input.workspace_root);
  const expectedDataRoot = path.resolve(
    workspaceRoot,
    FORMATIVE_CONVERSATION_V18R1_DATA_ROOT
  );
  const expectedStagingRoot = path.resolve(
    workspaceRoot,
    FORMATIVE_CONVERSATION_V18R1_STAGING_ROOT
  );
  const expectedReleaseRoot = path.resolve(
    workspaceRoot,
    FORMATIVE_CONVERSATION_V18R1_RELEASE_ROOT
  );
  const stagingRoot = path.resolve(control.staging_root);
  const releaseRoot = path.resolve(control.release_root);
  const manifestPath = path.resolve(control.artifact_manifest_path);
  let secretsCleared = false;
  let attestationComplete = false;
  let failureRecordPath: string | null = null;
  let safeStagingRoot: string | null = null;

  try {
    if (
      !path.isAbsolute(control.staging_root) ||
      !path.isAbsolute(control.release_root) ||
      !path.isAbsolute(control.artifact_manifest_path) ||
      control.staging_root !== stagingRoot ||
      control.release_root !== releaseRoot ||
      control.artifact_manifest_path !== manifestPath
    ) {
      throw new Error("formative_conversation_v18r1_control_path_not_canonical");
    }
    if (
      !isContained(expectedStagingRoot, stagingRoot) ||
      stagingRoot === expectedStagingRoot ||
      !isContained(expectedReleaseRoot, releaseRoot) ||
      releaseRoot === expectedReleaseRoot ||
      !isContained(stagingRoot, manifestPath) ||
      path.basename(stagingRoot) !== path.basename(releaseRoot)
    ) {
      throw new Error("formative_conversation_v18r1_control_path_invalid");
    }
    safeStagingRoot = stagingRoot;
    await assertOwnerOnlyDirectory(expectedDataRoot);
    await assertOwnerOnlyDirectory(expectedStagingRoot);
    await assertOwnerOnlyDirectory(stagingRoot);
    await assertNoSymlinkComponents(expectedStagingRoot, stagingRoot);
    await assertNoSymlinkComponents(stagingRoot, manifestPath);
    if ((await realpath(stagingRoot)) !== stagingRoot) {
      throw new Error("formative_conversation_v18r1_staging_root_not_canonical");
    }
    await mkdir(expectedReleaseRoot, { recursive: true, mode: 0o700 });
    await chmod(expectedReleaseRoot, 0o700);
    await assertNoSymlinkComponents(expectedDataRoot, expectedReleaseRoot);
    try {
      await lstat(releaseRoot);
      throw new Error("formative_conversation_v18r1_release_target_exists");
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message === "formative_conversation_v18r1_release_target_exists" ||
          !("code" in error) ||
          error.code !== "ENOENT")
      ) {
        throw error;
      }
    }
    if (
      input.exact_secret_values.length === 0 ||
      input.exact_secret_values.some((value) => value.length === 0)
    ) {
      throw new Error("formative_conversation_v18r1_exact_secrets_unavailable");
    }

    const manifestContent = await readFile(manifestPath);
    const initialManifestHash = sha256(manifestContent);
    if (initialManifestHash !== control.artifact_manifest_sha256) {
      throw new Error("formative_conversation_v18r1_manifest_control_hash_mismatch");
    }
    let manifestValue: unknown;
    try {
      manifestValue = JSON.parse(manifestContent.toString("utf8"));
    } catch {
      throw new Error("formative_conversation_v18r1_manifest_malformed");
    }
    const manifest = FormativeConversationV18R1ArtifactManifestSchema.parse(
      manifestValue
    );
    if (
      manifest.package_id !== path.basename(stagingRoot) ||
      path.basename(manifestPath) !==
        FORMATIVE_CONVERSATION_V18R1_MANIFEST_FILENAME
    ) {
      throw new Error("formative_conversation_v18r1_manifest_identity_mismatch");
    }
    const artifactPaths = manifest.artifacts.map((entry) => entry.path);
    if (new Set(artifactPaths).size !== artifactPaths.length) {
      throw new Error("formative_conversation_v18r1_manifest_duplicate_artifact");
    }
    const expectedRegular =
      manifest.artifacts.filter((entry) => entry.kind === "regular").length + 2;
    const expectedZip = manifest.artifacts.filter(
      (entry) => entry.kind === "zip"
    ).length;
    const expectedZipEntries = manifest.artifacts.reduce(
      (sum, entry) => sum + entry.zip_entries.length,
      0
    );
    if (
      manifest.expected_regular_file_count !== expectedRegular ||
      manifest.expected_zip_file_count !== expectedZip ||
      manifest.expected_uncompressed_zip_entry_count !== expectedZipEntries
    ) {
      throw new Error("formative_conversation_v18r1_manifest_count_mismatch");
    }

    const expectedBeforeAttestation = new Set([
      FORMATIVE_CONVERSATION_V18R1_MANIFEST_FILENAME,
      ...artifactPaths
    ]);
    const initialFiles = await regularFiles(stagingRoot);
    const initialRelativeFiles = initialFiles.map((filePath) =>
      path.relative(stagingRoot, filePath).split(path.sep).join("/")
    );
    if (
      initialRelativeFiles.length !== expectedBeforeAttestation.size ||
      initialRelativeFiles.some((filePath) => !expectedBeforeAttestation.has(filePath))
    ) {
      throw new Error("formative_conversation_v18r1_unexpected_or_missing_artifact");
    }
    await input.hooks?.after_initial_enumeration?.();

    let exactMatches = 0;
    let genericMatches = 0;
    let actualRegular = 1;
    let actualZip = 0;
    let actualZipEntries = 0;
    const accumulate = (content: Buffer) => {
      const scan = scanContent(content, input.exact_secret_values);
      exactMatches += scan.exact_matches;
      genericMatches += scan.generic_matches;
    };
    accumulate(manifestContent);

    for (const artifact of manifest.artifacts) {
      const artifactPath = path.resolve(stagingRoot, artifact.path);
      if (!isContained(stagingRoot, artifactPath)) {
        throw new Error("formative_conversation_v18r1_path_traversal_detected");
      }
      await assertNoSymlinkComponents(stagingRoot, artifactPath);
      const metadata = await stat(artifactPath);
      if (!metadata.isFile()) {
        throw new Error("formative_conversation_v18r1_manifest_artifact_missing");
      }
      const content = await readFile(artifactPath);
      if (content.byteLength !== artifact.bytes || sha256(content) !== artifact.sha256) {
        throw new Error("formative_conversation_v18r1_artifact_hash_mismatch");
      }
      accumulate(content);
      if (artifact.kind === "regular") {
        actualRegular += 1;
        continue;
      }
      actualZip += 1;
      const actualEntries = await zipEntries(content);
      const expectedEntries = new Map(
        artifact.zip_entries.map((entry) => [entry.path, entry])
      );
      if (
        expectedEntries.size !== artifact.zip_entries.length ||
        actualEntries.length !== expectedEntries.size
      ) {
        throw new Error("formative_conversation_v18r1_zip_entry_coverage_mismatch");
      }
      for (const entry of actualEntries) {
        const expected = expectedEntries.get(entry.path);
        if (
          !expected ||
          expected.sha256 !== entry.sha256 ||
          expected.bytes !== entry.bytes
        ) {
          throw new Error("formative_conversation_v18r1_zip_entry_coverage_mismatch");
        }
        actualZipEntries += 1;
        accumulate(entry.content);
      }
    }
    const outputScan = scanFormativeConversationV18R1BufferedOutputs({
      exact_secret_values: input.exact_secret_values,
      buffered_outputs: input.buffered_outputs
    });
    assertFormativeConversationV18R1ScanCoverage({
      expected_regular_file_count: manifest.expected_regular_file_count,
      actual_regular_file_count: actualRegular + 1,
      expected_zip_file_count: manifest.expected_zip_file_count,
      actual_zip_file_count: actualZip,
      expected_uncompressed_zip_entry_count:
        manifest.expected_uncompressed_zip_entry_count,
      actual_uncompressed_zip_entry_count: actualZipEntries
    });
    if (exactMatches > 0 || genericMatches > 0) {
      throw new Error("formative_conversation_v18r1_secret_match_detected");
    }

    await input.hooks?.before_manifest_recheck?.();
    if ((await sha256File(manifestPath)) !== initialManifestHash) {
      throw new Error("formative_conversation_v18r1_manifest_mutated_during_scan");
    }
    for (const artifact of manifest.artifacts) {
      if (
        (await sha256File(path.resolve(stagingRoot, artifact.path))) !==
        artifact.sha256
      ) {
        throw new Error("formative_conversation_v18r1_artifact_mutated_during_scan");
      }
    }
    const afterScanFiles = await regularFiles(stagingRoot);
    const afterScanRelative = afterScanFiles.map((filePath) =>
      path.relative(stagingRoot, filePath).split(path.sep).join("/")
    );
    if (
      afterScanRelative.length !== expectedBeforeAttestation.size ||
      afterScanRelative.some((filePath) => !expectedBeforeAttestation.has(filePath))
    ) {
      throw new Error("formative_conversation_v18r1_artifact_created_after_enumeration");
    }

    await input.hooks?.before_attestation?.();
    const attestationPayload = ScanAttestationPayloadSchema.parse({
      attestation_version:
        FORMATIVE_CONVERSATION_V18R1_SCAN_ATTESTATION_VERSION,
      scanner_version:
        FORMATIVE_CONVERSATION_V18R1_PREVENTIVE_SCANNER_VERSION,
      release_policy_version:
        FORMATIVE_CONVERSATION_V18R1_RELEASE_POLICY_VERSION,
      evaluation_revision:
        "formative-conversation-host-v5-executable-v18r1",
      package_id: manifest.package_id,
      manifest_hash: initialManifestHash,
      expected_regular_file_count: manifest.expected_regular_file_count,
      actual_regular_file_count: actualRegular + 1,
      expected_zip_file_count: manifest.expected_zip_file_count,
      actual_zip_file_count: actualZip,
      expected_uncompressed_zip_entry_count:
        manifest.expected_uncompressed_zip_entry_count,
      actual_uncompressed_zip_entry_count: actualZipEntries,
      exact_secret_count_checked: input.exact_secret_values.length,
      exact_match_count: 0,
      generic_credential_pattern_match_count: 0,
      buffered_outputs_checked: outputScan.buffered_outputs_checked,
      artifact_hashes_unchanged: true,
      manifest_unchanged: true,
      secret_values_recorded: false,
      secret_hashes_or_fingerprints_recorded: false,
      scan_status: "passed",
      scanned_at: new Date().toISOString()
    });
    const attestation = FormativeConversationV18R1ScanAttestationSchema.parse({
      payload: attestationPayload,
      attestation_hash: stableHash(attestationPayload)
    });
    const attestationPath = path.join(
      stagingRoot,
      manifest.post_scan_attestation_path
    );
    await writeOwnerOnlyJson(attestationPath, attestation);
    const attestationContent = await readFile(attestationPath);
    const attestationScan = scanContent(
      attestationContent,
      input.exact_secret_values
    );
    if (
      attestationScan.exact_matches > 0 ||
      attestationScan.generic_matches > 0
    ) {
      throw new Error("formative_conversation_v18r1_attestation_secret_match_detected");
    }
    exactMatches += attestationScan.exact_matches;
    genericMatches += attestationScan.generic_matches;
    actualRegular += 1;
    attestationComplete = true;

    const finalFiles = await regularFiles(stagingRoot);
    const expectedFinal = new Set([
      ...expectedBeforeAttestation,
      manifest.post_scan_attestation_path
    ]);
    const finalRelative = finalFiles.map((filePath) =>
      path.relative(stagingRoot, filePath).split(path.sep).join("/")
    );
    if (
      finalRelative.length !== expectedFinal.size ||
      finalRelative.some((filePath) => !expectedFinal.has(filePath))
    ) {
      throw new Error("formative_conversation_v18r1_final_scan_coverage_mismatch");
    }
    assertFormativeConversationV18R1ScanCoverage({
      expected_regular_file_count: manifest.expected_regular_file_count,
      actual_regular_file_count: actualRegular,
      expected_zip_file_count: manifest.expected_zip_file_count,
      actual_zip_file_count: actualZip,
      expected_uncompressed_zip_entry_count:
        manifest.expected_uncompressed_zip_entry_count,
      actual_uncompressed_zip_entry_count: actualZipEntries
    });
    if ((await sha256File(manifestPath)) !== initialManifestHash) {
      throw new Error("formative_conversation_v18r1_manifest_mutated_during_scan");
    }

    await input.clear_exact_secrets();
    secretsCleared = input.exact_secret_values.every((value) => value === "");
    if (!secretsCleared) {
      throw new Error("formative_conversation_v18r1_secret_clear_failed");
    }
    await input.hooks?.before_release?.({
      secrets_cleared: secretsCleared,
      attestation_complete: attestationComplete
    });
    if (!secretsCleared || !attestationComplete) {
      throw new Error("formative_conversation_v18r1_release_boundary_violation");
    }
    await rename(stagingRoot, releaseRoot);

    return {
      status: "released",
      scanner_version:
        FORMATIVE_CONVERSATION_V18R1_PREVENTIVE_SCANNER_VERSION,
      release_policy_version:
        FORMATIVE_CONVERSATION_V18R1_RELEASE_POLICY_VERSION,
      released_root: releaseRoot,
      manifest_hash: initialManifestHash,
      attestation_path: path.join(
        releaseRoot,
        manifest.post_scan_attestation_path
      ),
      attestation_hash: attestation.attestation_hash,
      expected_regular_file_count: manifest.expected_regular_file_count,
      actual_regular_file_count: actualRegular,
      expected_zip_file_count: manifest.expected_zip_file_count,
      actual_zip_file_count: actualZip,
      expected_uncompressed_zip_entry_count:
        manifest.expected_uncompressed_zip_entry_count,
      actual_uncompressed_zip_entry_count: actualZipEntries,
      exact_secret_count_checked: attestationPayload.exact_secret_count_checked,
      exact_match_count: 0,
      generic_credential_pattern_match_count: 0,
      buffered_outputs_checked: input.buffered_outputs.length,
      secrets_cleared_before_release: true,
      atomic_release_completed: true
    };
  } catch (error) {
    if (!secretsCleared) {
      try {
        await input.clear_exact_secrets();
      } finally {
        secretsCleared = input.exact_secret_values.every((value) => value === "");
      }
    }
    if (safeStagingRoot && isContained(expectedStagingRoot, safeStagingRoot)) {
      await rm(safeStagingRoot, { recursive: true, force: true }).catch(() => undefined);
    }
    failureRecordPath = await writeFormativeConversationV18R1SafeFailureRecord({
      workspace_root: workspaceRoot,
      failure_code: errorCode(error),
      control_nonce: control.control_nonce
    });
    throw new FormativeConversationV18R1PreventiveReleaseError(
      errorCode(error),
      failureRecordPath
    );
  }
}

export async function removeFormativeConversationV18R1ControlChannel(input: {
  control_path: string;
  control_directory: string;
}) {
  await unlink(input.control_path).catch(() => undefined);
  await rm(input.control_directory, { recursive: true, force: true });
}
