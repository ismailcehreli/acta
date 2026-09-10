import type { CurrentUser } from "@/server/auth/current-user";

/** Yardım kütüphanesini sistem yöneticileri ve birim yöneticileri düzenler. */
export function canManageHelp(
  user: Pick<CurrentUser, "isSystemAdmin" | "isUnitManager"> | null,
): boolean {
  return user?.isSystemAdmin === true || user?.isUnitManager === true;
}
