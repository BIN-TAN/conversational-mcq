import { z } from "zod";

export const MAX_INVITATIONS = 100;
export const MAX_CREDENTIAL_CSV_BYTES = 256 * 1024;
export const INVITATION_FIELDS = ["student_name", "username", "temporary_password", "login_url", "instructor_email", "instructor_name"] as const;
export const DEFAULT_INVITATION_SUBJECT = "Your assessment account and login details";
export const DEFAULT_INVITATION_BODY = `Hi {{student_name}},

Your assessment account is ready.

Login page: {{login_url}}
Username: {{username}}
Temporary password: {{temporary_password}}

You will be asked to change your password when you first sign in.

You have up to three attempts per assessment. You can review your previous attempts in the system. If you need additional attempts or forget your password in the future, please email me at {{instructor_email}}.

Best,
{{instructor_name}}`;

export const invitationEmail = z.string().trim().max(254).email().regex(/^[^\s<>;,\u0000-\u001f\u007f]+$/u).transform(v => v.toLowerCase());
const subject = z.string().trim().min(1).max(160).regex(/^[^\u0000-\u001f\u007f]+$/u);
export const invitationTemplateSchema = z.object({
  sender_email: invitationEmail,
  instructor_name: z.string().trim().min(1).max(120).regex(/^[^\u0000-\u001f\u007f]+$/u),
  subject,
  body: z.string().trim().min(1).max(8000)
}).strict().superRefine((value, context) => {
  const text = `${value.subject}\n${value.body}`;
  const tokens = [...text.matchAll(/\{\{([^{}]+)\}\}/g)].map(match => match[1]);
  if (tokens.some(token => !INVITATION_FIELDS.includes(token as typeof INVITATION_FIELDS[number])) || /[{}]/.test(text.replace(/\{\{[^{}]+\}\}/g, ""))) {
    context.addIssue({ code: "custom", message: "Use only the listed merge fields, with matching double braces." });
  }
  for (const required of ["username", "temporary_password", "login_url"]) {
    if (!value.body.includes(`{{${required}}}`)) context.addIssue({ code: "custom", message: `Keep {{${required}}} in the email body.` });
  }
  if (/\{\{(?:temporary_password|username)\}\}/.test(value.subject)) {
    context.addIssue({ code: "custom", message: "Keep login credentials in the email body, not the subject." });
  }
});
export type InvitationTemplate = z.infer<typeof invitationTemplateSchema>;
export const invitationMessageSchema = z.object({
  to: invitationEmail, from: invitationEmail, subject: subject.max(240), body: z.string().min(1).max(12000)
}).strict();
export type InvitationMessage = z.infer<typeof invitationMessageSchema>;
export type InvitationPreview = {
  user_id: string; display_name: string; message: InvitationMessage; ticket: string;
  masked_body: string;
  status: "ready" | "sent" | "failed" | "sending" | "unknown";
};
export type InvitationPreviewResult = {
  invitations: InvitationPreview[];
  excluded: Array<{ user_id: string; reason: string }>;
  expires_at: string;
};
export type InvitationConfig = {
  gmail_client_id: string | null; gmail_email: string | null; default_email: string; instructor_name: string;
  login_url: string; pending_count: number;
};

export function renderInvitation(template: InvitationTemplate, recipient: string, values: Record<typeof INVITATION_FIELDS[number], string>): InvitationMessage {
  const merge = (text: string) => text.replace(/\{\{([^{}]+)\}\}/g, (_, field: typeof INVITATION_FIELDS[number]) => values[field]);
  return invitationMessageSchema.parse({ to: recipient, from: template.sender_email,
    subject: merge(template.subject), body: merge(template.body) });
}
