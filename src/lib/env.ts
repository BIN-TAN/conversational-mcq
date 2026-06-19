import { z } from "zod";

const optionalEnum = <T extends [string, ...string[]]>(values: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), z.enum(values).optional());

const optionalPositiveInt = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.coerce.number().int().positive().optional()
);

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
  LLM_PROVIDER: z.enum(["mock", "openai"]).default("mock"),
  LLM_LIVE_CALLS_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  OPENAI_MODEL_ITEM_PREP: z.string().optional(),
  OPENAI_MODEL_RESPONSE_COLLECTION: z.string().optional(),
  OPENAI_MODEL_PROFILING: z.string().optional(),
  OPENAI_MODEL_PLANNING: z.string().optional(),
  OPENAI_MODEL_FOLLOWUP: z.string().optional(),
  OPENAI_MODEL_CONNECTIVITY_TEST: z.string().optional(),
  OPENAI_REASONING_EFFORT_ITEM_PREP: optionalEnum(["none", "minimal", "low", "medium", "high"]),
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
  OPENAI_MAX_OUTPUT_TOKENS_ITEM_PREP: optionalPositiveInt,
  OPENAI_MAX_OUTPUT_TOKENS_RESPONSE_COLLECTION: optionalPositiveInt,
  OPENAI_MAX_OUTPUT_TOKENS_PROFILING: optionalPositiveInt,
  OPENAI_MAX_OUTPUT_TOKENS_PLANNING: optionalPositiveInt,
  OPENAI_MAX_OUTPUT_TOKENS_FOLLOWUP: optionalPositiveInt,
  OPENAI_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(60000),
  OPENAI_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2)
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function getServerEnv(): ServerEnv {
  const parsed = serverEnvSchema.safeParse(process.env);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");

    throw new Error(`Invalid environment configuration: ${details}`);
  }

  return parsed.data;
}
