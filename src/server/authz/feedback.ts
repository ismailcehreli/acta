import type { CurrentUser } from "@/server/auth/current-user";


export function canManageFeedback(
  user: Pick<CurrentUser, "isSystemAdmin" | "isUnitManager"> | null,
): boolean {
  return user?.isSystemAdmin === true;
}
