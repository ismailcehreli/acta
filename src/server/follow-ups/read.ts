import type { PrismaClient } from "@prisma/client";

import { businessDaysBetween } from "@/server/calendar/business-days";
import { periodStart, type FeedFilters } from "@/server/activities/scope-feed";
import { readWorkCalendar } from "@/server/calendar/settings";
import { loadWorkCalendar } from "@/server/calendar/work-calendar";
import { visibleActivityWhere, type Viewer, type VisibilityDb } from "@/server/authz/visibility";
import { readNumericSetting, SETTING_KEYS } from "@/server/settings/system-settings";

// Takip maddesi listeleri (§11.2).
//
// **Görünürlük modülünden geçer:** göremediğin bir faaliyetin takip maddesi de
// sana görünmez. Aksi hâlde takip listesi, görünürlük modelini dolaşmanın yolu
// olurdu — başlık ve "sonraki adım" metni de içerik taşır.
//
// Sistem hiçbir maddeyi yukarı taşımaz; hareketsiz olanları yalnız **ayrı bir
// listede görünür kılar** (§11.2).

export type FollowUpReadDb = VisibilityDb &
  Pick<PrismaClient, "followUpItem" | "workCalendar" | "holiday" | "systemSetting">;

export interface FollowUpView {
  id: string;
  activityId: string;
  activityNo: number;
  activityTitle: string;
  ownerName: string;
  ownerId: string;
  /** Sorumlunun profil resmi uzantısı; boşsa baş harfler (Görev 11.5). */
  ownerAvatarExtension: string | null;
  nextStep: string | null;
  reviewDate: Date | null;
  openedAt: Date;
  lastMovedAt: Date;
  /** Kaç iş günüdür hareket yok. */
  idleBusinessDays: number;
  /** Eşiği aştı mı; satırda rozetle gösterilir. */
  stale: boolean;
  /**
   * Sorumlusu bakan kişi mi.
   *
   * Grup başlığı ("Sorumlusu siz olanlar") kalktığı için bilgi satıra indi
   * (Görev 11.3). Sunucuda hesaplanıyor: ekranın kimliği karşılaştırması
   * yapması, aynı kuralın iki yerde yaşaması demekti.
   */
  mine: boolean;
  /** Gözden geçirme günü geçmiş mi. */
  reviewOverdue: boolean;
}

/**
 * Takip listesinin daraltmaları (Görev 11.3).
 *
 * Sayfa önce üç ayrı liste döndürüyordu (hareketsizler, bende, diğerleri).
 * Ürün sahibi kararı (21.08.2026): **tek liste**, öncelik satırın kendi
 * alanlarında. Gruplu yapı sayfalanamıyordu — "3. sayfa" hangi grubun
 * üçüncü sayfasıydı belirsizdi — ve süzgeç uygulanınca grupların anlamı
 * kayboluyordu.
 */
export interface FollowUpFilters {
  /** Varsayılan `OPEN`: kapanmış madde iş listesinde yer kaplamaz. */
  status?: "OPEN" | "CLOSED";
  ownerId?: string;
  /** Yalnız eşiği aşmış, uzun süredir hareketsiz maddeler. */
  staleOnly?: boolean;
  period?: FeedFilters["period"];
}

export interface FollowUpPage {
  items: FollowUpView[];
  /** Süzgeçli toplam; sayfa sayısı buradan çıkar. */
  total: number;
  staleThreshold: number;
}

/**
 * Kapsamdaki takip maddeleri, süzgeçli ve sayfalı.
 *
 * **Hareketsizlik süzgeci ve sıralaması bellekte yapılır.** "Kaç iş günüdür
 * hareket yok" sorusunun cevabı çalışma takvimine bağlı ve veritabanı onu
 * bilmiyor; SQL'de ifade edilebilecek bir kural değil. Maddeler bir yöneticinin
 * açık işleri kadardır, tamamını okumak burada doğru takas — aynı gerekçe
 * onay kuyruğunda da yazılı.
 */
export async function listFollowUps(
  db: FollowUpReadDb,
  viewer: Viewer,
  now: Date,
  filters: FollowUpFilters = {},
  options: { limit?: number; skip?: number } = {},
): Promise<FollowUpPage> {
  const [scope, ayarlar, esik] = await Promise.all([
    visibleActivityWhere(db, viewer),
    readWorkCalendar(db),
    readNumericSetting(db, SETTING_KEYS.followUpStaleBusinessDays),
  ]);

  // Varsayılan **tümü**: açık bir takip maddesi ne zaman açılmış olursa
  // olsun listede kalmalı. `periodStart` boş dönemi "bu hafta" sayıyor ve
  // ilk yazımda öyle bırakılmıştı — geçen ay açılmış, aylardır bekleyen
  // maddeler listeden düşüyordu ki bu tam da sayfanın amacına ters.
  const start = periodStart(filters.period ?? "all", now);

  const rows = await db.followUpItem.findMany({
    // Kapsam koşulu her zaman ilk sırada ve süzgeçler onun üstüne biner;
    // hiçbir alan görünürlüğü genişletemez (§8.4).
    where: {
      status: filters.status ?? "OPEN",
      activity: scope,
      ...(filters.ownerId ? { ownerId: filters.ownerId } : {}),
      ...(start ? { openedAt: { gte: start } } : {}),
    },
    orderBy: { lastMovedAt: "asc" },
    select: {
      id: true,
      activityId: true,
      ownerId: true,
      nextStep: true,
      reviewDate: true,
      openedAt: true,
      lastMovedAt: true,
      owner: { select: { fullName: true, avatarExtension: true } },
      activity: { select: { activityNo: true, title: true } },
    },
  });

  if (rows.length === 0) return { items: [], total: 0, staleThreshold: esik };

  const enEski = rows.reduce(
    (min, satir) => (satir.lastMovedAt < min ? satir.lastMovedAt : min),
    rows[0].lastMovedAt,
  );
  const takvim = await loadWorkCalendar(db, enEski, now);
  const gunSecenekleri = {
    workingDays: ayarlar.workingDays,
    holidays: takvim.holidays,
  };

  let gorunumler: FollowUpView[] = rows.map((satir) => {
    const idle = businessDaysBetween(satir.lastMovedAt, now, gunSecenekleri);

    return {
      id: satir.id,
      activityId: satir.activityId,
      activityNo: satir.activity.activityNo,
      activityTitle: satir.activity.title,
      ownerId: satir.ownerId,
      ownerName: satir.owner.fullName,
      ownerAvatarExtension: satir.owner.avatarExtension,
      nextStep: satir.nextStep,
      reviewDate: satir.reviewDate,
      openedAt: satir.openedAt,
      lastMovedAt: satir.lastMovedAt,
      idleBusinessDays: idle,
      stale: idle >= esik,
      mine: satir.ownerId === viewer.id,
      reviewOverdue:
        satir.reviewDate !== null && satir.reviewDate.getTime() < now.getTime(),
    };
  });

  if (filters.staleOnly) gorunumler = gorunumler.filter((madde) => madde.stale);

  // Sıralama önceliği taşır: grup başlıkları kalktığına göre en uzun bekleyen
  // madde en üstte olmalı; kullanıcı süzmeden de doğru yere bakar.
  gorunumler.sort((a, b) => b.idleBusinessDays - a.idleBusinessDays);

  const { limit, skip = 0 } = options;

  return {
    items: limit === undefined ? gorunumler : gorunumler.slice(skip, skip + limit),
    total: gorunumler.length,
    staleThreshold: esik,
  };
}

/** Faaliyet sayfasındaki kart için: en son kapanmış madde (varsa). */
export async function findLatestClosedFollowUp(
  db: Pick<PrismaClient, "followUpItem">,
  activityId: string,
) {
  return db.followUpItem.findFirst({
    where: { activityId, status: "CLOSED" },
    orderBy: { closedAt: "desc" },
    select: {
      id: true,
      ownerId: true,
      openedById: true,
      closedAt: true,
      closingNote: true,
      closedBy: { select: { fullName: true } },
    },
  });
}

/** Faaliyet sayfasındaki kart için: o kaydın açık maddesi. */
export async function findOpenFollowUp(
  db: Pick<PrismaClient, "followUpItem">,
  activityId: string,
) {
  return db.followUpItem.findFirst({
    where: { activityId, status: "OPEN" },
    select: {
      id: true,
      ownerId: true,
      openedById: true,
      nextStep: true,
      reviewDate: true,
      openedAt: true,
      lastMovedAt: true,
      owner: { select: { fullName: true, avatarExtension: true } },
      openedBy: { select: { fullName: true } },
    },
  });
}
