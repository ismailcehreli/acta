import type { PrismaClient } from "@prisma/client";

import { readWorkCalendar } from "./settings";

// Birime özel mesai penceresi (Görev 11.9, tasarım Paket H).
//
// **Takvim ikiye ayrıldı ve ayrımın gerekçesi şu:**
//
//   · **Mesai penceresi** tek bir kişiye sorulan bir sorudur — "Ahmet'in
//     mesaisi bitti mi?" Ahmet depoda 17:00'de çıkıyorsa cevap 17:00'dir.
//     Bu yüzden birim bazlı.
//   · **İş günü sayacı** iki kişi arasındaki ortak süre ölçüsüdür — soruyu
//     satıştan biri sorar, cevabı üretimden biri verir. Taraflardan birinin
//     takvimine bağlansaydı aynı kayıt iki ekranda farklı sayı gösterirdi.
//     Bu yüzden şirket geneli kaldı ve `businessDaysBetween` buradan
//     etkilenmiyor.
//
// Çözümleme ağaçta yukarı yürür: birimin satırı yoksa üst birime, en sonda
// şirket varsayılanına düşülür. 30 birimlik bir ağaçta iki üç satır yeter.

export type UnitCalendarDb = Pick<
  PrismaClient,
  "orgUnitWorkCalendar" | "orgUnit" | "workCalendar" | "holiday"
>;

export type UnitCalendarWriteDb = UnitCalendarDb &
  Pick<PrismaClient, "$transaction" | "$executeRaw">;

/**
 * Mesai penceresini değiştiren **bütün** yolların aldığı kilit
 * (denetim 24.08.2026, P4-1).
 *
 * Birim taşıma, onaylanan pencerenin hâlâ geçerli olduğunu kendi işleminin
 * içinde doğruluyor. Takvim yazıları bu kilide katılmazsa doğrulama ile yazma
 * arasında araya girebiliyor ve taşıma, sistem yöneticisinin **görmediği** bir
 * pencereyle tamamlanıyordu: uyarının bütün amacı buydu.
 */
export const MESAI_PENCERESI_KILIDI = "faaliyet:mesai_penceresi";

export interface UnitWorkWindow {
  workingDays: number[];
  workStartMinute: number;
  workEndMinute: number;
  worksOnHolidays: boolean;
  /** Değer nereden geldi; ekranda "devralındı" yazabilmek için. */
  source: "unit" | "inherited" | "company";
  /** Devralındıysa hangi birimden. */
  sourceUnitName: string | null;
}

export interface UnitCalendarInput {
  workingDays: number[];
  workStartMinute: number;
  workEndMinute: number;
  worksOnHolidays: boolean;
}

/**
 * Ağacın ve takvimlerin **tek seferlik** anlık görüntüsü.
 *
 * Pencere çözümlemesi saf bir işleve indirgeniyor (denetim
 * 23.08.2026, bulgu 9). `resolveUnitWorkWindow` "ağaç bir kez okunur"
 * diyordu ama bu **çağrı başına** bir kezdi: hatırlatma işçisi her farklı
 * birim için, takvim yönetim sayfası her satır için, skor hesabı her kişi ve
 * her dönem için ağacın ve bütün birim takvimlerinin tamamını yeniden
 * yüklüyordu. 40 kişilik bir ekipte bu tek başına yüzlerce sorgu demekti.
 *
 * İndeks istek (ya da işçi turu) başına bir kez yüklenir ve saf çözümleyiciye
 * verilir.
 */
export interface UnitCalendarIndex {
  birimler: Map<string, { id: string; parentId: string | null; name: string }>;
  takvimler: Map<string, UnitCalendarInput>;
  sirket: { workingDays: number[]; workStartMinute: number; workEndMinute: number };
}

export async function loadUnitCalendarIndex(
  db: UnitCalendarDb,
): Promise<UnitCalendarIndex> {
  const [birimler, takvimler, sirket] = await Promise.all([
    db.orgUnit.findMany({ select: { id: true, parentId: true, name: true } }),
    db.orgUnitWorkCalendar.findMany(),
    readWorkCalendar(db),
  ]);

  return {
    birimler: new Map(birimler.map((b) => [b.id, b])),
    takvimler: new Map(
      takvimler.map((t) => [
        t.orgUnitId,
        {
          workingDays: t.workingDays,
          workStartMinute: t.workStartMinute,
          workEndMinute: t.workEndMinute,
          worksOnHolidays: t.worksOnHolidays,
        },
      ]),
    ),
    sirket: {
      workingDays: sirket.workingDays,
      workStartMinute: sirket.workStartMinute,
      workEndMinute: sirket.workEndMinute,
    },
  };
}

/**
 * Birimin geçerli mesai penceresi — **sorgusuz**.
 *
 * Zincir bellekte yürünür: birimin kendi tanımı varsa o, yoksa ilk tanımlı
 * üst, hiçbiri yoksa şirket varsayılanı.
 */
export function resolveUnitWorkWindowFrom(
  indeks: UnitCalendarIndex,
  orgUnitId: string,
): UnitWorkWindow {
  let mevcut = indeks.birimler.get(orgUnitId);
  let ilk = true;

  while (mevcut) {
    const takvim = indeks.takvimler.get(mevcut.id);
    if (takvim) {
      return {
        workingDays: [...takvim.workingDays].sort((a, b) => a - b),
        workStartMinute: takvim.workStartMinute,
        workEndMinute: takvim.workEndMinute,
        worksOnHolidays: takvim.worksOnHolidays,
        source: ilk ? "unit" : "inherited",
        sourceUnitName: ilk ? null : mevcut.name,
      };
    }

    ilk = false;
    mevcut = mevcut.parentId ? indeks.birimler.get(mevcut.parentId) : undefined;
  }

  // Hiçbir üstte tanım yoksa şirket varsayılanı. Resmî tatilde çalışma
  // varsayılanı **kapalı**: istisna bilinçli olarak işaretlenmeli.
  return {
    workingDays: indeks.sirket.workingDays,
    workStartMinute: indeks.sirket.workStartMinute,
    workEndMinute: indeks.sirket.workEndMinute,
    worksOnHolidays: false,
    source: "company",
    sourceUnitName: null,
  };
}

/**
 * Tek birimin penceresi; indeksi kendisi yükler.
 *
 * Tek seferlik çağrılar için. **Döngü içinde kullanılmaz** — orada indeks bir
 * kez yüklenip `resolveUnitWorkWindowFrom` çağrılır.
 */
export async function resolveUnitWorkWindow(
  db: UnitCalendarDb,
  orgUnitId: string,
): Promise<UnitWorkWindow> {
  return resolveUnitWorkWindowFrom(await loadUnitCalendarIndex(db), orgUnitId);
}

/** Birimin mesai penceresini kaydeder ya da günceller. */
export async function saveUnitWorkCalendar(
  db: UnitCalendarWriteDb,
  orgUnitId: string,
  input: UnitCalendarInput,
): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${MESAI_PENCERESI_KILIDI}))`;

    await tx.orgUnitWorkCalendar.upsert({
      where: { orgUnitId },
      update: input,
      create: { orgUnitId, ...input },
    });
  });
}

/** Birimin kendi tanımını kaldırır; birim yeniden üstünden devralır. */
export async function clearUnitWorkCalendar(
  db: UnitCalendarWriteDb,
  orgUnitId: string,
): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${MESAI_PENCERESI_KILIDI}))`;

    await tx.orgUnitWorkCalendar.deleteMany({ where: { orgUnitId } });
  });
}
