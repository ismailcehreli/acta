import { PrismaClient } from "@prisma/client";

import { setUserPassword } from "@/server/users/update";
import { passwordSchema } from "@/shared/schemas/auth";

// Emergency server-side password reset.
// Used when the sole system administrator is locked out and email delivery is unavailable.
// Password is read from environment variables to avoid appearing in process lists (ps) or shell history.
//
// Usage:
//   RESET_EMAIL=user@company.com RESET_PASSWORD='...' pnpm reset:password

const EMAIL = process.env.RESET_EMAIL ?? "";
const PASSWORD = process.env.RESET_PASSWORD ?? "";

function log(message: string): void {
  console.log(`[password] ${message}`);
}

async function main(): Promise<void> {
  if (EMAIL === "" || PASSWORD === "") {
    log("RESET_EMAIL and RESET_PASSWORD environment variables are required.");
    log("Example: RESET_EMAIL=user@company.com RESET_PASSWORD='...' pnpm reset:password");
    process.exitCode = 1;
    return;
  }

  const validation = passwordSchema.safeParse(PASSWORD);
  if (!validation.success) {
    log(validation.error.issues[0]?.message ?? "Password does not meet complexity requirements.");
    process.exitCode = 1;
    return;
  }

  const db = new PrismaClient();

  try {
    const user = await db.user.findUnique({
      where: { email: EMAIL.trim().toLowerCase() },
      select: { id: true, fullName: true, isActive: true },
    });

    if (!user) {
      log(`User not found: ${EMAIL}`);
      process.exitCode = 1;
      return;
    }

    if (!user.isActive) {
      log(`Account is inactive: ${EMAIL}. Reactivate first via Admin panel.`);
      process.exitCode = 1;
      return;
    }

    const result = await setUserPassword(db, user.id, PASSWORD, new Date());

    if (!result.ok) {
      log(`Failed to update password: ${result.message}`);
      process.exitCode = 1;
      return;
    }

    log(`Password updated successfully: ${user.fullName} <${EMAIL}>`);
    log("All active sessions for this user were invalidated; re-login is required.");
    log("Any active account lockout has been cleared.");
  } finally {
    await db.$disconnect();
  }
}

main();
