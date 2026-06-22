import { z } from "zod";

const controlCharacters = /[\p{Cc}\p{Cf}]/u;
const allowedUserIdCharacters = /^[\p{L}\p{N}._@-]+$/u;

export function normalizeUserId(value: string) {
  return value.trim().normalize("NFC").toLocaleLowerCase("en-US");
}

export const userIdSchema = z
  .string()
  .min(1, "user_id is required.")
  .max(100, "user_id must be 100 characters or fewer.")
  .transform((value) => value.normalize("NFC"))
  .superRefine((value, context) => {
    const trimmed = value.trim();

    if (trimmed.length === 0) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "user_id is required." });
      return;
    }

    if (trimmed !== value) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "user_id must not include leading or trailing whitespace."
      });
    }

    if (controlCharacters.test(value) || value.includes("\n") || value.includes("\r")) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "user_id must not include control characters or line breaks."
      });
    }

    if (!allowedUserIdCharacters.test(trimmed)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "user_id may contain letters, numbers, period, underscore, hyphen, and @."
      });
    }
  })
  .transform((value) => value.trim());

export const displayNameSchema = z
  .string()
  .max(200, "display_name must be 200 characters or fewer.")
  .transform((value) => value.trim().normalize("NFC"))
  .superRefine((value, context) => {
    if (controlCharacters.test(value) || value.includes("\n") || value.includes("\r")) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "display_name must not include control characters or line breaks."
      });
    }
  });

export function parseUserId(value: unknown) {
  return userIdSchema.parse(value);
}

export function parseDisplayName(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }

  const parsed = displayNameSchema.parse(String(value));
  return parsed.length > 0 ? parsed : null;
}

export function userIdValidationError(value: unknown) {
  const result = userIdSchema.safeParse(value);
  return result.success ? null : result.error.issues[0]?.message ?? "Invalid user_id.";
}

export function displayNameValidationError(value: unknown) {
  const result = displayNameSchema.safeParse(value ?? "");
  return result.success ? null : result.error.issues[0]?.message ?? "Invalid display_name.";
}
