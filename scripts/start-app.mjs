import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import nextEnv from "@next/env";

const require = createRequire(import.meta.url);
const [mode = "start", ...args] = process.argv.slice(2);
if (!["start", "dev"].includes(mode)) throw new Error("Expected start or dev.");
process.env.NODE_ENV ??= mode === "dev" ? "development" : "production";
nextEnv.loadEnvConfig(process.cwd(), mode === "dev");

// The web server and durable worker share a service lifecycle, not an HTTP request.
const children = [
  spawn(process.execPath, [require.resolve("next/dist/bin/next"), mode, ...args], { stdio: "inherit" }),
  spawn(process.execPath, ["--import", "tsx", "prisma/initial-preparation-worker.ts"], { stdio: "inherit" })
];
let stopping = false;
let killTimer;
function stop(code) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) if (child.exitCode === null) child.kill("SIGTERM");
  killTimer = setTimeout(() => {
    for (const child of children) if (child.exitCode === null) child.kill("SIGKILL");
  }, 25_000);
  killTimer.unref();
}
for (const child of children) {
  child.on("error", () => stop(1));
  child.on("exit", (code) => {
    if (!stopping) stop(code ?? 1);
    if (children.every((process) => process.exitCode !== null || process.signalCode !== null)) clearTimeout(killTimer);
  });
}
process.once("SIGINT", () => stop(0));
process.once("SIGTERM", () => stop(0));
