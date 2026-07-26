import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  buildProductionSafeErrorRecord,
  isProductionSafeErrorRecord,
  logProductionError
} from "../src/lib/observability/production-safe-logger";

const projectRoot = process.cwd();
let networkRequestCount = 0;

globalThis.fetch = async () => {
  networkRequestCount += 1;
  throw new Error("e2a48a_network_request_prohibited");
};

const REQUIRED_SAFE_LOGGING_PATHS = [
  "src/app/api/teacher/system/llm-status/route.ts",
  "src/lib/services/content/api.ts",
  "src/lib/services/evals/api.ts",
  "src/lib/services/evals/service.ts",
  "src/lib/services/master-export/api.ts",
  "src/lib/services/student-accounts/api.ts",
  "src/lib/services/student-assessment/api.ts",
  "src/lib/services/summative-outcomes/api.ts",
  "src/lib/services/teacher-review/api.ts"
] as const;

const FORBIDDEN_LOG_CONTENT = [
  "student response",
  "student reasoning",
  "hidden prompt",
  "chain-of-thought",
  "authorization",
  "database_url",
  "session_secret",
  "openai_api_key",
  "provider payload",
  "sk-proj-test-secret"
] as const;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function source(relativePath: string) {
  return readFileSync(path.join(projectRoot, relativePath), "utf8");
}

function recursivelyList(relativeDirectory: string): string[] {
  const absoluteDirectory = path.join(projectRoot, relativeDirectory);
  return readdirSync(absoluteDirectory, { withFileTypes: true }).flatMap(
    (entry) => {
      const relativePath = path.join(relativeDirectory, entry.name);
      return entry.isDirectory()
        ? recursivelyList(relativePath)
        : [relativePath];
    }
  );
}

function sourceReferences(relativePaths: string[], pattern: RegExp) {
  return relativePaths.flatMap((relativePath) =>
    source(relativePath)
      .split(/\r?\n/u)
      .flatMap((line, index) => {
        pattern.lastIndex = 0;
        return pattern.test(line)
          ? [`${relativePath}:${index + 1}`]
          : [];
      })
  );
}

function rawProductionLogReferences() {
  const productionPaths = [
    ...recursivelyList("src/app"),
    ...recursivelyList("src/lib/services")
  ].filter((relativePath) => /\.(?:ts|tsx)$/u.test(relativePath));
  return sourceReferences(
    productionPaths,
    /console\.(?:error|warn|log)\(\s*(?:error|err|exception)\b(?:\.(?:message|stack|cause))?/u
  );
}

function directProductionConsoleReferences() {
  const productionPaths = [
    ...recursivelyList("src/app"),
    ...recursivelyList("src/lib/services")
  ].filter((relativePath) => /\.(?:ts|tsx)$/u.test(relativePath));
  return sourceReferences(
    productionPaths,
    /console\.(?:error|warn|log)\(/u
  );
}

function captureSafeLog() {
  const originalConsoleError = console.error;
  const calls: unknown[][] = [];
  console.error = (...args: unknown[]) => {
    calls.push(args);
  };

  try {
    const unsafeError = Object.assign(
      new Error(
        "student response and student reasoning with sk-proj-test-secret"
      ),
      {
        hidden_prompt: "hidden prompt",
        provider_payload: "provider payload",
        database_url: "database_url",
        chain_of_thought: "chain-of-thought"
      }
    );
    const record = logProductionError(unsafeError, {
      safe_error_code: "student_assessment_route_unhandled_error",
      request_id: "req_public_123",
      session_id: "sess_public_456"
    });
    assert(calls.length === 1, "e2a48a_expected_one_structured_log");
    assert(
      calls[0].length === 1 && typeof calls[0][0] === "string",
      "e2a48a_log_must_be_one_serialized_record"
    );
    const serialized = calls[0][0] as string;
    const parsed = JSON.parse(serialized) as unknown;
    return { record, parsed, serialized };
  } finally {
    console.error = originalConsoleError;
  }
}

function loggingRegressions() {
  const captured = captureSafeLog();
  const invalidContextRecord = buildProductionSafeErrorRecord(
    new Error("student response must not escape"),
    {
      safe_error_code: "student response with spaces",
      request_id: "student response",
      session_id: "session/id"
    },
    new Date("2026-07-26T00:00:00.000Z")
  );
  const normalizedSerialized = captured.serialized.toLowerCase();

  const rawLeakSampleDetected =
    /console\.(?:error|warn|log)\(\s*(?:error|err|exception)\b/u.test(
      "console.error(error);"
    );
  const requiredPathsUseSafeLogger = REQUIRED_SAFE_LOGGING_PATHS.every(
    (relativePath) => {
      const text = source(relativePath);
      return (
        text.includes(
          '@/lib/observability/production-safe-logger'
        ) &&
        text.includes("logProductionError(") &&
        !/console\.(?:error|warn|log)\(/u.test(text)
      );
    }
  );

  return [
    {
      case_id: "raw_error_leakage_detection",
      passed:
        rawLeakSampleDetected &&
        rawProductionLogReferences().length === 0 &&
        directProductionConsoleReferences().length === 0 &&
        requiredPathsUseSafeLogger
    },
    {
      case_id: "student_data_leakage_detection",
      passed: FORBIDDEN_LOG_CONTENT.every(
        (value) => !normalizedSerialized.includes(value)
      )
    },
    {
      case_id: "safe_logging_validation",
      passed:
        isProductionSafeErrorRecord(captured.record) &&
        isProductionSafeErrorRecord(captured.parsed) &&
        captured.record.safe_error_code ===
          "student_assessment_route_unhandled_error" &&
        captured.record.request_id === "req_public_123" &&
        captured.record.session_id === "sess_public_456"
    },
    {
      case_id: "unsafe_context_is_not_serialized",
      passed:
        invalidContextRecord.safe_error_code === "invalid_safe_error_code" &&
        invalidContextRecord.request_id === undefined &&
        invalidContextRecord.session_id === undefined &&
        isProductionSafeErrorRecord(invalidContextRecord)
    }
  ];
}

function documentationRegressions() {
  const runbook = source("docs/RENDER_STAGING_DEPLOYMENT_RUNBOOK.md");
  const readiness = source("docs/PRODUCTION_DEPLOYMENT_READINESS.md");
  const combined = `${runbook}\n${readiness}`;

  return [
    {
      case_id: "rollback_documentation_validation",
      passed:
        runbook.includes("## Application Rollback") &&
        runbook.includes("## Database Rollback and Recovery") &&
        /previous successful (?:application )?deployment/iu.test(runbook) &&
        /backup/iu.test(runbook) &&
        /restore/iu.test(runbook) &&
        /schema-compatible|schema compatible|compatibility/iu.test(runbook) &&
        runbook.includes("/api/health") &&
        runbook.includes("Do not use `prisma migrate reset`")
    },
    {
      case_id: "build_requirement_validation",
      passed:
        /Node(?:\.js)? 22/iu.test(combined) &&
        combined.includes("npm ci --include=dev") &&
        combined.includes("npm run prisma:generate") &&
        combined.includes("NODE_OPTIONS=--max-old-space-size=12288") &&
        combined.includes("NEXT_PRIVATE_BUILD_WORKER=1") &&
        combined.includes("npm run build") &&
        /12 GB Node heap/iu.test(combined) &&
        /Render build(?:-environment)? capacity/iu.test(combined) &&
        /runtime-plan memory|runtime memory/iu.test(combined)
    }
  ];
}

function main() {
  const cases = [
    ...loggingRegressions(),
    ...documentationRegressions()
  ];
  assert(cases.length === 6, "e2a48a_regression_count_mismatch");
  assert(
    cases.every((entry) => entry.passed),
    `e2a48a_regression_failed:${cases
      .filter((entry) => !entry.passed)
      .map((entry) => entry.case_id)
      .join(",")}`
  );
  assert(
    networkRequestCount === 0,
    "e2a48a_provider_call_guard_detected_network_request"
  );

  console.log(
    JSON.stringify(
      {
        status: "passed",
        regression_version:
          "e2a48a-production-deployment-hardening-regressions-v1",
        regression_count: cases.length,
        cases,
        required_safe_logging_path_count:
          REQUIRED_SAFE_LOGGING_PATHS.length,
        raw_production_log_reference_count:
          rawProductionLogReferences().length,
        direct_production_console_reference_count:
          directProductionConsoleReferences().length,
        provider_calls_made: 0,
        network_requests_made: networkRequestCount,
        production_database_queries_made: 0,
        deployment_executed: false,
        candidate_approved: false,
        candidate_activated: false
      },
      null,
      2
    )
  );
}

main();
