import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";

export const EXACT_SECRET_ARTIFACT_SCANNER_VERSION =
  "exact-secret-artifact-scanner-v1" as const;

const GENERIC_SECRET_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
  /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  /\b(?:postgres|postgresql):\/\/[^\s:@/]+:[^\s@/]+@/gi,
  /\b(?:api[_-]?key|session[_-]?secret|password|private[_-]?key)\b\s*[:=]\s*["']?[A-Za-z0-9_./+=-]{12,}/gi
] as const;

export type ExactSecretArtifactScanReport = {
  scanner_version: typeof EXACT_SECRET_ARTIFACT_SCANNER_VERSION;
  secrets_checked: number;
  files_checked: number;
  zip_entries_checked: number;
  buffered_outputs_checked: number;
  exact_matches_found: number;
  generic_matches_found: number;
  matches_found: number;
  status: "passed" | "failed";
};

async function regularFiles(root: string): Promise<string[]> {
  const rootStat = await stat(root);
  if (rootStat.isFile()) {
    return [root];
  }
  if (!rootStat.isDirectory()) {
    return [];
  }
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const entryPath = path.join(root, entry.name);
      return entry.isDirectory()
        ? regularFiles(entryPath)
        : entry.isFile()
          ? Promise.resolve([entryPath])
          : Promise.resolve([]);
    })
  );
  return nested.flat().sort();
}

function scanContent(input: {
  content: Buffer;
  exact_secret_values: readonly string[];
}) {
  let exactMatches = 0;
  for (const secret of input.exact_secret_values) {
    if (
      secret.length > 0 &&
      input.content.indexOf(Buffer.from(secret, "utf8")) >= 0
    ) {
      exactMatches += 1;
    }
  }
  const text = input.content.toString("utf8");
  let genericMatches = 0;
  for (const pattern of GENERIC_SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) {
      genericMatches += 1;
    }
  }
  return {
    exact_matches: exactMatches,
    generic_matches: genericMatches
  };
}

export async function scanExactSecretArtifactSet(input: {
  artifact_roots: readonly string[];
  buffered_outputs?: readonly string[];
  exact_secret_values: readonly string[];
}): Promise<ExactSecretArtifactScanReport> {
  const exactSecretValues = [
    ...new Set(input.exact_secret_values.filter(Boolean))
  ];
  const files = (
    await Promise.all(
      [...new Set(input.artifact_roots)].map(regularFiles)
    )
  )
    .flat()
    .sort();
  let exactMatches = 0;
  let genericMatches = 0;
  let zipEntriesChecked = 0;

  const accumulate = (content: Buffer) => {
    const result = scanContent({
      content,
      exact_secret_values: exactSecretValues
    });
    exactMatches += result.exact_matches;
    genericMatches += result.generic_matches;
  };

  for (const filePath of files) {
    const content = await readFile(filePath);
    accumulate(content);
    if (path.extname(filePath).toLowerCase() !== ".zip") {
      continue;
    }
    const archive = await JSZip.loadAsync(content);
    for (const entryName of Object.keys(archive.files).sort()) {
      const entry = archive.files[entryName];
      if (entry.dir) {
        continue;
      }
      zipEntriesChecked += 1;
      accumulate(await entry.async("nodebuffer"));
    }
  }

  for (const output of input.buffered_outputs ?? []) {
    accumulate(Buffer.from(output, "utf8"));
  }

  const matchesFound = exactMatches + genericMatches;
  return {
    scanner_version: EXACT_SECRET_ARTIFACT_SCANNER_VERSION,
    secrets_checked: exactSecretValues.length,
    files_checked: files.length,
    zip_entries_checked: zipEntriesChecked,
    buffered_outputs_checked: input.buffered_outputs?.length ?? 0,
    exact_matches_found: exactMatches,
    generic_matches_found: genericMatches,
    matches_found: matchesFound,
    status: matchesFound === 0 ? "passed" : "failed"
  };
}

export async function scanExactSecretArtifactsBeforeCleanup(input: {
  artifact_roots: readonly string[];
  buffered_outputs?: readonly string[];
  exact_secret_values: readonly string[];
  on_scan_complete?: (report: ExactSecretArtifactScanReport) => void;
  cleanup: () => void | Promise<void>;
}) {
  try {
    const report = await scanExactSecretArtifactSet(input);
    input.on_scan_complete?.(report);
    return report;
  } finally {
    await input.cleanup();
  }
}
