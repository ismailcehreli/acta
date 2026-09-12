import { z } from "zod";

import { emailSchema, passwordSchema } from "./auth";

// User-management input (§4.6, §15.1).

export const fullNameSchema = z
  .string()
  .trim()
  .min(3, "Full name must be at least 3 characters")
  .max(150, "Full name must be 150 characters or fewer");

/**
 * Title is optional and does not grant permission: visibility and approval
 * come from the organization tree. Blank titles are stored as `null`.
 */
export const titleSchema = z
  .string()
  .trim()
  .max(100, "Title must be 100 characters or fewer")
  .transform((value) => (value === "" ? null : value))
  .nullable()
  .optional();

export const createUserSchema = z.object({
  fullName: fullNameSchema,
  title: titleSchema,
  email: emailSchema,
  orgUnitId: z.string().uuid("Select a unit"),
  /**
   * Whether the user is a unit manager. A unit may have multiple managers;
   * the first decision closes the process.
   */
  isUnitManager: z.boolean().default(false),
  /** Functional permission; does not grant content access (§15.1). */
  isSystemAdmin: z.boolean().default(false),
  /** Can view consolidated reports within the organization scope. */
  canViewReports: z.boolean().default(false),
  /** Can view score and appreciation reports. */
  canViewScoreReports: z.boolean().default(false),
  /**
   * Whether the person is expected to enter daily activities. Set to `false`
   * for roles that do not write activities.
   */
  /** Whether scores are calculated (task 11.10). */
  isScored: z.boolean().default(true),
  /** Whether the user can recognize activities (task 11.11). */
  canAppreciate: z.boolean().default(false),
  writesActivities: z.boolean().default(true),
  /** Initial password; the user can change it after the first sign-in. */
  initialPassword: passwordSchema,
});

export const deactivateUserSchema = z.object({
  id: z.string().uuid(),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;

/** Close open conversations with a reason when deactivating a user (§4.6). */
export const closeConversationsForUserSchema = z.object({
  id: z.string().uuid(),
  reason: z
    .string()
    .trim()
    .min(1, "Closing reason is required")
    .max(500, "Reason must be 500 characters or fewer"),
});

/** User information editing (§4.6); password changes use a separate flow. */
export const updateUserSchema = z.object({
  id: z.string().uuid(),
  fullName: fullNameSchema,
  title: titleSchema,
  email: emailSchema,
  orgUnitId: z.string().uuid("Select a unit"),
  isUnitManager: z.boolean().default(false),
  isSystemAdmin: z.boolean().default(false),
  canViewReports: z.boolean().default(false),
  canViewScoreReports: z.boolean().default(false),
  /** Whether scores are calculated. */
  isScored: z.boolean().default(true),
  /** Whether the user can recognize activities. */
  canAppreciate: z.boolean().default(false),
  writesActivities: z.boolean().default(true),
});

/** Narrow set of fields the root account can change from its own screen. */
export const rootSelfUpdateSchema = z.object({
  id: z.string().uuid(),
  orgUnitId: z.string().uuid("Select a unit"),
  /** Root user's daily activity expectation. */
  writesActivities: z.boolean(),
  /** Whether to calculate the root user's score. */
  isScored: z.boolean(),
  /** Whether the root user can recognize activities. */
  canAppreciate: z.boolean(),
  /** Whether the root user can view management reports. */
  canViewReports: z.boolean(),
  /** Whether the root user can view score and recognition reports. */
  canViewScoreReports: z.boolean(),
});

/**
 * Fields a unit manager can edit.
 *
 * The design permits name and title edits within the manager's subtree. No
 * other fields belong to that path, so extra fields are rejected rather than
 * silently cleaned.
 */
/**
 * Fields a unit manager may provide when creating a user.
 *
 * Flags and roles are omitted from the input; the server determines them.
 */
export const managerCreateUserSchema = z.object({
  fullName: fullNameSchema,
  title: titleSchema,
  email: emailSchema,
  orgUnitId: z.string().uuid("Select a unit"),
});

export type ManagerCreateUserInput = z.infer<typeof managerCreateUserSchema>;

export const managerUpdateUserSchema = z.object({
  id: z.string().uuid(),
  fullName: fullNameSchema,
  title: titleSchema,
});

export type ManagerUpdateUserInput = z.infer<typeof managerUpdateUserSchema>;

/** System administrator setting a user's password (§15.1, §15.3). */
export const setUserPasswordSchema = z.object({
  id: z.string().uuid(),
  newPassword: passwordSchema,
});
