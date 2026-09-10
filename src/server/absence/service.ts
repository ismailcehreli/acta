import type {
  NoActivityDecisionRoute,
  NoActivityPeriodStatus,
  Prisma,
  PrismaClient,
} from "@prisma/client";

import { toDateValue } from "@/server/activities/date-rules";
import { AUDIT_ACTIONS, AUDIT_OBJECTS, recordAudit, type AuditDb } from "@/server/audit/log";
import { isExclusionViolation } from "@/server/db-errors";

import { enqueueNotification } from "@/server/notifications/enqueue";
import { NOTIFICATION_EVENTS } from "@/server/notifications/events";
import { readNumericSetting, SETTING_KEYS } from "@/server/settings/system-settings";

import {
  absenceDecisionRoute,
  resolveAbsenceApproversForUser,
  visibleAbsenceUserIds,
} from "./approval-routing";
import { GECERLI_DONEM } from "./period-filter";

export {
  listAbsenceDeputies,
  managedAbsenceEmployeeIds,
  visibleAbsenceUserIds,
} from "./approval-routing";

// "Faaliyet beklenmiyor" dönemi, kişiye belirli günlerde faaliyet hatırlatması
// gönderilmemesini sağlar. Çalışanın kendi talebi, yöneticisi onaylayana kadar
// geçerli değildir. Birim yöneticisinin kendi kaydı ve aynı departmandaki
// çalışan için yöneticinin girdiği kayıt doğrudan onaylıdır. Bu alan izin türü
// veya izin bakiyesi yönetmez.

export type AbsenceDb = Pick<
  PrismaClient,
  | "noActivityPeriod"
  | "user"
  | "orgUnit"
  | "notificationQueue"
  | "systemSetting"
  | "$transaction"
  | "$executeRaw"
  | "$queryRaw"
> & AuditDb;

export interface AbsenceInput {
  userId: string;
  /** `YYYY-MM-DD`. */
  startDate: string;
  endDate: string;
  note?: string;
  /** Yönetici yokluğunda görev alacak aktif birim yöneticisi. */
  deputyId?: string;
}

export type AbsenceError =
  /** Hedef kişi işaretleyenin departmanında yönetici olmayan çalışan değil. */
  | "not_subordinate"
  /** Vekil, izne çıkanla aynı kişi. */
  | "deputy_is_self"
  /** Vekâlet yalnız yönetici için tanımlanabilir. */
  | "absent_not_manager"
  /** Vekil de birim yöneticisi olmalı. */
  | "deputy_not_manager"
  /** Aralık başka bir işaretle çakışıyor. */
  | "overlaps"
  | "invalid_range"
  /** İptal gerekçesi boş. */
  | "reason_required"
  /** Kayıt bulunamadı ya da zaten iptal edilmiş. */
  | "not_found"
  /** Kişinin kendi girebileceği süreyi aşıyor (Görev 11.8). */
  | "too_long_for_self"
  /** Talebi karara bağlayacak aktif yönetici bulunamadı. */
  | "manager_not_found";

export type AbsenceResult =
  | { ok: true; id: string; status: NoActivityPeriodStatus }
  | { ok: false; error: AbsenceError; message: string };

const MESSAGES: Record<AbsenceError, string> = {
  // Yetkisiz işaretlemede kişinin varlığı da doğrulanmaz (§18.4).
  not_subordinate: "Bu kişi için kayıt giremezsiniz.",
  overlaps: "Bu kişi için bu tarihlerde zaten bir kayıt var.",
  invalid_range: "Bitiş tarihi başlangıçtan önce olamaz.",
  deputy_is_self: "Kişi kendi vekili olamaz.",
  absent_not_manager:
    "Vekil yalnız birim yöneticisi için tanımlanabilir. Yönetici olmayan bir kişide devredilecek onay kuyruğu yoktur.",
  deputy_not_manager:
    "Vekil de birim yöneticisi olmalı: vekâlet, vekâlet edilen kişinin kapsamını açar.",
  reason_required: "İptal gerekçesi yazılmalı.",
  // Yetkisiz erişimde kaydın varlığı da doğrulanmaz (§18.4): "sizin değil"
  // demek, kaydın var olduğunu söylerdi.
  not_found: "Kayıt bulunamadı.",
  too_long_for_self:
    "Bu kadar uzun bir dönemi kendiniz giremezsiniz; yöneticiniz girebilir.",
  manager_not_found:
    "Talebinizi karara bağlayacak aktif yönetici bulunamadı. Sistem yöneticisine başvurun.",
};

function fail(error: AbsenceError): AbsenceResult {
  return { ok: false, error, message: MESSAGES[error] };
}

export interface AbsenceView {
  id: string;
  userId: string;
  userName: string;
  startDate: string;
  endDate: string;
  note: string | null;
  deputyName: string | null;
  /** İptal edilmişse gerekçesi; edilmemişse `null`. */
  cancelledReason: string | null;
  /** Talebin karar durumu. */
  status: NoActivityPeriodStatus;
  /** Reddedilmişse yöneticinin yazdığı gerekçe. */
  decisionReason: string | null;
  decidedAt: Date | null;
  /** Kararı veren kişinin adı. */
  decidedByName: string | null;
  /** Kararın doğrudan yönetici, vekil veya üst yönetici yolunu belirtir. */
  decisionRoute: NoActivityDecisionRoute | null;
  /** Bu satır için oturumdaki yöneticinin karar yetkisi var mı? */
  canDecide?: boolean;
  /** Bu satır doğrudan yöneticinin iptal edebileceği kapsamda mı? */
  canCancel?: boolean;
  /** Kaydı kişinin kendisi mi girdi, yöneticisi mi (Görev 11.8). */
  markedBySelf?: boolean;
}

/**
 * Ekip izin listesinin daraltmaları (Görev 11.4).
 *
 * İptal edilen kayıtlar listede kaldığı için (bilerek — aşağıda gerekçesi)
 * liste zamanla uzuyor ve "Kadir'in girilmiş dönemleri" sorusu gözle
 * taranarak cevaplanıyordu.
 */
export interface AbsenceFilters {
  userId?: string;
  /** `active` onaylı/geçerli, `pending` bekleyen, `rejected` reddedilen. */
  status?: "active" | "pending" | "rejected" | "cancelled";
}

/**
 * İzin ekranındaki yazma kapsamı.
 *
 * Yöneticiler yalnız kendi departmanlarındaki çalışanlar için doğrudan kayıt
 * açar. Ekranın okuma kapsamı bundan geniş olabilir; üst yöneticiler alt
 * organizasyonun izin geçmişini görür, karar düğmeleri ise satır bazında
 * ayrıca yetki kontrolünden geçer.
 */
export async function departmentEmployeeIds(
  db: Pick<PrismaClient, "user">,
  managerId: string,
  options: { activeOnly?: boolean } = {},
): Promise<string[]> {
  const manager = await db.user.findUnique({
    where: { id: managerId },
    select: { orgUnitId: true, isUnitManager: true },
  });

  if (!manager?.isUnitManager) return [];

  const people = await db.user.findMany({
    where: {
      orgUnitId: manager.orgUnitId,
      isUnitManager: false,
      ...(options.activeOnly ? { isActive: true } : {}),
    },
    select: { id: true },
    orderBy: [{ fullName: "asc" }, { id: "asc" }],
  });

  return people.map((person) => person.id);
}

/**
 * Yönetici vekâleti kurulurken kullanılabilecek aktif yöneticiler.
 *
 * Çalışan izinleri için bu küme kullanılmaz; çalışan yetkisi yalnızca
 * `departmentEmployeeIds` ile aynı departmana iner. Bu ayrı küme, mevcut
 * vekâlet akışında üst yöneticinin başka bir yöneticinin yokluğunu kayda
 * alabilmesi içindir. Vekâlet, çalışan izinlerine ek bir erişim vermez.
 */
export async function subordinateManagerIds(
  db: Pick<PrismaClient, "user" | "$queryRaw">,
  managerId: string,
): Promise<string[]> {
  const manager = await db.user.findUnique({
    where: { id: managerId },
    select: { orgUnitId: true, isUnitManager: true, isActive: true },
  });
  if (!manager?.isUnitManager || !manager.isActive) return [];

  const rows = await db.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE subtree(id) AS (
      SELECT "id" FROM "OrgUnit" WHERE "id" = ${manager.orgUnitId}
      UNION ALL
      SELECT child."id"
      FROM "OrgUnit" child
      JOIN subtree ON child."parentId" = subtree.id
    )
    SELECT u."id"
    FROM "User" u
    JOIN subtree ON u."orgUnitId" = subtree.id
    WHERE u."isUnitManager" = true
      AND u."isActive" = true
  `;

  return rows.map((row) => row.id);
}

async function scopedDepartmentEmployees(
  db: AbsenceDb,
  managerId: string,
  supplied?: string[],
  now: Date = new Date(),
): Promise<string[]> {
  const allowed = await visibleAbsenceUserIds(db, managerId, now);
  if (!supplied) return allowed;

  // Çağıran önceden hesaplanmış bir liste gönderebilir. Bu liste hiçbir zaman
  // yetki kaynağı değildir; yalnızca izin yönetimi kapsamının kesişimi olarak
  // kullanılabilir.
  const suppliedSet = new Set(supplied);
  return allowed.filter((id) => suppliedSet.has(id));
}

/**
 * Ekip koşulu ve süzgeçler **`AND` ile** birleşir.
 *
 * Nesne yayma (`{ userId: { in: ekip }, ...suzgec }`) ile yazılmıştı ve bu bir
 * sızıntıydı: Prisma'da aynı alan iki kez verilince **sonuncusu kazanır**, yani
 * kişi süzgeci ekip koşulunu eziyordu. Adres çubuğuna asta olmayan birinin
 * kimliğini yazan yönetici onun izin kayıtlarını görebiliyordu.
 *
 * `AND` listesi bu hatayı yapısal olarak imkânsız kılar: koşullar birbirini
 * ezemez, yalnız daraltır (§8.4). Sızıntı testi bulguyu yakaladı.
 */
function absenceWhere(
  ekip: string[],
  filters: AbsenceFilters,
): Prisma.NoActivityPeriodWhereInput {
  const kosullar: Prisma.NoActivityPeriodWhereInput[] = [
    { userId: { in: ekip } },
  ];

  if (filters.userId) kosullar.push({ userId: filters.userId });
  if (filters.status === "active") {
    kosullar.push({ cancelledAt: null, status: "APPROVED" });
  }
  if (filters.status === "pending") {
    kosullar.push({ cancelledAt: null, status: "PENDING" });
  }
  if (filters.status === "rejected") kosullar.push({ status: "REJECTED" });
  if (filters.status === "cancelled") {
    kosullar.push({ cancelledAt: { not: null } });
  }

  return { AND: kosullar };
}

/** Yöneticinin ekibi için konulmuş işaretler. */
export async function listTeamAbsences(
  db: AbsenceDb,
  managerId: string,
  subordinates?: string[],
  filters: AbsenceFilters = {},
  options: { limit?: number; skip?: number; now?: Date } = {},
): Promise<AbsenceView[]> {
  const now = options.now ?? new Date();
  const ekip = await scopedDepartmentEmployees(
    db,
    managerId,
    subordinates,
    now,
  );
  if (ekip.length === 0) return [];

  // İptal edilenler de listelenir, üstü çizili olarak: kaybolan bir kayıt
  // "ben bunu girmiş miydim?" sorusunu doğurur. İptal edildiğini görmek,
  // hiç görmemekten iyidir (§16.5'teki genel kalıp).
  const [actor, rows] = await Promise.all([
    db.user.findUnique({
      where: { id: managerId },
      select: { orgUnitId: true, isUnitManager: true, isActive: true },
    }),
    db.noActivityPeriod.findMany({
      where: absenceWhere(ekip, filters),
      ...(options.limit === undefined ? {} : { take: options.limit }),
      ...(options.skip === undefined ? {} : { skip: options.skip }),
      orderBy: [{ cancelledAt: { sort: "asc", nulls: "first" } }, { startDate: "desc" }],
      select: {
        id: true,
        userId: true,
        startDate: true,
        endDate: true,
        note: true,
        cancellationReason: true,
        status: true,
        decisionReason: true,
        decidedAt: true,
        decisionRoute: true,
        decidedBy: { select: { fullName: true } },
        user: {
          select: { fullName: true, orgUnitId: true, isUnitManager: true },
        },
        deputy: { select: { fullName: true } },
      },
    }),
  ]);

  const decisionRoutes = await Promise.all(
    rows.map((row) =>
      row.status === "PENDING"
        ? absenceDecisionRoute(db, managerId, row.userId, now)
        : Promise.resolve(null),
    ),
  );

  return rows.map((row, index) => ({
    id: row.id,
    userId: row.userId,
    userName: row.user.fullName,
    startDate: row.startDate.toISOString().slice(0, 10),
    endDate: row.endDate.toISOString().slice(0, 10),
    note: row.note,
    deputyName: row.deputy?.fullName ?? null,
    cancelledReason: row.cancellationReason,
    status: row.status,
    decisionReason: row.decisionReason,
    decidedAt: row.decidedAt,
    decidedByName: row.decidedBy?.fullName ?? null,
    decisionRoute: row.decisionRoute,
    canDecide: decisionRoutes[index] !== null,
    canCancel:
      actor?.isUnitManager === true &&
      actor.isActive &&
      row.user.isUnitManager === false &&
      row.user.orgUnitId === actor.orgUnitId,
  }));
}

/** Süzgeçli toplam; sayfa sayısı buradan çıkar. */
export async function countTeamAbsences(
  db: AbsenceDb,
  managerId: string,
  subordinates?: string[],
  filters: AbsenceFilters = {},
  now: Date = new Date(),
): Promise<number> {
  const ekip = await scopedDepartmentEmployees(db, managerId, subordinates, now);
  if (ekip.length === 0) return 0;

  return db.noActivityPeriod.count({ where: absenceWhere(ekip, filters) });
}

/**
 * Kişinin **kendi** "faaliyet beklenmiyor" dönemi (Görev 11.8).
 *
 * Herkes kendi dönemini girebilir. Yönetici olmayan kişinin talebi, kendi
 * departmanındaki görevde olan yöneticilere gider. Bu yöneticiler izinliyse
 * aktif vekile, vekil yoksa ilk aktif üst yöneticiye yönlenir; yöneticinin
 * kendi kaydı ise doğrudan onaylıdır.
 *
 * İki fark var:
 *
 *   · Süre sınırı. Kişi ayarda yazan günden uzun bir dönem giremez; daha
 *     uzunu yöneticisi girer. Sınır yalnız kendi girişine ait: yöneticinin
 *     girdiği dönemde onu tanıyan biri kararı zaten vermiş oluyor.
 *   · Çalışan kendi adına vekil seçemez. Vekâlet yönetici düzeyinde bir
 *     karardır; birim yöneticisi kendi kaydında aktif bir yönetici seçebilir.
 *
 * Bekleyen kayıt geçerli sayılmaz; onaylanırsa hatırlatma ve katılım
 * hesaplarından düşer.
 */
export async function markOwnNoActivityPeriod(
  db: AbsenceDb & Pick<PrismaClient, "notificationQueue">,
  userId: string,
  input: {
    startDate: string;
    endDate: string;
    note?: string | null;
    deputyId?: string | null;
  },
  now: Date,
): Promise<AbsenceResult> {
  if (input.endDate < input.startDate) return fail("invalid_range");

  const person = await db.user.findUnique({
    where: { id: userId },
    select: { fullName: true, isUnitManager: true, isActive: true },
  });
  if (!person || !person.isActive) return fail("not_found");

  const deputyId = input.deputyId?.trim() || undefined;
  if (deputyId) {
    if (!person.isUnitManager) return fail("absent_not_manager");
    if (deputyId === userId) return fail("deputy_is_self");

    const deputy = await db.user.findFirst({
      where: { id: deputyId, isActive: true, isUnitManager: true },
      select: { id: true },
    });
    if (!deputy) return fail("deputy_not_manager");
  }

  const sinir = await readNumericSetting(db, SETTING_KEYS.selfAbsenceMaxDays);
  const gun =
    Math.round(
      (toDateValue(input.endDate).getTime() - toDateValue(input.startDate).getTime()) /
        86_400_000,
    ) + 1;
  if (gun > sinir) return fail("too_long_for_self");

  const status: NoActivityPeriodStatus = person.isUnitManager
    ? "APPROVED"
    : "PENDING";
  let approvers: { id: string }[] = [];

  if (!person.isUnitManager) {
    approvers = await resolveAbsenceApproversForUser(db, userId, now);
    if (approvers.length === 0) return fail("manager_not_found");
  }

  const sonuc = await kaydet(
    db,
    {
      userId,
      startDate: input.startDate,
      endDate: input.endDate,
      note: input.note ?? undefined,
      ...(deputyId ? { deputyId } : {}),
    },
    userId,
    now,
    person.isUnitManager
      ? {
          status,
          decidedAt: now,
          decidedById: userId,
          decisionRoute: "DIRECT_ENTRY",
        }
      : { status },
  );
  if (!sonuc.ok) return sonuc;

  if (approvers.length > 0) {
    for (const approver of approvers) {
      await enqueueNotification(db, {
        userId: approver.id,
        eventType: NOTIFICATION_EVENTS.absenceRequestSubmitted,
        payload: {
          personName: person.fullName,
          range: `${input.startDate} – ${input.endDate}`,
        },
        idempotencyKey: `absence_request:${sonuc.id}:${approver.id}`,
        now,
      });
    }
  }

  return sonuc;
}

/** Kişinin kendi dönemleri; iptal edilenler de görünür. */
export async function listOwnAbsences(
  db: AbsenceDb,
  userId: string,
  options: { limit?: number; skip?: number } = {},
): Promise<AbsenceView[]> {
  const rows = await db.noActivityPeriod.findMany({
    where: { userId },
    ...(options.limit === undefined ? {} : { take: options.limit }),
    ...(options.skip === undefined ? {} : { skip: options.skip }),
    orderBy: [{ cancelledAt: { sort: "asc", nulls: "first" } }, { startDate: "desc" }],
    select: {
      id: true,
      userId: true,
      startDate: true,
      endDate: true,
      note: true,
      cancellationReason: true,
      status: true,
      decisionReason: true,
      decidedAt: true,
      decisionRoute: true,
      markedById: true,
      user: { select: { fullName: true } },
      decidedBy: { select: { fullName: true } },
      deputy: { select: { fullName: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    userId: row.userId,
    userName: row.user.fullName,
    startDate: row.startDate.toISOString().slice(0, 10),
    endDate: row.endDate.toISOString().slice(0, 10),
    note: row.note,
    deputyName: row.deputy?.fullName ?? null,
    cancelledReason: row.cancellationReason,
    status: row.status,
    decisionReason: row.decisionReason,
    decidedAt: row.decidedAt,
    decidedByName: row.decidedBy?.fullName ?? null,
    decisionRoute: row.decisionRoute,
    markedBySelf: row.markedById === row.userId,
  }));
}

/** Kişinin kendi dönem sayısı; sayfalama için. */
export async function countOwnAbsences(
  db: AbsenceDb,
  userId: string,
): Promise<number> {
  return db.noActivityPeriod.count({ where: { userId } });
}

export async function markNoActivityPeriod(
  db: AbsenceDb,
  managerId: string,
  input: AbsenceInput,
  now: Date,
): Promise<AbsenceResult> {
  if (input.endDate < input.startDate) return fail("invalid_range");

  const manager = await db.user.findUnique({
    where: { id: managerId },
    select: { orgUnitId: true, isUnitManager: true, isActive: true },
  });
  if (!manager?.isUnitManager || !manager.isActive) return fail("not_subordinate");

  // Yönetici kendi kaydını bu ortak servis üzerinden açabilsin; bu kayıt
  // onay beklemez. Ekipten seçilecek çalışanlar ise yalnız aynı departmandaki
  // aktif ve yönetici olmayan kişilerdir.
  const kendiKaydi = input.userId === managerId;
  const ekip = kendiKaydi
    ? []
    : await departmentEmployeeIds(db, managerId, { activeOnly: true });
  const vekaletYoneticileri = !kendiKaydi
    ? await subordinateManagerIds(db, managerId)
    : [];
  const yoneticiVekaleti =
    !kendiKaydi && vekaletYoneticileri.includes(input.userId);

  // Çalışan yetkisi burada özellikle doğrudan departmanla sınırlıdır.
  // Bunun tek ayrı yolu, mevcut vekâlet akışı için aktif bir yöneticinin
  // yokluğunu ve vekilini kayda almaktır; bu yol çalışanlara açılamaz.
  if (!kendiKaydi && !ekip.includes(input.userId) && !yoneticiVekaleti) {
    return fail("not_subordinate");
  }

  if (input.deputyId) {
    // **Vekâlet yalnız yönetici düzeyinde** (ürün sahibi kararı,
    // 21.08.2026). İki gerekçesi var:
    //
    //   · Devredilecek iş yöneticide birikiyor — onay kuyruğu. Çalışanda
    //     devredilecek şey genelde yalnız açık sorular ve onlar için §9.3
    //     zaten bir yol veriyor.
    //   · Vekil, vekâlet ettiği kişinin kapsamını kazanıyor. Yönetici
    //     olmayan birine bir departmanın kapsamını açmak, ağaçtan gelmeyen
    //     bir yetki yaratırdı.
    if (input.deputyId === input.userId) return fail("deputy_is_self");

    if (!kendiKaydi && !yoneticiVekaleti) return fail("absent_not_manager");
    if (!vekaletYoneticileri.includes(input.deputyId)) {
      const vekil = await db.user.findUnique({
        where: { id: input.deputyId },
        select: { isUnitManager: true, isActive: true },
      });
      if (!vekil?.isUnitManager || !vekil.isActive) {
        return fail("deputy_not_manager");
      }
      return fail("not_subordinate");
    }
  }

  return kaydet(db, input, managerId, now, {
    status: "APPROVED",
    decidedAt: now,
    decidedById: managerId,
    decisionRoute: "DIRECT_ENTRY",
  });
}

/**
 * Kaydı yazan ortak yol (Görev 11.8).
 *
 * Müdürün girdiği ve kişinin kendi girdiği dönem aynı kuralları paylaşıyor:
 * aynı denetim izi, aynı çakışma kısıtı. İki ayrı yazma yolu, birinde
 * düzeltilen bir kuralın diğerinde kalması demekti.
 */
async function kaydet(
  db: AbsenceDb,
  input: AbsenceInput,
  markedById: string,
  now: Date,
  decision: {
    status: NoActivityPeriodStatus;
    decidedAt?: Date;
    decidedById?: string;
    decisionReason?: string | null;
    decisionRoute?: NoActivityDecisionRoute | null;
  } = { status: "APPROVED" },
): Promise<AbsenceResult> {
  try {
    const created = await db.$transaction(async (tx) => {
      const satir = await tx.noActivityPeriod.create({
        data: {
          userId: input.userId,
          startDate: toDateValue(input.startDate),
          endDate: toDateValue(input.endDate),
          note: input.note?.trim() || null,
          deputyId: input.deputyId || null,
          markedById,
          createdAt: now,
          status: decision.status,
          decidedAt: decision.decidedAt ?? null,
          decidedById: decision.decidedById ?? null,
          decisionReason: decision.decisionReason ?? null,
          decisionRoute: decision.decisionRoute ?? null,
        },
      });

      // Vekil atamak bir yetki devridir (§4.5) ve yetki değişiklikleri iz
      // bırakır (§15.2). İşin kendi işleminde yazılır: "vekâlet verildi ama
      // izi yok" durumu mümkün olmamalı.
      await recordAudit(tx, {
        userId: markedById,
        objectType: AUDIT_OBJECTS.user,
        objectId: input.userId,
        action:
          decision.status === "PENDING"
            ? AUDIT_ACTIONS.absenceRequestSubmitted
            : AUDIT_ACTIONS.absenceMarked,
        detail: {
          periodId: satir.id,
          startDate: input.startDate,
          endDate: input.endDate,
          deputyId: input.deputyId ?? null,
          status: decision.status,
        },
        now,
      });

      return satir;
    });

    return { ok: true, id: created.id, status: created.status };
  } catch (error) {
    // Çakışma veritabanı kısıtıyla engellenir (`NoActivityPeriod_no_overlap`);
    // uygulama katmanı devre dışıyken de geçerli olsun diye orada durur.
    //
    // **Çıplak ad aranmıyor**: paketlenmiş kaynakta bu ad zaten geçiyor ve
    // başka bir veritabanı hatası "çakışıyor" diye çevriliyordu
    // (denetim 23.08.2026, bulgu 11). Yardımcı SQLSTATE kodunu ve kısıt
    // adının tırnaklı biçimini birlikte arıyor.
    if (isExclusionViolation(error, "NoActivityPeriod_no_overlap")) {
      return fail("overlaps");
    }
    throw error;
  }
}

/**
 * İşareti **iptal eder** (denetim 21.08.2026, bulgu 7).
 *
 * Silmez. Vekilin bütün geçmiş görünürlüğü bu satırdan türer (§4.5); satır
 * gidince vekil, vekâlet ettiği dönemin kayıtlarını bir anda kaybeder ve
 * "sonradan soru gelirse cevap verebilmeli" kuralı sessizce çöker. Silme
 * ayrıca veritabanı tetikleyicisiyle de engelli.
 *
 * Yalnızca kendi ekibi için: başkasının ekibindeki işaret bulunamamış
 * sayılır, "senin değil" demek kaydın varlığını ele verirdi.
 */
export async function cancelNoActivityPeriod(
  db: AbsenceDb,
  managerId: string,
  periodId: string,
  reason: string,
  now: Date = new Date(),
): Promise<AbsenceResult> {
  const gerekce = reason.trim();
  if (gerekce.length === 0) return fail("reason_required");

  return db.$transaction(async (tx) => {
    // Satır kilitlenir: iki yönetici aynı kaydı aynı anda iptal ederse
    // ikincisi burada durur ve ikinci bir iptal izi doğmaz.
    await tx.$executeRaw`SELECT "id" FROM "NoActivityPeriod" WHERE "id" = ${periodId} FOR UPDATE`;

    const [actor, kayit] = await Promise.all([
      tx.user.findUnique({
        where: { id: managerId },
        select: {
          fullName: true,
          orgUnitId: true,
          isUnitManager: true,
          isActive: true,
        },
      }),
      tx.noActivityPeriod.findUnique({
        where: { id: periodId },
        select: {
          id: true,
          userId: true,
          deputyId: true,
          status: true,
          user: { select: { orgUnitId: true, isUnitManager: true } },
        },
      }),
    ]);
    if (!kayit) return fail("not_found");

    const izinliKendi = kayit.userId === managerId;
    const izinliDepartmandaCalisan =
      actor?.isUnitManager === true &&
      actor.isActive &&
      kayit.user.orgUnitId === actor.orgUnitId &&
      kayit.user.isUnitManager === false;
    const yoneticiVekaleti =
      kayit.deputyId !== null &&
      actor?.isUnitManager === true &&
      actor.isActive &&
      kayit.user.isUnitManager &&
      (await subordinateManagerIds(tx, managerId)).includes(kayit.userId);

    if (!izinliKendi && !izinliDepartmandaCalisan && !yoneticiVekaleti) {
      return fail("not_found");
    }

    const gecerliKayit = await tx.noActivityPeriod.findFirst({
      // Bekleyen talep de sahibi tarafından geri çekilebilir. `GECERLI_DONEM`
      // yalnız hatırlatma ve skor hesaplarının geçerli kayıtlarını seçer;
      // burada PENDING de işlem yapılabilir durumda olmalıdır.
      where: {
        id: periodId,
        cancelledAt: null,
        status: { in: ["PENDING", "APPROVED"] },
      },
      select: { id: true, userId: true, deputyId: true, status: true },
    });
    if (!gecerliKayit) return fail("not_found");

    await tx.noActivityPeriod.update({
      where: { id: gecerliKayit.id },
      data: {
        cancelledAt: now,
        cancelledById: managerId,
        cancellationReason: gerekce,
      },
    });

    // Vekâlet bir **yetki**dir; verilmesi de geri alınması da iz bırakır
    // (§15.2). Gerekçe metni ize yazılmaz: denetim izi içerik taşımaz.
    await recordAudit(tx, {
      userId: managerId,
      objectType: AUDIT_OBJECTS.user,
      objectId: gecerliKayit.userId,
      action:
        gecerliKayit.status === "PENDING"
          ? AUDIT_ACTIONS.absenceRequestWithdrawn
          : AUDIT_ACTIONS.absenceCancelled,
      detail: {
        periodId: gecerliKayit.id,
        hadDeputy: gecerliKayit.deputyId !== null,
        status: gecerliKayit.status,
      },
      now,
    });

    return {
      ok: true,
      id: gecerliKayit.id,
      status: gecerliKayit.status,
    } satisfies AbsenceResult;
  });
}

export type AbsenceDecision = "APPROVED" | "REJECTED";

/**
 * Bekleyen çalışan talebini karara bağlar.
 *
 * Satır önce kilitlenir, sonra hem durum hem departman tekrar doğrulanır.
 * Böylece aynı departmandaki iki yönetici aynı anda tıklasa bile yalnız ilk
 * karar kaydedilir; başka departmandaki bir kaydın kimliği de açığa çıkmaz.
 */
export async function decideNoActivityPeriod(
  db: AbsenceDb,
  managerId: string,
  periodId: string,
  decision: AbsenceDecision,
  reason = "",
  now: Date = new Date(),
): Promise<AbsenceResult> {
  const gerekce = reason.trim();
  if (decision === "REJECTED" && gerekce.length === 0) {
    return fail("reason_required");
  }

  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT "id" FROM "NoActivityPeriod" WHERE "id" = ${periodId} FOR UPDATE`;

    const [actor, kayit] = await Promise.all([
      tx.user.findUnique({
        where: { id: managerId },
        select: {
          fullName: true,
          orgUnitId: true,
          isUnitManager: true,
          isActive: true,
        },
      }),
      tx.noActivityPeriod.findUnique({
        where: { id: periodId },
        select: {
          id: true,
          userId: true,
          startDate: true,
          endDate: true,
          status: true,
          cancelledAt: true,
          user: {
            select: { fullName: true, orgUnitId: true, isUnitManager: true },
          },
        },
      }),
    ]);

    if (
      !actor?.isUnitManager ||
      !actor.isActive ||
      !kayit ||
      kayit.status !== "PENDING" ||
      kayit.cancelledAt !== null ||
      kayit.user.isUnitManager
    ) {
      return fail("not_found");
    }

    // Doğrudan yönetici, aktif vekil ve geçici üst yönetici yolları aynı
    // çözümden gelir. Böylece vekil ya da üst yönetici, formdaki talep
    // kimliğini değiştirerek başka bir departmana erişemez.
    const route = await absenceDecisionRoute(tx, managerId, kayit.userId, now);
    if (!route) return fail("not_found");

    const yeniStatus: NoActivityPeriodStatus = decision;
    await tx.noActivityPeriod.update({
      where: { id: kayit.id },
      data: {
        status: yeniStatus,
        decidedAt: now,
        decidedById: managerId,
        decisionReason: decision === "REJECTED" ? gerekce : null,
        decisionRoute: route,
      },
    });

    await recordAudit(tx, {
      userId: managerId,
      objectType: AUDIT_OBJECTS.user,
      objectId: kayit.userId,
      action:
        decision === "APPROVED"
          ? AUDIT_ACTIONS.absenceRequestApproved
          : AUDIT_ACTIONS.absenceRequestRejected,
      detail: {
        periodId: kayit.id,
        status: yeniStatus,
        decisionRoute: route,
      },
      now,
    });

    await enqueueNotification(tx, {
      userId: kayit.userId,
      eventType:
        decision === "APPROVED"
          ? NOTIFICATION_EVENTS.absenceRequestApproved
          : NOTIFICATION_EVENTS.absenceRequestRejected,
      payload: {
        personName: kayit.user.fullName,
        range: `${kayit.startDate.toISOString().slice(0, 10)} – ${kayit.endDate
          .toISOString()
          .slice(0, 10)}`,
        approverName: actor.fullName,
        decisionRoute: route,
      },
      idempotencyKey: `absence_decision:${kayit.id}:${decision}`,
      now,
    });

    return { ok: true, id: kayit.id, status: yeniStatus } satisfies AbsenceResult;
  });
}

/** Kişi o gün için "faaliyet beklenmiyor" işareti taşıyor mu? */
export async function isNoActivityDay(
  db: Pick<PrismaClient, "noActivityPeriod">,
  userId: string,
  day: string,
): Promise<boolean> {
  const date = toDateValue(day);
  const kayit = await db.noActivityPeriod.findFirst({
    where: { userId, ...GECERLI_DONEM, startDate: { lte: date }, endDate: { gte: date } },
    select: { id: true },
  });

  return kayit !== null;
}
