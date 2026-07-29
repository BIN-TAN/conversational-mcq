import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { createLiveFormativeConversationAgentRunner } from "../src/lib/services/student-assessment/formative-conversation/live-runner";
import {
  SyntheticStudentPersonaIdSchema,
  buildSyntheticStudentValidationPlan,
  cleanupSyntheticStudentValidationRun,
  hashSyntheticValidationArtifact,
  parseSyntheticStudentPersonas,
  runSyntheticStudentResearchValidation,
  syntheticStudentPersonas,
  type SyntheticStudentPersona,
  type SyntheticStudentPersonaId
} from "../src/lib/evaluation/synthetic-student-validation";

loadEnvConfig(process.cwd());

type CliOptions = {
  mode: "plan" | "live";
  persona_ids: SyntheticStudentPersonaId[];
  persona_file: string | null;
  output_dir: string;
  confirm_live_provider_calls: boolean;
  cleanup: boolean;
};

function valueFor(args: string[], name: string) {
  const prefix = `${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) {
    return inline.slice(prefix.length);
  }
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function parseOptions(args: string[]): CliOptions {
  const modeValue = valueFor(args, "--mode") ?? "plan";
  if (modeValue !== "plan" && modeValue !== "live") {
    throw new Error("synthetic_validation_mode_invalid");
  }
  const personaValue = valueFor(args, "--personas") ?? "all";
  const personaIds =
    personaValue === "all"
      ? []
      : personaValue
          .split(",")
          .filter(Boolean)
          .map((value) =>
            SyntheticStudentPersonaIdSchema.parse(value.trim())
          );
  return {
    mode: modeValue,
    persona_ids: personaIds,
    persona_file: valueFor(args, "--persona-file") ?? null,
    output_dir:
      valueFor(args, "--output-dir") ??
      path.join(
        process.cwd(),
        ".data",
        "synthetic-student-validation"
      ),
    confirm_live_provider_calls: args.includes(
      "--confirm-live-provider-calls"
    ),
    cleanup: args.includes("--cleanup")
  };
}

async function loadPersonas(
  options: CliOptions
): Promise<SyntheticStudentPersona[]> {
  if (!options.persona_file) {
    return syntheticStudentPersonas(options.persona_ids);
  }
  const source = await readFile(
    path.resolve(options.persona_file),
    "utf8"
  );
  const personas = parseSyntheticStudentPersonas(JSON.parse(source));
  if (options.persona_ids.length === 0) {
    return personas;
  }
  const selected = new Set(options.persona_ids);
  return personas.filter((persona) => selected.has(persona.persona_id));
}

function commandRunPublicId() {
  return `synthetic_validation_${new Date()
    .toISOString()
    .replace(/[-:.TZ]/g, "")
    .slice(0, 14)}_${randomUUID().slice(0, 8)}`;
}

function assertLiveAuthorization(options: CliOptions) {
  if (
    !options.confirm_live_provider_calls ||
    process.env.SYNTHETIC_RESEARCH_LIVE_CALLS_ENABLED !== "true"
  ) {
    throw new Error(
      "synthetic_live_authorization_required: pass --confirm-live-provider-calls and set SYNTHETIC_RESEARCH_LIVE_CALLS_ENABLED=true"
    );
  }
  if (!process.env.RESEARCH_PSEUDONYMIZATION_KEY?.trim()) {
    throw new Error(
      "synthetic_live_research_export_configuration_missing"
    );
  }
}

async function writeJsonArtifact(
  outputDir: string,
  filename: string,
  value: unknown
) {
  await mkdir(outputDir, { recursive: true });
  const artifactPath = path.join(outputDir, filename);
  await writeFile(
    artifactPath,
    `${JSON.stringify(value, null, 2)}\n`,
    "utf8"
  );
  return artifactPath;
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const personas = await loadPersonas(options);
  if (personas.length === 0) {
    throw new Error("synthetic_persona_selection_empty");
  }
  const runPublicId = commandRunPublicId();

  if (options.mode === "plan") {
    const plan = buildSyntheticStudentValidationPlan(personas);
    const artifactPath = await writeJsonArtifact(
      options.output_dir,
      `${runPublicId}-plan.json`,
      {
        ...plan,
        run_public_id: runPublicId,
        generated_at: new Date().toISOString()
      }
    );
    console.log(
      JSON.stringify(
        {
          status: "planned",
          provider_calls: 0,
          run_public_id: runPublicId,
          persona_count: personas.length,
          estimated_logical_generation_calls:
            plan.estimated_logical_generation_calls,
          artifact_path: artifactPath
        },
        null,
        2
      )
    );
    return;
  }

  assertLiveAuthorization(options);
  const runner = createLiveFormativeConversationAgentRunner();
  let completed = false;
  try {
    const result = await runSyntheticStudentResearchValidation({
      mode: "live_llm",
      personas,
      run_public_id: runPublicId,
      runner_factory: () => runner
    });
    const reportHash = hashSyntheticValidationArtifact(result.report);
    const reportPath = await writeJsonArtifact(
      options.output_dir,
      `${runPublicId}-research-validation-report.json`,
      {
        ...result.report,
        report_sha256: reportHash
      }
    );
    await mkdir(options.output_dir, { recursive: true });
    const exportPath = path.join(
      options.output_dir,
      `${runPublicId}-${result.research_export.filename}`
    );
    await writeFile(exportPath, result.research_export.buffer);
    completed = true;
    console.log(
      JSON.stringify(
        {
          status:
            result.report.export_validation.status === "passed" &&
            result.report.live_execution_evidence_valid &&
            result.report.technical_reliability_report.failed_sessions ===
              0 &&
            result.report.architecture_review.issue_codes.length === 0
              ? "passed"
              : "completed_with_findings",
          run_public_id: runPublicId,
          persona_count: result.report.persona_count,
          report_path: reportPath,
          research_export_path: exportPath,
          report_sha256: reportHash,
          export_validation: result.report.export_validation.status,
          successful_sessions:
            result.report.technical_reliability_report
              .successful_sessions,
          failed_sessions:
            result.report.technical_reliability_report.failed_sessions,
          agent_failures:
            result.report.technical_reliability_report
              .agent_failure_count,
          retry_events:
            result.report.technical_reliability_report
              .retry_event_count,
          architecture_issue_codes:
            result.report.architecture_review.issue_codes,
          fixtures_retained: !options.cleanup
        },
        null,
        2
      )
    );
  } finally {
    if (options.cleanup || !completed) {
      await cleanupSyntheticStudentValidationRun(runPublicId);
    }
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      status: "failed",
      error_code:
        error instanceof Error
          ? error.message.split(":", 1)[0]
          : "synthetic_validation_failed"
    })
  );
  process.exitCode = 1;
});
