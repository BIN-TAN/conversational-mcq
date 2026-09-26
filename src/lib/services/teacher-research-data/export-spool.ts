import { createHash, type Hash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { appendFile, mkdir, mkdtemp, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import JSZip from "jszip";
import { parse } from "csv-parse/sync";
import { ContentServiceError } from "../content/errors";
import { ResearchCoverageAccumulator } from "./coverage-report";

type FileChunk = { path: string; data: string };
type Entry = { path: string; hash: Hash; bytes: number; rows: number; header: string | null };
const state = globalThis as typeof globalThis & { researchExportRunning?: boolean };
const activeSpools = new Set<string>();
const staleSpoolAgeMs = 24 * 60 * 60 * 1000;

export async function cleanupStaleResearchSpools(parent: string, now = Date.now()) {
  for (const entry of await readdir(parent, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^\.research-export-[a-zA-Z0-9]+$/.test(entry.name)) continue;
    const directory = path.join(parent, entry.name);
    if (activeSpools.has(directory)) continue;
    try {
      if (now - (await stat(directory)).mtimeMs > staleSpoolAgeMs) {
        await rm(directory, { recursive: true, force: true });
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

export async function withResearchExportSlot<T>(work: () => Promise<T>) {
  if (state.researchExportRunning) throw new ContentServiceError("research_export_busy",
    "Another research export is being prepared. Please wait for it to finish, then try again.", 429, { retryable: true });
  state.researchExportRunning = true;
  try { return await work(); } finally { state.researchExportRunning = false; }
}

export class ResearchExportSpool {
  private readonly entries = new Map<string, Entry>();
  private readonly coverage = new ResearchCoverageAccumulator();
  private constructor(readonly directory: string) {}

  static async create(parent: string) {
    await mkdir(parent, { recursive: true, mode: 0o700 });
    await cleanupStaleResearchSpools(parent);
    const directory = await mkdtemp(path.join(parent, ".research-export-"));
    activeSpools.add(directory);
    return new ResearchExportSpool(directory);
  }

  async append(file: FileChunk) {
    if (!/^[a-zA-Z0-9_-]+\.(csv|json|txt)$/.test(file.path)) throw new Error("invalid_research_entry_path");
    const existing = this.entries.get(file.path);
    // Dictionaries and notes are invariant across the session-sized chunks.
    if (existing && /dictionary|codebook|notes/.test(file.path)) return;
    const isCsv = file.path.endsWith(".csv");
    const records = isCsv ? parse(file.data, { skip_empty_lines: true }) as string[][] : null;
    const header = records ? JSON.stringify(records[0]) : null;
    if (existing && (!isCsv || existing.header !== header)) throw new Error("incompatible_research_entry_chunk");
    const data = existing ? file.data.slice(file.data.indexOf("\n") + 1) : file.data;
    const entry = existing ?? { path: file.path, hash: createHash("sha256"), bytes: 0, rows: 0, header };
    await appendFile(path.join(this.directory, file.path), data, { encoding: "utf8", mode: 0o600 });
    entry.hash.update(data, "utf8");
    entry.bytes += Buffer.byteLength(data, "utf8");
    entry.rows += records ? Math.max(0, records.length - 1) : file.data.trim() ? 1 : 0;
    this.entries.set(file.path, entry);
    this.coverage.add(file);
  }

  async finishCoverage() {
    for (const file of this.coverage.files()) await this.append(file);
  }

  manifestEntries() {
    return [...this.entries.values()].map(entry => ({ path: entry.path,
      sha256: entry.hash.copy().digest("hex"), bytes: entry.bytes,
      rows: entry.path.endsWith(".csv") ? entry.rows : null }));
  }

  rowCounts() { return Object.fromEntries([...this.entries.values()].map(entry => [entry.path, entry.rows])); }

  // Used only by the compatibility/test API, never by the HTTP production route.
  async readAll() {
    const files: FileChunk[] = [];
    for (const entry of this.entries.values()) files.push({ path: entry.path, data: await readFile(path.join(this.directory, entry.path), "utf8") });
    return files;
  }

  async publishZip(destination: string) {
    const archive = new JSZip();
    const streams = [...this.entries.values()].map(entry => {
      const stream = createReadStream(path.join(this.directory, entry.path), { highWaterMark: 64 * 1024 });
      archive.file(entry.path, stream);
      return stream;
    });
    const temporary = path.join(this.directory, "bundle.zip");
    try {
      await pipeline(archive.generateNodeStream({ streamFiles: true, compression: "DEFLATE", compressionOptions: { level: 1 } }),
        createWriteStream(temporary, { flags: "wx", mode: 0o600 }));
      // Publish only a completed archive. A failed build never exposes a partial ZIP.
      await rename(temporary, destination);
    } finally { for (const stream of streams) stream.destroy(); }
  }

  async dispose() {
    try { await rm(this.directory, { recursive: true, force: true }); }
    finally { activeSpools.delete(this.directory); }
  }
}
