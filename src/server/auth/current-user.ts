import { prisma } from "@/server/db";

import { readSessionCookie } from "./cookies";
import { findActiveSession, touchSession } from "./session";




export interface CurrentUser {
  id: string;
  fullName: string;
  email: string;
  orgUnitId: string;
  isSystemAdmin: boolean;

  canViewReports: boolean;
  /** Can view score and appreciation reports? */
  canViewScoreReports: boolean;

  isRoot: boolean;

  isUnitManager: boolean;

  writesActivities: boolean;

  notificationMode: "INSTANT" | "DAILY_DIGEST" | "ACTION_ONLY";

  avatarExtension: string | null;

  canAppreciate: boolean;

  mustChangePassword: boolean;
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const token = await readSessionCookie();
  if (!token) return null;

  const now = new Date();
  const session = await findActiveSession(prisma, token, now);
  if (!session) return null;

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: {
      id: true,
      isUnitManager: true,
      fullName: true,
      email: true,
      orgUnitId: true,
      isSystemAdmin: true,
      canViewReports: true,
      canViewScoreReports: true,
      isRoot: true,
      writesActivities: true,
      notificationMode: true,
      avatarExtension: true,
      canAppreciate: true,
      credential: { select: { mustChangePassword: true } },
    },
  });

  if (!user) return null;

  await touchSession(prisma, session.sessionId, now);

  return {
    ...user,
    mustChangePassword: user.credential?.mustChangePassword ?? false,
  };
}


export async function requireCurrentUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();

  if (!user) {
    throw new Error("Session not found.");
  }

  return user;
}
