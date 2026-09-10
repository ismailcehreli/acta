import type { Activity, OrgUnit, User } from "@prisma/client";

import { hashPassword } from "@/server/auth/password";

import { testDb } from "./test-db";

// Testlerin okunur kalması için asgari kurulum yardımcıları. Her çağrı benzersiz
// ad/e-posta üretir ki tekillik kısıtları istemeden tetiklenmesin.

let counter = 0;

function unique(): string {
  counter += 1;
  return String(counter);
}

export async function createOrgUnit(
  data: Partial<Omit<OrgUnit, "id" | "createdAt" | "updatedAt">> = {},
): Promise<OrgUnit> {
  const n = unique();
  return testDb.orgUnit.create({
    data: {
      name: data.name ?? `Birim ${n}`,
      type: data.type ?? "Departman",
      ...data,
    },
  });
}

/**
 * Kişinin **var olduğu an**; testlerin sahte takviminden önce.
 *
 * Fixture kullanıcıyı gerçek saatle damgalıyordu. Skor kapanışı artık
 * "dönemde var mıydı" diye soruyor (denetim 25.08.2026, P8-R2-3) ve
 * gerçek saat testlerin 2026 Ağustos takviminin ilerisine düştüğü için
 * hiç kimse kapanışa giremiyordu. Parola kurulum anında da aynı gerekçe var.
 */
const KURULUS_ANI = new Date("2026-01-01T00:00:00.000Z");

export async function createUser(
  orgUnitId: string,
  data: Partial<Omit<User, "id" | "orgUnitId" | "updatedAt">> = {},
): Promise<User> {
  const n = unique();
  return testDb.user.create({
    data: {
      fullName: data.fullName ?? `Kullanıcı ${n}`,
      email: data.email ?? `kullanici${n}@ornek.test`,
      orgUnitId,
      createdAt: KURULUS_ANI,
      ...data,
    },
  });
}

export async function createActivity(
  author: Pick<User, "id" | "orgUnitId">,
  data: Partial<
    Omit<Activity, "id" | "authorId" | "authorOrgUnitId" | "createdAt" | "updatedAt">
  > = {},
): Promise<Activity> {
  const n = unique();
  const activity = await testDb.activity.create({
    data: {
      authorId: author.id,
      // Yazım anındaki birim dondurulur (§4.6).
      authorOrgUnitId: author.orgUnitId,
      activityDate: data.activityDate ?? new Date("2026-08-17T00:00:00.000Z"),
      title: data.title ?? `Faaliyet ${n}`,
      description: data.description ?? `Açıklama ${n}`,
      ...data,
    },
  });

  // Uygun onaylayıcılar listesi, gerçek yazma yolunda da kayıtla birlikte
  // doğuyor (20.08.2026 kararı). Fixture bunu atlarsa görünürlük sorgusu
  // testte üretimden farklı davranır — kayıt onaylayıcının kapsamına hiç
  // girmez ve test yeşil kalarak yalan söyler.
  if (activity.approverId) {
    await testDb.activityApprover.create({
      data: { activityId: activity.id, userId: activity.approverId },
    });
  }

  // Onay turu da kayıtla birlikte doğuyor (denetim 23.08.2026,
  // P3-R2-1). Fixture bunu atlarsa karar servisi "açık tur yok" diye
  // patlar ve testler üretimden farklı bir dünyada koşar — aynı gerekçe,
  // uygun onaylayıcılar listesinde de yazılı.
  if (activity.approvalStatus === "PENDING_APPROVAL" && activity.approvalSubmittedAt) {
    await testDb.approvalRound.create({
      data: {
        activityId: activity.id,
        roundNo: 1,
        submittedAt: activity.approvalSubmittedAt,
      },
    });
  }

  // **Karara bağlanmış kayıt kapalı bir tur taşır** (denetim
  // 25.08.2026, P8-2 çalışmasında yakalandı).
  //
  // Onaya tabi birimde karar her zaman `approveActivity`/`requestChanges`/
  // `rejectActivity` üzerinden veriliyor ve o servisler turu kapatıyor.
  // Fixture doğrudan `approvalStatus: "APPROVED"` yazdığında tursuz bir kayıt
  // doğuyordu: üretimde imkânsız. Kabul artık tur geçmişinden okunduğu için
  // böyle bir satır testte üretimden farklı davranır — ve nitekim davrandı.
  const KARARLAR = ["APPROVED", "REJECTED", "CHANGES_REQUESTED"] as const;
  const karar = KARARLAR.find((k) => k === activity.approvalStatus);
  if (activity.approverId && karar) {
    // Zaman verilmediyse **faaliyet günü** kullanılıyor: `createdAt`
    // gerçek saatten geliyor ve testlerin sahte takviminin (2026 Ağustos)
    // ilerisine düşüp kararı dönem dışına atıyordu.
    const gonderim = activity.approvalSubmittedAt ?? activity.activityDate;
    await testDb.approvalRound.create({
      data: {
        activityId: activity.id,
        roundNo: 1,
        submittedAt: gonderim,
        decidedAt: activity.approvalDecidedAt ?? gonderim,
        decidedById: activity.approverId,
        decision: karar,
      },
    });
  }

  return activity;
}

/**
 * Parolası kurulmuş kullanıcı; giriş testleri bunun üzerinden çalışır.
 * Parola kurulum anı bilerek geçmişe alınır: oturumlar parola değişiminden
 * sonra doğmuş olmalıdır (bkz. `findActiveSession` kuşak kontrolü), testlerin
 * sahte saati ise 2026 Ağustos'unu kullanır.
 */
export async function createUserWithPassword(
  orgUnitId: string,
  password: string,
  data: Partial<Omit<User, "id" | "orgUnitId" | "createdAt" | "updatedAt">> = {},
): Promise<User> {
  const user = await createUser(orgUnitId, data);

  await testDb.userCredential.create({
    data: {
      userId: user.id,
      passwordHash: await hashPassword(password),
      passwordChangedAt: new Date("2026-01-01T00:00:00.000Z"),
    },
  });

  return user;
}

/**
 * Onay kararı gerekçesi. Katalog geçişte tohumlanıyor ama `resetDatabase`
 * her testten önce tabloları boşaltıyor; testler kendi gerekçesini kurar.
 */
export async function createApprovalReason(
  kind: "CHANGES_REQUESTED" | "REJECTED",
  label?: string,
): Promise<{ id: string; label: string }> {
  const n = unique();
  return testDb.approvalReason.create({
    data: { kind, label: label ?? `Gerekçe ${n}`, sortOrder: 10 },
    select: { id: true, label: true },
  });
}
