import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import {
  scanExactSecretArtifactSet,
  scanExactSecretArtifactsBeforeCleanup
} from "../src/lib/operational/exact-secret-artifact-scanner";

async function main() {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "fcv9-secret-scanner-")
  );
  const exactSecret = "v9-exact-secret-canary-value-28491";
  try {
    const cleanPath = path.join(root, "clean.json");
    await writeFile(
      cleanPath,
      JSON.stringify({ status: "safe", secret_values_excluded: true })
    );
    const clean = await scanExactSecretArtifactSet({
      artifact_roots: [cleanPath],
      buffered_outputs: ["safe launcher output"],
      exact_secret_values: [exactSecret]
    });
    assert.equal(clean.status, "passed");
    assert.equal(clean.matches_found, 0);
    assert.equal(clean.secrets_checked, 1);

    const leakedPath = path.join(root, "leaked.txt");
    await writeFile(leakedPath, `prefix:${exactSecret}:suffix`);
    const leaked = await scanExactSecretArtifactSet({
      artifact_roots: [leakedPath],
      exact_secret_values: [exactSecret]
    });
    assert.equal(leaked.status, "failed");
    assert.equal(leaked.exact_matches_found, 1);
    assert(!JSON.stringify(leaked).includes(exactSecret));

    const archive = new JSZip();
    archive.file("nested/safe.txt", "safe");
    archive.file("nested/leaked.txt", exactSecret);
    const zipPath = path.join(root, "artifacts.zip");
    await writeFile(zipPath, await archive.generateAsync({ type: "nodebuffer" }));
    const zipScan = await scanExactSecretArtifactSet({
      artifact_roots: [zipPath],
      exact_secret_values: [exactSecret]
    });
    assert.equal(zipScan.status, "failed");
    assert.equal(zipScan.zip_entries_checked, 2);
    assert(zipScan.exact_matches_found >= 1);

    const lifecycle: string[] = [];
    let processLocalSecret = exactSecret;
    const lifecycleReport =
      await scanExactSecretArtifactsBeforeCleanup({
        artifact_roots: [cleanPath],
        exact_secret_values: [processLocalSecret],
        on_scan_complete: () => lifecycle.push("scan_completed"),
        cleanup: () => {
          lifecycle.push("cleanup");
          processLocalSecret = "";
        }
      });
    assert.deepEqual(lifecycle, ["scan_completed", "cleanup"]);
    assert.equal(processLocalSecret, "");
    assert.equal(lifecycleReport.status, "passed");

    console.log(
      JSON.stringify({
        status: "passed",
        exact_value_detection: true,
        clean_artifact_passed: true,
        zip_entries_scanned: zipScan.zip_entries_checked,
        secret_values_absent_from_reports: true,
        cleanup_after_scan: true,
        provider_calls: 0,
        model_auth_requests: 0
      })
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      status: "failed",
      error_code:
        error instanceof Error
          ? error.message
          : "formative_conversation_v9_secret_scanner_smoke_failed",
      provider_calls: 0,
      model_auth_requests: 0
    })
  );
  process.exitCode = 1;
});
