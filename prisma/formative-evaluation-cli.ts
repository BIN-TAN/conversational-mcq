import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function main() {
  const command = process.argv[2];
  if (!command || !["scripted", "branching", "scenario", "all", "report"].includes(command)) {
    throw new Error("Use one of: scripted, branching, scenario, all, report.");
  }
  const { runFormativeEvaluationCli } = await import("../src/lib/evaluation/formative/cli");
  const result = await runFormativeEvaluationCli({
    command: command as "scripted" | "branching" | "scenario" | "all" | "report",
    args: process.argv.slice(3)
  });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Formative evaluation command failed.");
  process.exitCode = 1;
});
