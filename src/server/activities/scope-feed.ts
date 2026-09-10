import type { Prisma, PrismaClient } from "@prisma/client";

import { companyDay, toDateValue } from "@/server/activities/date-rules";
import { openQuestionActivityWhere } from "@/server/activities/open-questions";
import { unreadActivityConditions } from "@/server/activities/unread";
import {
  countVisibleActivities,
  listVisibleActivities,
  type ActivityRepositoryDb,
} from "@/server/authz/activity-repository";
import {
  subordinateUserIds,
  type Viewer,
} from "@/server/authz/visibility";

// Kapsam akışı (§13): ekran düzeni her kademede aynıdır, yalnızca kapsam
// genişler — "Departmanım" → "Departmanlarım" → "Tüm şirket". Öğrenilecek tek
// bir arayüz olur.
//
// Liste **her zaman** görünürlük modülünün filtresiyle başlar; buradaki
// filtreler onun üstüne eklenir ve yalnızca daraltır (§8.4).

export type ScopeFeedDb = Pick<PrismaClient, "orgUnit" | "user"> &
  ActivityRepositoryDb;

export interface FeedFilters {
  /** `today` | `week` | `all` — varsayılan `week`. */
  period?: "today" | "week" | "all";
  /** Belirli bir yazarın kayıtları. */
  authorId?: string;
  /**
   * Yazarın **kendi birimi**. Departman özeti bloğundan gelen daraltma bunu
   * kullanır: "Kalıphane'nin faaliyetleri" denince kastedilen, Kalıphane'de
   * çalışanların yazdıklarıdır — muhatap etiketi başka bir şeydir (§8.3).
   */
  authorOrgUnitId?: string;
  /** Muhatap gösterilen departman. Erişim vermez, yalnızca süzer (§8.3). */
  targetOrgUnitId?: string;
  /**
   * Onay durumu. Ana ekrandaki sayaçlar buraya bağlanır: "onay bekleyen 3"
   * yazısına tıklayan kişi, o üç kaydın kendisini görmeli. Süzgeç **kapsam
   * açmaz**; görünürlük yine `visibleActivityWhere` ile belirlenir.
   */
  status?: "PENDING_APPROVAL" | "CHANGES_REQUESTED" | "REJECTED" | "CANCELLED";
  /** Yalnız bu kullanıcının henüz okumadığı, açık faaliyetleri göster. */
  unreadOnly?: boolean;
  /**
   * Kullanıcının kendi sormadığı, açık sorusu olan kayıtlar (Görev 17.1).
   *
   * Ana ekrandaki "Cevap bekleyen faaliyet" sayacı buraya bağlanır. Sayaç ve
   * liste faaliyetleri sayar; aynı faaliyette iki uygun açık soru olsa bile
   * faaliyet bir kez görünür. Kullanıcının kendi sorusu tek başına süzgece
   * girmez; o soru iş kuyruğunda izlenir.
   *
   * Süzgeç **kapsam açmaz**: açık soru görünürlük vermez, yalnızca daraltır.
   */
  openQuestions?: boolean;
}

export interface FeedItem {
  id: string;
  /** İnsan okur sıra numarası (§3.1). */
  activityNo: number;
  activityDate: Date;
  title: string;
  approvalStatus: string;
  authorId: string;
  authorName: string;
  /** Profil resminin uzantısı; boşsa baş harfler gösterilir (Görev 11.5). */
  authorAvatarExtension: string | null;
  /** Yazarın unvanı; yetki değildir, "bu kişi ne iş yapıyor" sorusuna cevaptır. */
  authorTitle: string | null;
  authorUnitName: string;
  /** Kaydın yazıldığı an. Faaliyetin gününden ayrıdır (Görev 11.1). */
  createdAt: Date;
  targetDepartmentNames: string[];
  /** Bu kullanıcı kaydı daha önce okudu mu (§10). Kayıt üretimi Görev 4.2'de. */
  read: boolean;
}

/**
 * Dönem başlangıcı **şirket saatinden** (Europe/Istanbul) hesaplanır. UTC
 * takvim gününden üretiliyordu: İstanbul'da gece yarısından sonraki ilk üç
 * saatte "Bugün" akışı bir önceki günü gösterirken aynı sayfadaki günlük sayaç
 * doğru günü kullanıyor, iki blok birbiriyle çelişiyordu (denetim
 * 18.08.2026, FAZ 4 bulgu 11).
 *
 * "Bu hafta" da kayan yedi gün değil, şirket saatinde **Pazartesi başlayan**
 * takvim haftasıdır: kullanıcı "bu hafta" derken haftanın kendisini kasteder.
 */
export function periodStart(
  period: FeedFilters["period"],
  now: Date,
): Date | null {
  if (period === "all") return null;

  const today = toDateValue(companyDay(now));
  if (period === "today") return today;

  // ISO gün numarası: 1 = Pazartesi … 7 = Pazar.
  const isoWeekday = today.getUTCDay() === 0 ? 7 : today.getUTCDay();
  const monday = new Date(today);
  monday.setUTCDate(monday.getUTCDate() - (isoWeekday - 1));
  return monday;
}

/**
 * Sayfa imleci. Sıralamanın üç alanını da taşır: `activityDate` ve `createdAt`
 * eşit kayıtlar olabilir, `id` sırayı kesinleştirir. Kayan sayfa (offset)
 * yerine imleç kullanılır — araya yeni kayıt girdiğinde offset satır atlar ya
 * da tekrarlar.
 */
export interface FeedCursor {
  activityDate: Date;
  createdAt: Date;
  id: string;
}

export interface FeedPage {
  items: FeedItem[];
  /** Doluysa devamı var; boşsa liste bitmiştir. */
  nextCursor: FeedCursor | null;
}

export type FeedOrder = "newest" | "oldest";

/**
 * Kapsam akışının hangi kişi kümesini kullanacağını seçer.
 *
 * `managedOnly`, genel görünürlük filtresinin yerine geçmez; görünür kaydı
 * yöneticinin ast yazarlarıyla kesiştirir. Böylece yönetim ekranı yöneticinin
 * kendi kaydını, yalnızca kendi yazarı olduğu için listeye geri alamaz.
 */
export interface ScopeSelection {
  /** Önceden hesaplanmış astlar; verilmezse yönetici için yeniden hesaplanır. */
  subordinates?: string[];
  /** Yalnızca ast kullanıcıların yazdığı kayıtları seç. */
  managedOnly?: boolean;
}

export interface FeedOptions extends ScopeSelection {
  limit?: number;
  cursor?: FeedCursor | null;
  /** Dikkat kuyruğu eskiden yeniye, ana akış yeniden eskiye akar. */
  order?: FeedOrder;
}

/** Yönetim alanı sorgularının ortak yazar koşulu. */
export function managedAuthorsWhere(
  subordinates: string[],
): Prisma.ActivityWhereInput {
  return { authorId: { in: subordinates } };
}

async function resolveSubordinates(
  db: ScopeFeedDb,
  viewer: Viewer,
  selection: ScopeSelection,
): Promise<string[] | undefined> {
  if (!selection.managedOnly) return selection.subordinates;
  return selection.subordinates ?? subordinateUserIds(db, viewer.id);
}

/**
 * Süzgeçlerden doğan daraltma koşulları.
 *
 * Liste ve sayaç sorgusu aynı listeyi kullanır: ikisi ayrı yazılsaydı biri
 * değiştiğinde diğeri sessizce geride kalır ve sayaç listeyle çelişirdi.
 * Görünürlük koşulu buraya **girmez**; o her zaman ayrıca ve önce eklenir.
 */
function filterConditions(
  filters: FeedFilters,
  now: Date,
  viewerId: string,
  managedAuthors?: string[],
): Prisma.ActivityWhereInput[] {
  const conditions: Prisma.ActivityWhereInput[] = managedAuthors
    ? [managedAuthorsWhere(managedAuthors)]
    : [];

  const start = periodStart(filters.period, now);
  if (start) conditions.push({ activityDate: { gte: start } });
  if (filters.authorId) conditions.push({ authorId: filters.authorId });
  if (filters.authorOrgUnitId) {
    conditions.push({ authorOrgUnitId: filters.authorOrgUnitId });
  }
  if (filters.targetOrgUnitId) {
    conditions.push({
      targetDepts: { some: { orgUnitId: filters.targetOrgUnitId } },
    });
  }
  if (filters.status) conditions.push({ approvalStatus: filters.status });
  // `some` kullanılıyor: iki uygun açık sorusu olan faaliyet listede bir kez
  // çıkar. Kullanıcının kendi sorusu bu ortak koşulun dışında kalır.
  if (filters.openQuestions) {
    conditions.push(openQuestionActivityWhere(viewerId));
  }
  if (filters.unreadOnly) {
    // `countUnreadInScope` ile aynı küme: kendi kaydı, kapanmış kayıt veya
    // başka bir yöneticinin okuması okunmamış dikkat kuyruğuna girmez.
    conditions.push(...unreadActivityConditions(viewerId));
  }

  return conditions;
}

/** İmleçten sonrasını seçen koşul; yön, sıralama ile birlikte değişir. */
function afterCursor(
  cursor: FeedCursor,
  order: FeedOrder,
): Prisma.ActivityWhereInput {
  const ileri = order === "oldest";

  return {
    OR: [
      { activityDate: ileri ? { gt: cursor.activityDate } : { lt: cursor.activityDate } },
      {
        activityDate: cursor.activityDate,
        createdAt: ileri ? { gt: cursor.createdAt } : { lt: cursor.createdAt },
      },
      {
        activityDate: cursor.activityDate,
        createdAt: cursor.createdAt,
        id: ileri ? { gt: cursor.id } : { lt: cursor.id },
      },
    ],
  };
}

/**
 * Süzgeçli kapsamın toplam kayıt sayısı. Sayfalama başlığında "kaç kayıt
 * var" demek için; imleçli sayfalama toplamı kendiliğinden bilmez.
 *
 * Ayrı bir sorgu: liste sorgusu `take` ile sınırlı ve toplamı ondan
 * çıkaramayız. Sayının kendisi de kapsamdan geçer.
 */
export async function countScopeActivities(
  db: ScopeFeedDb,
  viewer: Viewer,
  filters: FeedFilters,
  now: Date,
  selection: ScopeSelection = {},
): Promise<number> {
  const subordinates = await resolveSubordinates(db, viewer, selection);
  return countVisibleActivities(
    db,
    viewer,
    {
      AND: filterConditions(
        filters,
        now,
        viewer.id,
        selection.managedOnly ? subordinates ?? [] : undefined,
      ),
    },
    subordinates,
  );
}

export async function listScopeActivities(
  db: ScopeFeedDb,
  viewer: Viewer,
  filters: FeedFilters,
  now: Date,
  options: FeedOptions = {},
): Promise<FeedPage> {
  const {
    limit = 50,
    cursor = null,
    managedOnly = false,
    order = "newest",
  } = options;
  const subordinates = await resolveSubordinates(db, viewer, options);
  const conditions = [
    ...filterConditions(
      filters,
      now,
      viewer.id,
      managedOnly ? subordinates ?? [] : undefined,
    ),
  ];
  if (cursor) conditions.push(afterCursor(cursor, order));

  const orderBy: Prisma.ActivityOrderByWithRelationInput[] =
    order === "oldest"
      ? [
          { activityDate: "asc" },
          { createdAt: "asc" },
          { id: "asc" },
        ]
      : [
          { activityDate: "desc" },
          { createdAt: "desc" },
          { id: "desc" },
        ];

  // Bir fazla okunur: gelen satır sayısı sınırı aşıyorsa devamı var demektir.
  // "Devamı var mı" sorusunu ayrı bir `count` ile sormak, aynı filtreyi ikinci
  // kez koşturmak olurdu.
  const rows = await listVisibleActivities(db, viewer, {
    where: { AND: conditions },
    orderBy,
    take: limit + 1,
    select: {
      id: true,
      activityNo: true,
      activityDate: true,
      createdAt: true,
      title: true,
      approvalStatus: true,
      authorId: true,
      author: { select: { fullName: true, title: true, avatarExtension: true } },
      authorOrgUnit: { select: { name: true } },
      targetDepts: { select: { orgUnit: { select: { name: true } } } },
      // Okundu rozeti yalnızca bu kullanıcının kendi okuması içindir; kimin
      // neyi okuduğu başkasına gösterilmez (§10.3).
      readReceipts: { where: { userId: viewer.id }, select: { userId: true } },
    },
  }, subordinates);

  const devamiVar = rows.length > limit;
  const sayfa = devamiVar ? rows.slice(0, limit) : rows;
  const son = sayfa.at(-1);

  return {
    items: sayfa.map((row) => ({
      id: row.id,
      activityNo: row.activityNo,
      activityDate: row.activityDate,
      title: row.title,
      approvalStatus: row.approvalStatus,
      authorId: row.authorId,
      authorName: row.author.fullName,
      authorAvatarExtension: row.author.avatarExtension,
      authorTitle: row.author.title,
      authorUnitName: row.authorOrgUnit.name,
      createdAt: row.createdAt,
      targetDepartmentNames: row.targetDepts.map((t) => t.orgUnit.name),
      read: row.readReceipts.length > 0,
    })),
    nextCursor:
      devamiVar && son
        ? { activityDate: son.activityDate, createdAt: son.createdAt, id: son.id }
        : null,
  };
}

export interface ScopeSummary {
  /** Ekranda gösterilecek kapsam başlığı. */
  label: string;
  /** Kapsamda kaç kişi var (kendisi hariç). */
  personCount: number;
  hasScope: boolean;
}

/**
 * Kapsam başlığı veriden hesaplanır, kademe adı koda gömülmez (İlke 1):
 * kişinin kapsamı kökü içeriyorsa "Tüm şirket", birden fazla birime yayılıyorsa
 * "Departmanlarım", tek birimse "Departmanım".
 */
export async function describeScope(
  db: ScopeFeedDb,
  viewer: Viewer,
  precomputed?: string[],
): Promise<ScopeSummary> {
  const subordinates = precomputed ?? (await subordinateUserIds(db, viewer.id));

  if (subordinates.length === 0) {
    return { label: "Kapsamım", personCount: 0, hasScope: false };
  }

  const units = await db.user.findMany({
    where: { id: { in: subordinates } },
    select: { orgUnitId: true },
    distinct: ["orgUnitId"],
  });

  const rootUnit = await db.orgUnit.findFirst({
    where: { parentId: null },
    select: { id: true },
  });

  const viewerUnit = await db.user.findUnique({
    where: { id: viewer.id },
    select: { orgUnitId: true },
  });

  const coversWholeCompany =
    rootUnit !== null && viewerUnit?.orgUnitId === rootUnit.id;

  const label = coversWholeCompany
    ? "Tüm şirket"
    : units.length > 1
      ? "Departmanlarım"
      : "Departmanım";

  return { label, personCount: subordinates.length, hasScope: true };
}

/** Filtre kutularını doldurmak için kapsamdaki kişiler. */
export async function listScopePeople(
  db: ScopeFeedDb,
  viewer: Viewer,
  precomputed?: string[],
): Promise<{ id: string; fullName: string }[]> {
  const subordinates = precomputed ?? (await subordinateUserIds(db, viewer.id));
  if (subordinates.length === 0) return [];

  return db.user.findMany({
    where: { id: { in: subordinates } },
    select: { id: true, fullName: true },
    orderBy: { fullName: "asc" },
  });
}
