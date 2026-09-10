import type { PrismaClient } from "@prisma/client";

import { companyDay, toDateValue } from "@/server/activities/date-rules";
import {
  countVisibleActivities,
  findVisibleActivity,
  listVisibleActivities,
  type ActivityRepositoryDb,
} from "@/server/authz/activity-repository";
import {
  subordinateUserIds,
  type Viewer,
} from "@/server/authz/visibility";

// Kişi profili (ister belgesi §2.1.2/§2.2.2: "geçmiş istatistikleri" ve
// "yazdığı faaliyetlerin arşivi").
//
// Profil arşivi de §8.2 görünürlük matrisine uyar. Üst zincir yalnız
// onaylanmış/iptal kayıtları görür; süreçteki kayıtların varlığı, başlığı veya
// durumu profile sızmaz.
//
// Sistem yöneticisi profili görebilir ama **arşivini göremez** (§15.1): rolü
// işlevseldir, içerik erişimi vermez.

export type ProfileDb = Pick<
  PrismaClient,
  | "user"
  | "orgUnit"
  | "activityApprover"
  | "noActivityPeriod"
  | "$queryRaw"
> & ActivityRepositoryDb;

export type ProfileAccess = "full" | "metadata" | "none";

export interface ProfilePerson {
  id: string;
  fullName: string;
  /** Unvan; yetki değildir. */
  title: string | null;
  email: string;
  orgUnitName: string;
  isUnitManager: boolean;
  isSystemAdmin: boolean;
  writesActivities: boolean;
  isActive: boolean;
  /** Son başarılı giriş; başarısız denemeler bu alanı değiştirmez. */
  lastLoginAt: Date | null;
  /** Son giriş zamanı yalnız kişinin kendisi, sistem yöneticisi veya kendi
   * departmanındaki çalışanı yöneten müdür için görünür. */
  lastLoginVisible: boolean;
  /** Profil resminin uzantısı; boşsa baş harfler gösterilir (Görev 11.5). */
  avatarExtension: string | null;
}

export interface ProfileViewer extends Viewer {
  /** Müdürün son giriş bilgisini hangi departman için görebileceğini belirler. */
  orgUnitId?: string;
  isUnitManager?: boolean;
}

export interface ProfileStats {
  /** Kişinin toplam faaliyet sayısı. */
  total: number;
  /** Bu ay içindekiler. */
  thisMonth: number;
  /** Onay bekleyenler. Kişide değil, **onaylayıcısında** bekleyen iştir. */
  pending: number;
  /** En son faaliyet günü; hiç yoksa `null`. */
  lastActivityDate: Date | null;
}

export type ProfileResult =
  | { access: "none" }
  | { access: "metadata"; person: ProfilePerson }
  | { access: "full"; person: ProfilePerson; stats: ProfileStats };

/**
 * Profili kim görebilir?
 *
 * - Kişinin kendisi.
 * - Kapsamındaki kişiler için yöneticisi (§8.1'deki ast kümesi).
 * - Sistem yöneticisi: yalnız üst veri, arşiv yok (§15.1).
 *
 * Bunun dışındaki herkes için kayıt **yokmuş gibi** davranılır: "var ama
 * göremezsin" demek, kişinin varlığını ve birimini ele verirdi.
 */
/**
 * "Bu kişinin kimligini gorebilir miyim?" — **hafif** karar (Gorev 11.5).
 *
 * Profil resmi ucu bunu kullaniyor. Once `loadProfile` cagriliyordu ve o,
 * erisim kararinin yaninda dort sayim sorgusu daha kosuyor: liste ekraninda
 * 25 avatar, 25 agir sorgu demekti — uctan uca kosuda sayfa yuklemeleri
 * dakikalara cikti.
 *
 * Karar `loadProfile` ile **ayni kurali** uyguluyor ve orasi da buradan
 * besleniyor; ikisi ayri yazilsaydi biri degistiginde digeri sessizce
 * ayrisir ve profilde gorunmeyen birinin resmi sizabilirdi.
 */
export async function resolveProfileAccess(
  db: ProfileDb,
  viewer: Viewer,
  userId: string,
): Promise<"none" | "metadata" | "full"> {
  if (viewer.id === userId) return "full";

  const subordinates = await subordinateUserIds(db, viewer.id);
  if (subordinates.includes(userId)) return "full";

  return viewer.isSystemAdmin ? "metadata" : "none";
}

export async function loadProfile(
  db: ProfileDb,
  viewer: ProfileViewer,
  userId: string,
  now: Date,
): Promise<ProfileResult> {
  const person = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      fullName: true,
      title: true,
      email: true,
      isUnitManager: true,
      isSystemAdmin: true,
      writesActivities: true,
      isActive: true,
      lastLoginAt: true,
      avatarExtension: true,
      orgUnit: { select: { id: true, name: true } },
    },
  });

  if (!person) return { access: "none" };

  const lastLoginVisible =
    viewer.id === person.id ||
    viewer.isSystemAdmin ||
    (viewer.isUnitManager === true &&
      viewer.orgUnitId === person.orgUnit.id &&
      !person.isUnitManager);

  const bilgi: ProfilePerson = {
    id: person.id,
    fullName: person.fullName,
    title: person.title,
    email: person.email,
    orgUnitName: person.orgUnit.name,
    isUnitManager: person.isUnitManager,
    isSystemAdmin: person.isSystemAdmin,
    writesActivities: person.writesActivities,
    isActive: person.isActive,
    lastLoginAt: lastLoginVisible ? person.lastLoginAt : null,
    lastLoginVisible,
    avatarExtension: person.avatarExtension,
  };

  const erisim = await resolveProfileAccess(db, viewer, userId);
  if (erisim === "none") return { access: "none" };
  if (erisim === "metadata") return { access: "metadata", person: bilgi };

  const ayBasi = new Date(
    Date.UTC(
      toDateValue(companyDay(now)).getUTCFullYear(),
      toDateValue(companyDay(now)).getUTCMonth(),
      1,
    ),
  );

  const [total, thisMonth, pending, sonKayit] = await Promise.all([
    countVisibleActivities(db, viewer, { authorId: userId }),
    countVisibleActivities(db, viewer, {
      authorId: userId,
      activityDate: { gte: ayBasi },
    }),
    countVisibleActivities(db, viewer, {
      authorId: userId,
      approvalStatus: "PENDING_APPROVAL",
    }),
    findVisibleActivity(db, viewer, {
      where: { authorId: userId },
      orderBy: { activityDate: "desc" },
      select: { activityDate: true },
    }),
  ]);

  return {
    access: "full",
    person: bilgi,
    stats: {
      total,
      thisMonth,
      pending,
      lastActivityDate: sonKayit?.activityDate ?? null,
    },
  };
}

export interface ProfileActivityRow {
  id: string;
  activityNo: number;
  activityDate: Date;
  title: string;
  approvalStatus: string;
}

/**
 * Profilde gösterilen arşiv. Liste görünürlüğü depo tarafından uygulanır;
 * üst zincir süreçteki kayıtların varlığını göremez.
 */
export async function listProfileActivities(
  db: ProfileDb,
  viewer: Viewer,
  userId: string,
  limit = 50,
): Promise<ProfileActivityRow[]> {
  const kayitlar = await listVisibleActivities(db, viewer, {
    where: { authorId: userId },
    orderBy: [{ activityDate: "desc" }, { createdAt: "desc" }],
    take: limit,
    select: {
      id: true,
      activityNo: true,
      activityDate: true,
      title: true,
      approvalStatus: true,
    },
  });

  // Listelenen her satır bu bakana zaten açıktır: görünürlük listenin
  // kendisinde uygulanıyor, ayrıca "açılabilir mi" bayrağı gerekmiyor.
  return kayitlar;
}
