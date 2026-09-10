import type { CurrentUser } from "@/server/auth/current-user";

/** Geri bildirimleri yalnız sistem yöneticileri yönetebilir. */
export function canManageFeedback(
  user: Pick<CurrentUser, "isSystemAdmin" | "isUnitManager"> | null,
): boolean {
  return user?.isSystemAdmin === true;
}
