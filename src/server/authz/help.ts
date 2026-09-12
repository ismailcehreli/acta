import type { CurrentUser } from "@/server/auth/current-user";


export function canManageHelp(
  user: Pick<CurrentUser, "isSystemAdmin" | "isUnitManager"> | null,
): boolean {
  return user?.isSystemAdmin === true || user?.isUnitManager === true;
}
