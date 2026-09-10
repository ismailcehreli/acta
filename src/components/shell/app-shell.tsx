import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import { logoutAction } from "@/app/(auth)/logout/actions";
import { LiveRefresh } from "@/components/realtime/live-refresh";
import { APP_VERSION } from "@/server/version";
import { prisma } from "@/server/db";
import { readBranding } from "@/server/settings/branding";
import type { BellItem } from "./notification-bell";
import { markNotificationsSeenAction } from "./notification-actions";
import { ShellNav } from "./shell-nav";
import { initials } from "@/shared/format/avatar-initials";

// Uygulama kabuğu (§13). Menü **kademeye göre** değişir ama düzen değişmez
// (§13.1: "Öğrenilecek tek bir arayüz olur"). Yetkisi olmayan bir bağlantı
// hiç render edilmez — görmediği bağlantı kullanıcıyı yetkisiz ekrana
// götürmez ve "yetkiniz yok" sayfasıyla karşılaşmaz.

export interface ShellUser {
  id: string;
  fullName: string;
  /** Profil resminin uzantısı; boşsa hesap rozetinde baş harfler (Görev 11.5). */
  avatarExtension: string | null;
  isSystemAdmin: boolean;
  isUnitManager: boolean;
  /** Organizasyon kapsamındaki toplu raporları görebilir mi? */
  canViewReports: boolean;
  /** Skor ve takdir raporlarını görebilir mi? */
  canViewScoreReports: boolean;
  /** Astı var mı; ekip bağlantıları buna bağlı. */
  hasTeam: boolean;
  /** Bu kişiden faaliyet bekleniyor mu (§7.4); "Yeni faaliyet" eylemi buna bağlı. */
  writesActivities: boolean;
  /** Onayını bekleyen kayıt sayısı; bölüm ve rozet buna bağlı. */
  pendingApprovals: number;
  /** Gönderilmemiş taslak sayısı. */
  draftCount: number;
  /** Vekâlet geçmişi ya da aktif vekâleti var mı. */
  hasDeputyHistory: boolean;
  /** Skor sistemi açık mı; skor bölümü buna bağlı (Görev 11.11). */
  scoringEnabled: boolean;
  /** Şu an kaç kişiye vekâlet ediyor. */
  activeDeputyCount: number;
  /** Kapsamındaki okunmamış faaliyet sayısı; sıfırsa rozet çizilmez. */
  unreadCount: number;
  /** Zil kutusundaki son bildirimler (Görev 10.4). */
  notifications: BellItem[];
  unseenNotifications: number;
  /** İlk giriş parolası değiştirilene kadar yalnız parola ekranı açılabilir. */
  mustChangePassword: boolean;
}

/**
 * Hesap satırında görünen **tek** yetki.
 *
 * Hem sistem hem birim yöneticisi olan kişide iki etiket yan yana yazılıyordu
 * ("Sistem yöneticisi · Birim yöneticisi"); dar omurgada bu satır kırpılıyor
 * ve kalabalıktan başka bir şey söylemiyordu. Satırda kapsamı en geniş yetki
 * durur; yetkilerin tamamı, yer sorunu olmayan hesap menüsünde yazılır.
 */
function rolEtiketi(user: ShellUser): string {
  if (user.isSystemAdmin) return "Sistem yöneticisi";
  if (user.isUnitManager) return "Birim yöneticisi";
  return "Kullanıcı";
}

/** Hesap menüsünde görünen tam yetki listesi. */
function rolListesi(user: ShellUser): string {
  const roller = [
    user.isSystemAdmin ? "Sistem yöneticisi" : null,
    user.isUnitManager ? "Birim yöneticisi" : null,
  ].filter(Boolean);

  return roller.length > 0 ? roller.join(" · ") : "Kullanıcı";
}

export async function AppShell({
  user,
  children,
  allowPasswordChange = false,
}: {
  user: ShellUser;
  children: ReactNode;
  allowPasswordChange?: boolean;
}) {
  if (user.mustChangePassword && !allowPasswordChange) {
    redirect("/parola?zorunlu=1");
  }

  const brand = await readBranding(prisma);

  return (
    <div className="min-h-dvh">
      {/* Gerçek zamanlı tazeleme kabuğa bağlanır: girişli her ekranda çalışsın
          diye. Görsel karşılığı yok, yalnızca akışı dinler (Görev 7.3). */}
      <LiveRefresh />

      <ShellNav
        brand={brand}
        notifications={user.notifications}
        unseenNotifications={user.unseenNotifications}
        markNotificationsSeen={markNotificationsSeenAction}
        user={{
          profileHref: `/users/${user.id}`,
          fullName: user.fullName,
          roleLabel: rolEtiketi(user),
          roleDetail: rolListesi(user),
          initials: initials(user.fullName) || "?",
          id: user.id,
          avatarExtension: user.avatarExtension,
          scoringEnabled: user.scoringEnabled,
          isSystemAdmin: user.isSystemAdmin,
          canViewReports: user.canViewReports,
          canViewScoreReports: user.canViewScoreReports,
          hasTeam: user.hasTeam,
          writesActivities: user.writesActivities,
          draftCount: user.draftCount,
          hasDeputyHistory: user.hasDeputyHistory,
          activeDeputyCount: user.activeDeputyCount,
          unreadCount: user.unreadCount,
          pendingApprovals: user.pendingApprovals,
        }}
        logout={logoutAction}
      />

      {/* İçerik omurganın sağında; mobilde alt gezinme kadar boşluk bırakılır
          ki son satır çubuğun altında kalmasın (safe-area dahil). */}
      <div className="flex min-h-dvh flex-col xl:ps-(--spacing-spine)">
        <div className="flex-1 pb-[calc(var(--spacing-tabbar)+env(safe-area-inset-bottom))] md:pb-0">
          {children}
        </div>

        {/* Alt şerit: kurum metni, telif ve sürüm. Sürüm numarası
            `package.json`dan gelir — destek "hangi sürümü kullanıyorsunuz"
            diye sorduğunda kullanıcının bakacağı tek yer burası. */}
        <footer className="border-t border-line bg-raised">
          <div className="mx-auto flex max-w-[1180px] flex-wrap items-center justify-between gap-x-6 gap-y-1.5 px-4 py-3.5 text-[length:var(--text-2xs)] text-faint sm:px-7">
            <span>
              © {new Date().getFullYear()} {brand.footerText}. Tüm hakları
              saklıdır.
            </span>
            {APP_VERSION ? (
              <span className="mono">Sürüm {APP_VERSION}</span>
            ) : null}
          </div>
        </footer>
      </div>
    </div>
  );
}
