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

export const studentEmailSchema = z
  .string()
  .max(254, "email must be 254 characters or fewer.")
  .transform((value) => value.trim().normalize("NFC"))
  .superRefine((value, context) => {
    if (value.length === 0) {
      return;
    }

    if (controlCharacters.test(value) || value.includes("\n") || value.includes("\r")) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "email must not include control characters or line breaks."
      });
      return;
    }

    const emailResult = z.string().email().safeParse(value);

    if (!emailResult.success) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "email must be a valid email address." });
    }
  });

const obviousPasswordValues = new Set([
  "password",
  "password1",
  "password12",
  "password123",
  "changeme",
  "changeit",
  "temporary",
  "temp1234",
  "12345678",
  "11111111",
  "abcdefgh",
  "qwertyui"
]);

export const studentPasswordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters.")
  .max(200, "Password must be 200 characters or fewer.")
  .superRefine((value, context) => {
    if (value.trim() !== value) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Password must not include leading or trailing whitespace."
      });
    }

    if (controlCharacters.test(value) || value.includes("\n") || value.includes("\r")) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Password must not include control characters or line breaks."
      });
    }

    if (obviousPasswordValues.has(value.toLocaleLowerCase("en-US"))) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Choose a less obvious password."
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

export function parseStudentEmail(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }

  const parsed = studentEmailSchema.parse(String(value));
  return parsed.length > 0 ? parsed : null;
}

export function parseStudentPassword(value: unknown, userId?: string) {
  const parsed = studentPasswordSchema.parse(value);

  if (userId && parsed.toLocaleLowerCase("en-US") === normalizeUserId(userId)) {
    throw new z.ZodError([
      {
        code: z.ZodIssueCode.custom,
        path: [],
        message: "Password must not be the same as user_id."
      }
    ]);
  }

  return parsed;
}

export function userIdValidationError(value: unknown) {
  const result = userIdSchema.safeParse(value);
  return result.success ? null : result.error.issues[0]?.message ?? "Invalid user_id.";
}

export function displayNameValidationError(value: unknown) {
  const result = displayNameSchema.safeParse(value ?? "");
  return result.success ? null : result.error.issues[0]?.message ?? "Invalid display_name.";
}

export function studentEmailValidationError(value: unknown) {
  const result = studentEmailSchema.safeParse(value ?? "");
  return result.success ? null : result.error.issues[0]?.message ?? "Invalid email.";
}
