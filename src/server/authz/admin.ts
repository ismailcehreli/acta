import { getCurrentUser, type CurrentUser } from "@/server/auth/current-user";

// Sistem yöneticisi rolü **işlevsel** yetkidir: ağaç, kullanıcı, takvim ve ayar
// yönetimi yapar; faaliyet içeriğine erişim vermez (§15.1). İçerik erişimi her
// zaman organizasyon ağacından gelir (İlke 1) ve Görev 3.3'teki görünürlük
// modülünden geçer.

export class AuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthorizationError";
  }
}

/** Yönetim ekranlarını kimin kullanabileceğini belirleyen saf kural. */
export function canManageOrganization(
  user: Pick<CurrentUser, "isSystemAdmin"> | null,
): boolean {
  return user?.isSystemAdmin === true;
}

/**
 * Sunucu eylemlerinin ilk satırı. Ekranın gizlenmesi güvenlik değildir; asıl
 * kontrol veriyi değiştiren yolun başındadır.
 */
export async function requireSystemAdmin(): Promise<CurrentUser> {
  const user = await getCurrentUser();

  if (!canManageOrganization(user)) {
    throw new AuthorizationError(
      "Bu işlem için sistem yöneticisi yetkisi gerekir.",
    );
  }

  return user as CurrentUser;
}
