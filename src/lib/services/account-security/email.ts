import { createHash } from "node:crypto";
import { z } from "zod";

const controlCharacters = /[\u0000-\u001F\u007F]/;

export const teacherEmailSchema = z
  .string()
  .max(254, "email must be 254 characters or fewer.")
  .transform((value) => value.trim().normalize("NFC"))
  .superRefine((value, context) => {
    if (value.length === 0) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Email is required." });
      return;
    }

    if (controlCharacters.test(value) || value.includes("\n") || value.includes("\r")) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Email must not include control characters or line breaks."
      });
      return;
    }

    const emailResult = z.string().email().safeParse(value);

    if (!emailResult.success) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Email must be a valid email address." });
    }
  });

export function normalizeTeacherEmail(value: unknown) {
  const display = teacherEmailSchema.parse(String(value ?? ""));
  return {
    display,
    normalized: display.toLocaleLowerCase("en-US")
  };
}

export function safeNormalizeTeacherEmail(value: unknown) {
  const result = teacherEmailSchema.safeParse(String(value ?? ""));
  if (!result.success) {
    return null;
  }

  return {
    display: result.data,
    normalized: result.data.toLocaleLowerCase("en-US")
  };
}

export function maskEmail(value?: string | null) {
  if (!value) {
    return null;
  }

  const [local, domain] = value.split("@");
  if (!local || !domain) {
    return "[invalid-email]";
  }

  const maskedLocal =
    local.length <= 2 ? `${local[0] ?? "*"}*` : `${local.slice(0, 1)}***${local.slice(-1)}`;
  const domainParts = domain.split(".");
  const domainName = domainParts[0] ?? "";
  const domainSuffix = domainParts.slice(1).join(".");
  const maskedDomain =
    domainName.length <= 2 ? `${domainName[0] ?? "*"}*` : `${domainName.slice(0, 1)}***${domainName.slice(-1)}`;

  return `${maskedLocal}@${maskedDomain}${domainSuffix ? `.${domainSuffix}` : ""}`;
}

export function safeHash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

