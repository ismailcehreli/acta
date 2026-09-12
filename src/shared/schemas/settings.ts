import { z } from "zod";

// SMTP settings (§12.3, §16.5). The password may be blank to preserve the
// existing encrypted value; it is never displayed.

export const smtpSettingsSchema = z.object({
  host: z
    .string()
    .trim()
    .min(1, "Server address is required")
    .max(255, "Server address must be 255 characters or fewer"),
  port: z.coerce
    .number()
    .int("Port must be an integer")
    .min(1, "The port must be between 1 and 65535")
    .max(65535, "The port must be between 1 and 65535"),
  secure: z.boolean().default(false),
  user: z.string().trim().max(255).optional().default(""),
  password: z.string().max(255).optional(),
  from: z
    .string()
    .trim()
    .min(1, "Sender address is required")
    .max(255, "Sender address must be 255 characters or fewer"),
});

export const testEmailSchema = z.object({
  to: z.string().trim().email("Enter a valid email address"),
});

export type SmtpSettingsInput = z.infer<typeof smtpSettingsSchema>;
