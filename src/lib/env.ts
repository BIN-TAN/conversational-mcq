import { z } from "zod";

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
  OPENAI_MODEL_ITEM_PREP: z.string().optional(),
  OPENAI_MODEL_RESPONSE_COLLECTION: z.string().optional(),
  OPENAI_MODEL_PROFILING: z.string().optional(),
  OPENAI_MODEL_PLANNING: z.string().optional(),
  OPENAI_MODEL_FOLLOWUP: z.string().optional()
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
