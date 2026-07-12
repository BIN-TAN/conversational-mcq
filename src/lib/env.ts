import { z } from "zod";

const optionalEnum = <T extends [string, ...string[]]>(values: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), z.enum(values).optional());

const optionalPositiveInt = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.coerce.number().int().positive().optional()
);

const optionalNonnegativeNumber = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.coerce.number().nonnegative().optional()
);

const nonnegativeNumberWithDefault = (defaultValue: number) =>
  z.preprocess(
    (value) => (value === "" || value === undefined ? defaultValue : value),
    z.coerce.number().nonnegative()
  );

const positiveIntWithDefault = (defaultValue: number) =>
  z.preprocess(
    (value) => (value === "" || value === undefined ? defaultValue : value),
    z.coerce.number().int().positive()
  );

const booleanWithDefault = (defaultValue: boolean) =>
  z
    .preprocess(
      (value) => (value === "" || value === undefined ? (defaultValue ? "true" : "false") : value),
      z.enum(["true", "false"])
    )
    .transform((value) => value === "true");

function isValidTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

const serverEnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  DATABASE_URL: z
    .string()
    .min(1)
    .refine((value) => value.startsWith("postgresql://") || value.startsWith("postgres://"), {
      message: "DATABASE_URL must be a PostgreSQL connection string"
    }),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_API_KEY_FILE: z.string().optional(),
  LLM_PROVIDER: z.enum(["mock", "openai"]).default("mock"),
  LLM_LIVE_CALLS_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  OPENAI_MODEL_ITEM_VERIFICATION: z.string().optional(),
  OPENAI_MODEL_ITEM_ADMIN: z.string().optional(),
  OPENAI_MODEL_RESPONSE_COLLECTION: z.string().optional(),
  OPENAI_MODEL_PROFILING: z.string().optional(),
  OPENAI_MODEL_PROFILE_INTEGRATION: z.string().optional(),
  OPENAI_MODEL_PLANNING: z.string().optional(),
  OPENAI_MODEL_FOLLOWUP: z.string().optional(),
  OPENAI_MODEL_MCQ_DIAGNOSTIC_AUTHORING: z.string().optional(),
  OPENAI_MODEL_MCQ_FORMATTING: z.string().optional(),
  OPENAI_MODEL_CONNECTIVITY_TEST: z.string().optional(),
  OPENAI_REASONING_EFFORT_ITEM_VERIFICATION: optionalEnum([
    "none",
    "minimal",
    "low",
    "medium",
    "high"
  ]),
  OPENAI_REASONING_EFFORT_RESPONSE_COLLECTION: optionalEnum([
    "none",
    "minimal",
    "low",
    "medium",
    "high"
  ]),
  OPENAI_REASONING_EFFORT_PROFILING: optionalEnum(["none", "minimal", "low", "medium", "high"]),
  OPENAI_REASONING_EFFORT_PLANNING: optionalEnum(["none", "minimal", "low", "medium", "high"]),
  OPENAI_REASONING_EFFORT_FOLLOWUP: optionalEnum(["none", "minimal", "low", "medium", "high"]),
  OPENAI_MAX_OUTPUT_TOKENS_ITEM_VERIFICATION: optionalPositiveInt,
  OPENAI_MAX_OUTPUT_TOKENS_ITEM_ADMIN: optionalPositiveInt,
  OPENAI_MAX_OUTPUT_TOKENS_RESPONSE_COLLECTION: optionalPositiveInt,
  OPENAI_MAX_OUTPUT_TOKENS_PROFILING: optionalPositiveInt,
  OPENAI_MAX_OUTPUT_TOKENS_PROFILE_INTEGRATION: optionalPositiveInt,
  OPENAI_MAX_OUTPUT_TOKENS_PLANNING: optionalPositiveInt,
  OPENAI_MAX_OUTPUT_TOKENS_FOLLOWUP: optionalPositiveInt,
  OPENAI_MAX_OUTPUT_TOKENS_MCQ_DIAGNOSTIC_AUTHORING: optionalPositiveInt,
  OPENAI_MAX_OUTPUT_TOKENS_MCQ_FORMATTING: optionalPositiveInt,
  OPENAI_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(60000),
  OPENAI_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  ITEM_ADMIN_TUTOR_MODE: z.enum(["auto", "mock", "live"]).default("auto"),
  ITEM_ADMIN_TUTOR_LIVE_ENABLED: booleanWithDefault(false),
  ALLOW_LOCAL_MOCK_RUNTIME: booleanWithDefault(false),
  COURSE_TIMEZONE: z
    .string()
    .default("America/Edmonton")
    .refine(isValidTimeZone, "COURSE_TIMEZONE must be a valid IANA timezone"),
  DEVELOPMENT_ACTIVE_SESSION_CONTROLS_ENABLED: booleanWithDefault(false),
  ALLOW_MANUAL_REVIEW_STUDENT_STARTS: booleanWithDefault(false),
  LLM_DAILY_CLASS_CALL_LIMIT: positiveIntWithDefault(200),
  LLM_DAILY_CLASS_TOKEN_LIMIT: positiveIntWithDefault(500_000),
  LLM_DAILY_STUDENT_CALL_LIMIT: positiveIntWithDefault(25),
  LLM_DAILY_STUDENT_TOKEN_LIMIT: positiveIntWithDefault(75_000),
  LLM_SESSION_CALL_LIMIT: positiveIntWithDefault(20),
  LLM_SESSION_TOKEN_LIMIT: positiveIntWithDefault(50_000),
  LLM_AGENT_CALL_LIMIT_PER_SESSION: positiveIntWithDefault(8),
  LLM_COST_WARNING_LIMIT_USD: optionalNonnegativeNumber,
  LLM_COST_HARD_LIMIT_USD: optionalNonnegativeNumber,
  LLM_USAGE_TIMEZONE: z
    .string()
    .default("UTC")
    .refine(isValidTimeZone, "LLM_USAGE_TIMEZONE must be a valid IANA timezone"),
  FOLLOWUP_CONTEXT_MAX_TURNS: positiveIntWithDefault(24),
  FOLLOWUP_MESSAGE_MAX_CHARS: positiveIntWithDefault(6000),
  FOLLOWUP_CONTEXT_MAX_CHARS: positiveIntWithDefault(50000),
  ALLOW_MOCK_RESPONSE_COLLECTION_IN_STUDENT_WORKFLOW: booleanWithDefault(false),
  INITIAL_CHAT_MESSAGE_MAX_CHARS: positiveIntWithDefault(6000),
  RESPONSE_COLLECTION_CONTEXT_MAX_TURNS: positiveIntWithDefault(12),
  RESPONSE_COLLECTION_CONTEXT_MAX_CHARS: positiveIntWithDefault(20000),
  FOLLOWUP_SUBSTANTIVE_TURNS_BEFORE_UPDATE: positiveIntWithDefault(3),
  OPERATIONAL_AGENT_MODE: z.enum(["disabled", "mock", "guarded_live"]).default("disabled"),
  OPERATIONAL_APPROVED_CONFIG_HASH: z.string().optional(),
  OPERATIONAL_EFFECTIVE_RESULT_VERSION: z.string().default("effective-system-eval-v2"),
  OPERATIONAL_EFFECTIVE_VALIDATOR_VERSION: z.string().default("effective-validator-v1"),
  OPERATIONAL_AGENT_INTEGRATION_ENABLED: booleanWithDefault(false),
  OPERATIONAL_AGENT_INTEGRATION_EVAL_EVIDENCE_REQUIRED: booleanWithDefault(true),
  OPERATIONAL_AGENT_INTEGRATION_APPROVED_TARGETED_RUN_ID: z
    .string()
    .min(1)
    .default("evr_20260624_bltzgtq"),
  OPERATIONAL_LIVE_CANARY_ENABLED: booleanWithDefault(false),
  OPERATIONAL_LIVE_CANARY_TARGET_MODEL: z.string().min(1).default("gpt-5.4-mini-2026-03-17"),
  OPERATIONAL_LIVE_CANARY_REASONING_EFFORT: z.enum(["low"]).default("low"),
  OPERATIONAL_LIVE_CANARY_COST_HARD_LIMIT_USD: nonnegativeNumberWithDefault(15),
  OPERATIONAL_LIVE_CANARY_MAX_PROVIDER_REQUESTS: positiveIntWithDefault(80),
  OPERATIONAL_LIVE_CANARY_MAX_CONCURRENCY: positiveIntWithDefault(1),
  OPERATIONAL_LIVE_CANARY_MAX_RETRIES: z.preprocess(
    (value) => (value === "" || value === undefined ? 1 : value),
    z.coerce.number().int().min(0).max(3)
  ),
  OPERATIONAL_LIVE_CANARY_REQUEST_TIMEOUT_MS: positiveIntWithDefault(60000),
  OPERATIONAL_LIVE_CANARY_APPROVED_CONFIG_HASH: z.string().optional(),
  OPERATIONAL_LIVE_CANARY_DATABASE_URL: z.string().optional(),
  WORKFLOW_JOB_MAX_ATTEMPTS: positiveIntWithDefault(3),
  WORKFLOW_JOB_BASE_RETRY_MS: positiveIntWithDefault(5000),
  WORKFLOW_JOB_MAX_RETRY_MS: positiveIntWithDefault(300000),
  WORKFLOW_JOB_LEASE_TIMEOUT_MS: positiveIntWithDefault(300000),
  WORKFLOW_JOB_POLL_INTERVAL_MS: positiveIntWithDefault(2000),
  EVAL_PROVIDER: z.enum(["mock", "openai"]).default("mock"),
  EVAL_TARGET_MODEL: z.string().min(1).default("gpt-5.4-mini-2026-03-17"),
  EVAL_REASONING_EFFORT: z.enum(["low"]).default("low"),
  EVAL_DEFAULT_REPETITIONS: positiveIntWithDefault(2),
  EVAL_CANARY_REPETITIONS: positiveIntWithDefault(1),
  EVAL_CANARY_CASES_PER_AGENT: positiveIntWithDefault(5),
  EVAL_LIVE_CALLS_ENABLED: booleanWithDefault(false),
  EVAL_COST_HARD_LIMIT_USD: nonnegativeNumberWithDefault(50),
  EVAL_MAX_CONCURRENCY: positiveIntWithDefault(1),
  EVAL_MAX_RETRIES: z.preprocess(
    (value) => (value === "" || value === undefined ? 1 : value),
    z.coerce.number().int().min(0).max(3)
  ),
  EVAL_REQUEST_TIMEOUT_MS: positiveIntWithDefault(60000),
  EVAL_MAX_PROVIDER_REQUESTS: positiveIntWithDefault(50),
  EVAL_MAX_OUTPUT_TOKENS_ITEM_VERIFICATION: positiveIntWithDefault(3000),
  EVAL_MAX_OUTPUT_TOKENS_RESPONSE_COLLECTION: positiveIntWithDefault(1500),
  EVAL_MAX_OUTPUT_TOKENS_PROFILING: positiveIntWithDefault(4000),
  EVAL_MAX_OUTPUT_TOKENS_PLANNING: positiveIntWithDefault(3000),
  EVAL_MAX_OUTPUT_TOKENS_FOLLOWUP: positiveIntWithDefault(2500),
  EVAL_PILOT_PROVIDER: z.enum(["mock", "openai"]).default("openai"),
  EVAL_PILOT_LIVE_CALLS_ENABLED: booleanWithDefault(false),
  EVAL_PILOT_APPROVED_CANARY_RUN_ID: z.string().optional(),
  EVAL_PILOT_TARGET_MODEL: z.string().min(1).default("gpt-5.4-mini-2026-03-17"),
  EVAL_PILOT_REASONING_EFFORT: z.enum(["low"]).default("low"),
  EVAL_PILOT_REPETITIONS: positiveIntWithDefault(2),
  EVAL_PILOT_INTERNAL_HOLDOUT_CASES_PER_AGENT: positiveIntWithDefault(5),
  EVAL_PILOT_REPLICATION_CASES_PER_AGENT: positiveIntWithDefault(5),
  EVAL_PILOT_COST_HARD_LIMIT_USD: nonnegativeNumberWithDefault(50),
  EVAL_PILOT_MAX_PROVIDER_REQUESTS: positiveIntWithDefault(150),
  EVAL_PILOT_MAX_CONCURRENCY: positiveIntWithDefault(1),
  EVAL_PILOT_MAX_RETRIES: z.preprocess(
    (value) => (value === "" || value === undefined ? 1 : value),
    z.coerce.number().int().min(0).max(3)
  ),
  EVAL_PILOT_REQUEST_TIMEOUT_MS: positiveIntWithDefault(60000),
  EVAL_TARGETED_REMEDIATION_COST_HARD_LIMIT_USD: nonnegativeNumberWithDefault(10),
  EVAL_TARGETED_REMEDIATION_MAX_PROVIDER_REQUESTS: positiveIntWithDefault(35),
  EVAL_TARGETED_REMEDIATION_MAX_CONCURRENCY: positiveIntWithDefault(1),
  EVAL_TARGETED_REMEDIATION_MAX_RETRIES: z.preprocess(
    (value) => (value === "" || value === undefined ? 1 : value),
    z.coerce.number().int().min(0).max(3)
  ),
  EVAL_TARGETED_REMEDIATION_REQUEST_TIMEOUT_MS: positiveIntWithDefault(60000)
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function getServerEnv(): ServerEnv {
  const parsed = serverEnvSchema.safeParse(process.env);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => {
        const path = issue.path.join(".");
        if (path === "ALLOW_LOCAL_MOCK_RUNTIME") {
          return [
            "ALLOW_LOCAL_MOCK_RUNTIME: expected 'true' or 'false' when set",
            "missing is allowed and defaults to false"
          ].join("; ");
        }

        return `${path}: ${issue.message}`;
      })
      .join("; ");

    throw new Error(`Invalid environment configuration: ${details}`);
  }

  return parsed.data;
}
