import type { PrismaClient } from "@prisma/client";

// Bölüm müdürünün **işlevsel** yetkisi (Görev 11.7, tasarım Paket F).
//
// §15.1'deki ayrım korunuyor: işlevsel yetki içerik erişimi vermez. Müdür
// zaten kendi ekibinin faaliyetlerini görüyor; buradaki yetki yalnız kullanıcı
// kaydı üzerinde işlem açıyor — personel ekleme, ad/unvan düzeltme,
// pasifleştirme ve şifre sıfırlama tetikleme.
//
// `canManageOrganization()` **değişmedi**. Sistem yöneticisi yetkisi ayrı
// kalıyor; bu modül onun yanına geliyor, yerine değil. İkisini tek bayrakta
// birleştirmek, "ağaca dokunabilen" ile "kendi ekibine personel ekleyebilen"
// arasındaki farkı kaybetmek olurdu.
//
// **Üç sınır pazarlığa kapalı** ve testlerle korunuyor:
//
//   1. Müdür kendi alt ağacının dışına çıkamaz.
//   2. Müdür sistem yöneticisi hesabına dokunamaz — ağaçta altında olsa bile.
//      İşlevsel yetkiyi bir bölüm müdürünün eline bırakmak, yetki modelinin
//      tamamını atlatmanın kısa yolu olurdu.
//   3. Müdür kendi hesabını bu yoldan yönetemez; kendi yetkisini kaldırma ya
//      da kendini kilitleme yollarını açardı. Profil ekranı bunun için var.

export type UnitAdminDb = Pick<PrismaClient, "user" | "orgUnit" | "$queryRaw">;

/**
 * Kişinin personel işlemi yapabileceği birimler.
 *
 * Sistem yöneticisi bütün aktif birimleri yönetir. Bölüm yöneticisi kendi
 * birimini ve **altındaki** birimleri yönetir; kardeş ve üst birimler dışarıda
 * kalır. Sorgu `subordinateUserIds` ile aynı özyinelemeli deseni kullanıyor —
 * ağaçta "altındakiler" sorusunun tek bir cevabı olmalı.
 */
export async function manageableUnitIds(
  db: UnitAdminDb,
  actorId: string,
): Promise<string[]> {
  const actor = await db.user.findUnique({
    where: { id: actorId },
    select: { orgUnitId: true, isUnitManager: true, isSystemAdmin: true, isActive: true },
  });

  if (!actor || !actor.isActive) return [];

  if (actor.isSystemAdmin) {
    const hepsi = await db.orgUnit.findMany({
      where: { isActive: true },
      select: { id: true },
    });
    return hepsi.map((birim) => birim.id);
  }

  if (!actor.isUnitManager) return [];

  const rows = await db.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE subtree(id) AS (
      SELECT "id" FROM "OrgUnit" WHERE "id" = ${actor.orgUnitId}
      UNION ALL
      SELECT child."id"
      FROM "OrgUnit" child
      JOIN subtree ON child."parentId" = subtree.id
    )
    SELECT id FROM subtree
  `;

  return rows.map((row) => row.id);
}

/**
 * Bu kişi, hedef kullanıcı üzerinde personel işlemi yapabilir mi?
 *
 * Karar tek yerde: ekranlar da sunucu eylemleri de buradan geçiyor. Ekranın
 * gizlenmesi güvenlik değildir; asıl kontrol veriyi değiştiren yolun başında
 * ve o yol da bu işlevi çağırıyor.
 */
export async function canManageUser(
  db: UnitAdminDb,
  actorId: string,
  targetId: string,
): Promise<boolean> {
  // Kendi hesabı bu yoldan yönetilmez (yukarıdaki 3. sınır).
  if (actorId === targetId) return false;

  const [actor, target] = await Promise.all([
    db.user.findUnique({
      where: { id: actorId },
      select: { isSystemAdmin: true, isActive: true },
    }),
    db.user.findUnique({
      where: { id: targetId },
      select: { orgUnitId: true, isSystemAdmin: true, isRoot: true },
    }),
  ]);

  if (!actor || !actor.isActive || !target) return false;
  // Ana hesap sistem yöneticileri dahil herkes için korunur. Root'un kendi
  // operasyonel seçenekleri ayrı ve dar bir self-update yolundan değiştirilir.
  if (target.isRoot) return false;
  if (actor.isSystemAdmin) return true;

  // Sistem yöneticisi hesabına yalnız sistem yöneticisi dokunur (2. sınır).
  if (target.isSystemAdmin) return false;

  const birimler = await manageableUnitIds(db, actorId);
  return birimler.includes(target.orgUnitId);
}
