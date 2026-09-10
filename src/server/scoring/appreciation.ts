import type { PrismaClient } from "@prisma/client";

import {
  findVisibleActivity,
  type ActivityRepositoryDb,
} from "@/server/authz/activity-repository";
import {
  visibleActivityWhere,
  type VisibilityDb,
  type Viewer,
} from "@/server/authz/visibility";
import { SETTING_KEYS, readBooleanSetting } from "@/server/settings/system-settings";

import { acquireScoreMutationLock } from "./recalculation";

// Takdir (Görev 11.11, tasarım Paket I).
//
// Takdir kayda verilir; puan katkısı da yalnızca onaylanmış faaliyetin sahibine
// verilir. Takdir başına puan sistem ayarından belirlenir ve temel skorun
// üzerine eklenir.
//
// **Elle puan verme yoktur.** Puan katkısı yalnız geçerli takdir sayısı ile
// sistem ayarındaki takdir başına puandan hesaplanır.

export type AppreciationDb = VisibilityDb &
  Pick<
    PrismaClient,
    "activityAppreciation" | "systemSetting" | "user" | "$transaction" | "$executeRaw"
  > &
  ActivityRepositoryDb;

export type AppreciationResult =
  | { ok: true }
  | { ok: false; message: string };

/**
 * Bir faaliyete takdir verir.
 *
 * Üç koşul: sistem açık, kişi yetkili, ve **kaydı görebiliyor**. Sonuncusu
 * bir okuma yoludur: göremediğin kaydı takdir edemezsin, aksi hâlde adres
 * çubuğuna kimlik yazarak kaydın varlığı öğrenilebilirdi (§18.4).
 */
export async function appreciateActivity(
  db: AppreciationDb,
  userId: string,
  activityId: string,
  now: Date,
): Promise<AppreciationResult> {
  return db.$transaction(async (tx) => {
    // Takdir de skora girdiği için dönem kapanışıyla aynı mutasyon kilidine
    // katılır. Böylece takdir ya kapanışa dahil edilir ya da sonraki dönemde
    // kalır; iki işlem arasında kaybolmaz.
    await acquireScoreMutationLock(tx);

    if (!(await readBooleanSetting(tx, SETTING_KEYS.appreciationEnabled))) {
      return { ok: false, message: "Takdir sistemi kapalı." };
    }

    const kisi = await tx.user.findUnique({
      where: { id: userId },
      select: { canAppreciate: true, isActive: true, isSystemAdmin: true },
    });
    if (!kisi?.isActive || !kisi.canAppreciate) {
      return { ok: false, message: "Takdir verme yetkiniz yok." };
    }

    const kayit = await findVisibleActivity(
      tx,
      {
        id: userId,
        isSystemAdmin: kisi.isSystemAdmin,
      },
      {
        where: { id: activityId },
        select: {
          id: true,
          authorId: true,
          authorOrgUnitId: true,
          approvalStatus: true,
          approverId: true,
        },
      },
    );
    if (!kayit) return { ok: false, message: "Kayıt bulunamadı." };

    if (kayit.authorId === userId) {
      return { ok: false, message: "Kendi faaliyetinize takdir veremezsiniz." };
    }

    // Aynı kişi aynı kaydı iki kez takdir etmez; ikinci tıklama sessizce
    // geçerli sayılır (bileşik birincil anahtar zaten engelliyor).
    await tx.activityAppreciation.upsert({
      where: { activityId_userId: { activityId, userId } },
      update: {},
      create: { activityId, userId, createdAt: now },
    });

    return { ok: true };
  });
}

/** Kaydın aldığı takdir sayısı. */
export async function countAppreciations(
  db: AppreciationDb,
  activityId: string,
): Promise<number> {
  return db.activityAppreciation.count({ where: { activityId } });
}

/**
 * Kişinin dönemde aldığı takdir; profilindeki skor katkısıyla birlikte
 * gösterilebilmesi için ayrı bir sayaç olarak da okunur.
 *
 * **Sayaç da bir okuma yoludur** (denetim 23.08.2026, bulgu 3).
 * Eskiden bakan sorulmuyordu ve hedefin **bütün** kayıtlarındaki takdirler
 * sayılıyordu: aktif onaylayıcı, yalnız kendi önünde duran bekleyen kaydı
 * takdir ettiğinde üst yönetici sayacın arttığını görüyordu. Sayı kaydın
 * başlığını vermez ama varlığını bildirir ve §18.4 türetilmiş değerleri de
 * kapsar. Kapsam artık sorgunun içinde.
 *
 * Ayar kapalıyken `null` döner: `0` "takdir almamış" demektir, `null`
 * "böyle bir gösterge yok" demek. İkisini aynı değere indirmek, ayar
 * kapalıyken de "takdir edilmemiş" diye okunan bir sayı bırakırdı.
 */
export async function countAppreciationsForUser(
  db: AppreciationDb,
  viewer: Viewer,
  userId: string,
  from: Date,
  to: Date,
): Promise<number | null> {
  if (!(await readBooleanSetting(db, SETTING_KEYS.appreciationEnabled))) {
    return null;
  }

  const kapsam = await visibleActivityWhere(db, viewer);

  return db.activityAppreciation.count({
    where: {
      createdAt: { gte: from, lte: to },
      activity: { AND: [kapsam, { authorId: userId }] },
    },
  });
}
