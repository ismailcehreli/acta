import type { Prisma, PrismaClient } from "@prisma/client";

// Yönetim ekranının kullanıcı listesi. Yalnızca yönetim verisi okunur:
// sistem yöneticisi rolü işlevsel yetkidir ve faaliyet içeriğine erişim vermez
// (§15.1). Bu yüzden seçilen alanlar açıkça sayılır — `include` ile geniş bir
// nesne dönmek, ileride eklenecek ilişkileri sessizce bu ekrana taşırdı.

export type ListUsersDb = Pick<PrismaClient, "user">;

export interface ManagedUser {
  id: string;
  fullName: string;
  /** Unvan; yetki değildir, yalnız kim olduğunu anlatır. */
  title: string | null;
  email: string;
  orgUnitId: string;
  orgUnitName: string;
  isUnitManager: boolean;
  isSystemAdmin: boolean;
  isRoot: boolean;
  canViewReports: boolean;
  canViewScoreReports: boolean;
  /** Bu kişiden günlük faaliyet beklenir mi (§7.4 istisnası). */
  writesActivities: boolean;
  /** Profil resminin uzantısı; boşsa baş harfler (Görev 11.5). */
  avatarExtension: string | null;
  /** Skoru hesaplanır mı (Görev 11.10). */
  isScored: boolean;
  /** Faaliyetlere takdir verebilir mi (Görev 11.11). */
  canAppreciate: boolean;
  /** Son başarılı giriş zamanı. */
  lastLoginAt: Date | null;
  isActive: boolean;
}

/**
 * Yönetim listesinin daraltmaları (Görev 11.4).
 *
 * Liste süzgeçsizdi ve tamamı tek sayfada çiziliyordu; "Kalıphane'deki pasif
 * hesaplar" sorusu ancak gözle taranarak cevaplanabiliyordu.
 */
export interface UserListFilters {
  /**
   * Kapsam sınırı: liste bu birimlerin dışına çıkamaz (Görev 11.7).
   *
   * Süzgeç değil **kapsam**tır; `orgUnitId` kullanıcının seçtiği daraltmadır
   * ve bunun içinde kalır. İkisi `AND` ile birleşiyor — nesne yaymada aynı
   * alan iki kez verilirse sonuncusu kazanır ve kapsam sessizce ezilirdi
   * (Görev 11.4'te ekip izin listesinde bu hata bulundu).
   */
  orgUnitIds?: string[];
  orgUnitId?: string;
  isActive?: boolean;
  role?: "unitManager" | "systemAdmin";
  /** Ad ya da e-posta içinde arar; büyük-küçük harf ayırmaz. */
  query?: string;
}

/** Süzgeç koşulu; liste ve sayaç aynı yerden beslenir, ayrışamazlar. */
function userWhere(filters: UserListFilters): Prisma.UserWhereInput {
  const arama = filters.query?.trim();
  const kosullar: Prisma.UserWhereInput[] = [];

  if (filters.orgUnitIds) kosullar.push({ orgUnitId: { in: filters.orgUnitIds } });
  if (filters.orgUnitId) kosullar.push({ orgUnitId: filters.orgUnitId });
  if (filters.isActive !== undefined) kosullar.push({ isActive: filters.isActive });
  if (filters.role === "unitManager") kosullar.push({ isUnitManager: true });
  if (filters.role === "systemAdmin") kosullar.push({ isSystemAdmin: true });
  if (arama) {
    kosullar.push({
      OR: [
        { fullName: { contains: arama, mode: "insensitive" } },
        { email: { contains: arama, mode: "insensitive" } },
      ],
    });
  }

  return kosullar.length === 0 ? {} : { AND: kosullar };
}

export async function listUsers(
  db: ListUsersDb,
  filters: UserListFilters = {},
  options: { limit?: number; skip?: number } = {},
): Promise<ManagedUser[]> {
  const users = await db.user.findMany({
    where: userWhere(filters),
    ...(options.limit === undefined ? {} : { take: options.limit }),
    ...(options.skip === undefined ? {} : { skip: options.skip }),
    select: {
      id: true,
      fullName: true,
      title: true,
      email: true,
      orgUnitId: true,
      isUnitManager: true,
      isSystemAdmin: true,
      isRoot: true,
      canViewReports: true,
      canViewScoreReports: true,
      writesActivities: true,
      isActive: true,
      avatarExtension: true,
      isScored: true,
      canAppreciate: true,
      lastLoginAt: true,
      orgUnit: { select: { name: true } },
    },
    orderBy: [{ isActive: "desc" }, { fullName: "asc" }],
  });

  return users.map(({ orgUnit, ...user }) => ({
    ...user,
    orgUnitName: orgUnit.name,
  }));
}

/** Yönetim detayında tek kullanıcı okumak için listeyle aynı dar seçimi kullanır. */
export async function getManagedUser(
  db: ListUsersDb,
  userId: string,
): Promise<ManagedUser | null> {
  return readManagedUser(db, userId);
}

/** Kimlik tahminiyle liste sınırını aşmamak için doğrudan id sorgusu. */
async function readManagedUser(
  db: ListUsersDb,
  userId: string,
): Promise<ManagedUser | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      fullName: true,
      title: true,
      email: true,
      orgUnitId: true,
      isUnitManager: true,
      isSystemAdmin: true,
      isRoot: true,
      canViewReports: true,
      canViewScoreReports: true,
      writesActivities: true,
      isActive: true,
      avatarExtension: true,
      isScored: true,
      canAppreciate: true,
      lastLoginAt: true,
      orgUnit: { select: { name: true } },
    },
  });

  if (!user) return null;
  const { orgUnit, ...rest } = user;
  return { ...rest, orgUnitName: orgUnit.name };
}

/** Süzgeçli toplam; sayfa sayısı buradan çıkar. */
export async function countUsers(
  db: ListUsersDb,
  filters: UserListFilters = {},
): Promise<number> {
  return db.user.count({ where: userWhere(filters) });
}
