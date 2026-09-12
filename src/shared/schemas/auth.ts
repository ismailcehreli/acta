import { z } from "zod";

// Client and server share these schemas so accepted data and displayed
// validation errors cannot diverge.

export const emailSchema = z
  .string()
  .trim()
  .min(1, "Email address is required")
  .max(255, "Email address is too long")
  .email("Enter a valid email address")
  .transform((value) => value.toLowerCase());

/** Password rule: length is the only requirement (§15.3). */
export const passwordSchema = z
  .string()
  .min(10, "Password must be at least 10 characters")
  .max(200, "Password must be 200 characters or fewer");

export const loginSchema = z.object({
  email: emailSchema,
  // Login does not apply the new-password length rule so legacy short
  // passwords can still sign in without revealing password policy details.
  password: z.string().min(1, "Password is required").max(200),
  /**
   * "Remember me" only extends the session lifetime; it does not weaken any
   * other security rule.
   */
  remember: z.boolean().default(false),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required").max(200),
    newPassword: passwordSchema,
    newPasswordRepeat: z.string(),
  })
  .refine((data) => data.newPassword === data.newPasswordRepeat, {
    path: ["newPasswordRepeat"],
    message: "Passwords do not match",
  });

export type LoginInput = z.infer<typeof loginSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

/** Password-reset request (§15.3). */
export const resetRequestSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z
  .object({
    token: z.string().min(1),
    newPassword: passwordSchema,
    newPasswordRepeat: z.string(),
  })
  .refine((data) => data.newPassword === data.newPasswordRepeat, {
    message: "Passwords must match",
    path: ["newPasswordRepeat"],
  });
