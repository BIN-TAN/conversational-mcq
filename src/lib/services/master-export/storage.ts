import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db";

const EXPORT_DIR = path.join(process.cwd(), ".data", "exports");
const storageKeyPattern = /^[a-zA-Z0-9_-]+\.csv$/;

export function exportStorageDirectory() {
  return EXPORT_DIR;
}

export function storageKeyForExport(exportPublicId: string) {
  if (!/^[a-zA-Z0-9_-]+$/.test(exportPublicId)) {
    throw new Error("Invalid export public ID.");
  }

  return `${exportPublicId}.csv`;
}

function pathForStorageKey(storageKey: string) {
  if (!storageKeyPattern.test(storageKey)) {
    throw new Error("Invalid export storage key.");
  }

  const resolved = path.resolve(EXPORT_DIR, storageKey);
  const root = path.resolve(EXPORT_DIR);

  if (!resolved.startsWith(`${root}${path.sep}`) && resolved !== root) {
    throw new Error("Export storage key escapes the export directory.");
  }

  return resolved;
}

export async function writeExportFile(storageKey: string, contents: string) {
  await mkdir(EXPORT_DIR, { recursive: true });
  await writeFile(pathForStorageKey(storageKey), contents, "utf8");
}

export async function readExportFile(storageKey: string) {
  return readFile(pathForStorageKey(storageKey));
}

export async function deleteExportFile(storageKey: string) {
  await rm(pathForStorageKey(storageKey), { force: true });
}

export async function exportFileExists(storageKey: string) {
  try {
    await stat(pathForStorageKey(storageKey));
    return true;
  } catch {
    return false;
  }
}

export async function cleanupExpiredExports(now = new Date()) {
  const jobs = await prisma.exportJob.findMany({
    where: {
      status: "completed",
      expires_at: { lt: now },
      storage_key: { not: null }
    },
    select: {
      id: true,
      storage_key: true
    }
  });
  let deletedFiles = 0;

  for (const job of jobs) {
    if (job.storage_key) {
      await deleteExportFile(job.storage_key);
      deletedFiles += 1;
    }

    await prisma.exportJob.update({
      where: { id: job.id },
      data: { status: "expired" }
    });
  }

  return {
    expired_jobs: jobs.length,
    deleted_files: deletedFiles
  };
}
