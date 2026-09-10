import type { PrismaClient } from "@prisma/client";

import { countableActivityWhere } from "@/server/activities/countable";
import { companyDay, toDateValue } from "@/server/activities/date-rules";
import { managedAuthorsWhere } from "@/server/activities/scope-feed";
import {
  groupVisibleActivities,
  type ActivityRepositoryDb,
} from "@/server/authz/activity-repository";
import {
  type Viewer,
} from "@/server/authz/visibility";
import { isBusinessDay } from "@/server/calendar/business-days";
import { loadWorkCalendar } from "@/server/calendar/work-calendar";

// Ana ekranın grafik verileri.
//
// **Grafik de bir okuma yoludur**: hepsi `visibleActivityWhere` üzerinden
// hesaplanır. Bir çubuğun yüksekliği bile bilgidir — kullanıcının göremediği
// kayıtlar o çubuğa eklenseydi, sayı sızıntısı olurdu.
//
// Grafikler **sunucuda hesaplanır**, ham kayıt listesi tarayıcıya inmez.
// İstemciye giden tek şey gün ve sayıdır.

export type ChartsDb = ActivityRepositoryDb &
  Pick<PrismaClient, "orgUnit" | "workCalendar" | "holiday">;

export interface TrendPoint {
  /** `YYYY-MM-DD`, şirket saatiyle. */
  day: string;
  count: number;
}

export interface TrendSummary {
  points: TrendPoint[];
  /** Dönemdeki toplam kayıt. */
  total: number;
  /**
   * Yalnız çalışma günlerinin ortalaması; çalışılmayan gün ortalamayı bozar.
   *
   * "Çalışma günü" **şirketin takviminden** gelir (§12.1): çalışma günleri ve
   * resmî tatiller. Önceden burada sabit bir cumartesi-pazar kontrolü vardı ve
   * ayardan bağımsız çalışıyordu; cumartesi çalışan bir şirkette ortalama
   * yanlış çıkıyordu (denetim 21.08.2026, bulgu 13).
   */
  workdayAverage: number;
  /** En yoğun gün; eşitlikte en yenisi. */
  busiest: TrendPoint | null;
  /**
   * Önceki eşit uzunluktaki döneme göre değişim yüzdesi. Önceki dönem boşsa
   * `null` — sıfırdan artışı yüzdeyle anlatmak ("+∞") bilgi değil gürültüdür.
   */
  changePercent: number | null;
  /** Kayıt girilmemiş çalışma günü sayısı. */
  emptyWorkdays: number;
}

export interface StatusSlice {
  status: "APPROVED" | "PENDING_APPROVAL" | "CHANGES_REQUESTED" | "REJECTED" | "CANCELLED" | "MANAGER_NOT_FOUND" | "DRAFT";
  count: number;
}

export interface DashboardChartOptions {
  /** Yönetilen alan için yazarları astlarla sınırla. */
  managedOnly?: boolean;
}

/**
 * Son N takvim gününün kayıt sayısı. Hafta sonları **atlanmaz**: eksik gün
 * grafikte boşluk olarak görünmeli, aksi hâlde "cumartesi kimse yazmamış"
 * bilgisi kaybolur ve çizgi yanıltıcı biçimde düz çıkar.
 */
export async function activityTrend(
  db: ChartsDb,
  viewer: Viewer,
  subordinates: string[],
  days: number,
  now: Date,
  options: DashboardChartOptions = {},
): Promise<TrendSummary> {
  // İki dönem birden okunur: grafiğin gösterdiği aralık ve ondan **önceki**
  // eşit uzunluktaki aralık. Karşılaştırma olmadan bir sayı ("30 kayıt") tek
  // başına iyi mi kötü mü söylemez.
  const bugun = companyDay(now);
  const tumGunler: string[] = [];
  const imlec = new Date(`${bugun}T00:00:00.000Z`);
  imlec.setUTCDate(imlec.getUTCDate() - (days * 2 - 1));

  for (let i = 0; i < days * 2; i += 1) {
    tumGunler.push(imlec.toISOString().slice(0, 10));
    imlec.setUTCDate(imlec.getUTCDate() + 1);
  }

  const rows = (await groupVisibleActivities(db, viewer, {
    by: ["activityDate"],
    where: {
      AND: [
        ...(options.managedOnly ? [managedAuthorsWhere(subordinates)] : []),
        // Eğilim "ne kadar iş yapıldı" çizgisidir; iptal ve ret sayılmaz
        // (karar 03.09.2026). Durum dağılımı grafiği bilerek hepsini sayar:
        // onun konusu zaten durumların kendisidir.
        countableActivityWhere(),
        { activityDate: { gte: toDateValue(tumGunler[0]) } },
        { activityDate: { lte: toDateValue(tumGunler[tumGunler.length - 1]) } },
      ],
    },
    _count: { _all: true },
  }, subordinates)) as { activityDate: Date; _count: { _all: number } }[];

  const sayilar = new Map(
    rows.map((row) => [
      row.activityDate.toISOString().slice(0, 10),
      row._count._all,
    ]),
  );

  const say = (gun: string) => sayilar.get(gun) ?? 0;
  const oncekiGunler = tumGunler.slice(0, days);
  const gunler = tumGunler.slice(days);

  const points: TrendPoint[] = gunler.map((day) => ({ day, count: say(day) }));
  const total = points.reduce((acc, nokta) => acc + nokta.count, 0);
  const onceki = oncekiGunler.reduce((acc, gun) => acc + say(gun), 0);

  // Takvim şirketin kendi tanımından okunur; sabit hafta sonu varsayımı yok.
  const takvim = await loadWorkCalendar(db, toDateValue(tumGunler[0] as string), now);
  const calismaGunleri = points.filter((nokta) =>
    isBusinessDay(nokta.day, {
      workingDays: takvim.workingDays,
      holidays: takvim.holidays,
    }),
  );

  return {
    points,
    total,
    workdayAverage:
      calismaGunleri.length === 0
        ? 0
        : Math.round(
            (calismaGunleri.reduce((acc, n) => acc + n.count, 0) /
              calismaGunleri.length) *
              10,
          ) / 10,
    busiest:
      total === 0
        ? null
        : points.reduce((en, nokta) => (nokta.count >= en.count ? nokta : en)),
    changePercent:
      onceki === 0 ? null : Math.round(((total - onceki) / onceki) * 100),
    emptyWorkdays: calismaGunleri.filter((nokta) => nokta.count === 0).length,
  };
}

/**
 * Kapsamdaki kayıtların onay durumuna göre dağılımı. Dönem süzgeci uygulanır:
 * "bu hafta ne oldu" sorusunun cevabı, geçen ayki kayıtlarla karışmamalı.
 */
export async function statusDistribution(
  db: ChartsDb,
  viewer: Viewer,
  subordinates: string[],
  since: Date | null,
  options: DashboardChartOptions = {},
): Promise<StatusSlice[]> {
  const rows = (await groupVisibleActivities(db, viewer, {
    by: ["approvalStatus"],
    where: {
      AND: [
        ...(options.managedOnly ? [managedAuthorsWhere(subordinates)] : []),
        ...(since ? [{ activityDate: { gte: since } }] : []),
      ],
    },
    _count: { _all: true },
  }, subordinates)) as { approvalStatus: string; _count: { _all: number } }[];

  return rows
    .map((row) => ({
      status: row.approvalStatus as StatusSlice["status"],
      count: row._count._all,
    }))
    .sort((a, b) => b.count - a.count);
}
