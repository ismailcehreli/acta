import { prisma } from "@/server/db";

import { readSessionCookie } from "./cookies";
import { findActiveSession, touchSession } from "./session";

// Sunucu bileşenlerinin ve eylemlerin "kim giriş yapmış" sorusunu sorduğu tek
// yer. Görünürlük kararları buradan dönen kimlikle verilir (Görev 3.3).

export interface CurrentUser {
  id: string;
  fullName: string;
  email: string;
  orgUnitId: string;
  isSystemAdmin: boolean;
  /** Organizasyon kapsamındaki toplu raporları görebilir mi? */
  canViewReports: boolean;
  /** Skor ve takdir raporlarını görebilir mi? */
  canViewScoreReports: boolean;
  /** Tek ve korunan ana sistem yöneticisi. */
  isRoot: boolean;
  /** Birim yöneticisi mi (§4.4). Rol etiketi ve menü için gerekir. */
  isUnitManager: boolean;
  /** Bu kişiden günlük faaliyet beklenir mi (§7.4 istisnası). */
  writesActivities: boolean;
  /** E-posta bildirim tercihi (Görev 10.8); profil ekranında değiştirilir. */
  notificationMode: "INSTANT" | "DAILY_DIGEST" | "ACTION_ONLY";
  /** Profil resminin uzantısı; hesap rozetinde kullanılır (Görev 11.5). */
  avatarExtension: string | null;
  /** Faaliyetlere takdir verebilir mi (Görev 11.11). */
  canAppreciate: boolean;
  /** İlk girişte kendi parolasını belirlemeli mi? */
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

/** Oturum zorunlu olan yerlerde kullanılır; yoksa hata fırlatır. */
export async function requireCurrentUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();

  if (!user) {
    throw new Error("Oturum bulunamadı");
  }

  return user;
}
