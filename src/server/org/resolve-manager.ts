import type { PrismaClient } from "@prisma/client";

// "Bir üstü kim?" sorusunun tek ve kesin cevabı (§4.4). Faaliyetin kime
// düştüğü, hatırlatmanın kime gittiği ve Sürüm 2'de onayın kime gideceği
// buradan çıkar; bu yüzden kural tek bir yerde durur ve kopyalanmaz.
//
// Kural (§4.4):
//   1. Kişi birim yöneticisi DEĞİLSE  → kendi biriminin yöneticisi
//   2. Kişi birim yöneticisi İSE      → üst birimin yöneticisi
//   3. O birimde yönetici yoksa       → bir üst birime çık, tekrarla
//   4. Köke ulaşıldı ve yönetici yok  → YÖNETİCİSİZ (hata durumu)
//
// **Bir birimde birden fazla yönetici olabilir** (ürün sahibi kararı,
// 20.08.2026). Bu yüzden asıl fonksiyon `resolveManagers`: cevap bir kişi
// değil, bir **kümedir**. Aramanın durduğu ilk kademede kaç yönetici varsa
// hepsi döner; üst kademeye taşma olmaz — iki müdürlü bir departmanda kayıt
// genel müdüre de düşseydi süzülmemiş içerik yukarı akardı.
//
// `resolveManager` geriye dönük uyum için duruyor ve kümenin ilk üyesini
// verir. Yeni kod kümeyi kullanmalı; tekil hâl "kim olsa olur" demek değil,
// "birini seç" demektir ve onay kararında bu yanlış olurdu.

export type ResolveManagerDb = Pick<PrismaClient, "user" | "orgUnit">;

export type ResolveManagerResult =
  | { found: true; managerId: string; managerOrgUnitId: string }
  /** Yöneticisiz durum sessizce geçilmez; çağıran bunu hata olarak işler. */
  | { found: false; reason: "no_manager_in_chain" | "user_not_found" };

export type ResolveManagersResult =
  | { found: true; managerIds: string[]; managerOrgUnitId: string }
  | { found: false; reason: "no_manager_in_chain" | "user_not_found" };

/** Ağaç bütünlüğü veritabanınca korunuyor; bu yalnızca sonsuz döngü ağıdır. */
const MAX_LEVELS = 20;

export async function resolveManagers(
  db: ResolveManagerDb,
  userId: string,
): Promise<ResolveManagersResult> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, orgUnitId: true, isUnitManager: true },
  });

  if (!user) return { found: false, reason: "user_not_found" };

  // Kişi kendi biriminin yöneticisiyse kendi birimine bakmaz; aramaya üstten
  // başlar. Aksi hâlde kişi kendi kendisinin yöneticisi çıkardı.
  //
  // Not: iki müdürlü bir birimde müdürlerden birinin yöneticisi diğeri
  // **değildir** — ikisi de aynı birimin yöneticisi, yani akran. İkisinin de
  // yöneticisi üst birimdedir.
  let unitId: string | null = user.isUnitManager
    ? await parentOf(db, user.orgUnitId)
    : user.orgUnitId;

  for (let level = 0; level < MAX_LEVELS && unitId !== null; level += 1) {
    const managers = await db.user.findMany({
      where: {
        orgUnitId: unitId,
        isUnitManager: true,
        isActive: true,
        // Kişinin kendisi aday olamaz.
        id: { not: user.id },
      },
      select: { id: true },
      // Sıra kararlı olsun: "ilk onaylayıcı" her koşuda aynı kişi olmalı,
      // yoksa aynı girdi farklı kayıt üretir.
      orderBy: { id: "asc" },
    });

    if (managers.length > 0) {
      return {
        found: true,
        managerIds: managers.map((yonetici) => yonetici.id),
        managerOrgUnitId: unitId,
      };
    }

    unitId = await parentOf(db, unitId);
  }

  return { found: false, reason: "no_manager_in_chain" };
}

/**
 * Kümenin ilk üyesi. Tek bir yöneticiyle yetinen eski çağrı yerleri için;
 * onay kararı veren kod **kümeyi** kullanmalı.
 */
export async function resolveManager(
  db: ResolveManagerDb,
  userId: string,
): Promise<ResolveManagerResult> {
  const sonuc = await resolveManagers(db, userId);
  if (!sonuc.found) return sonuc;

  return {
    found: true,
    managerId: sonuc.managerIds[0],
    managerOrgUnitId: sonuc.managerOrgUnitId,
  };
}

async function parentOf(
  db: ResolveManagerDb,
  orgUnitId: string,
): Promise<string | null> {
  const unit = await db.orgUnit.findUnique({
    where: { id: orgUnitId },
    select: { parentId: true },
  });

  return unit?.parentId ?? null;
}
