import type { OrgUnit, PrismaClient } from "@prisma/client";

import { AUDIT_ACTIONS, AUDIT_OBJECTS, recordAudit } from "@/server/audit/log";
import {
  previewUnitMoveCalendar,
  type UnitMoveCalendarPreview,
} from "@/server/calendar/move-preview";
import { MESAI_PENCERESI_KILIDI } from "@/server/calendar/unit-calendar";
import { hasDatabaseSentinel, isUniqueViolation } from "@/server/db-errors";

import type {
  CreateOrgUnitInput,
  MoveOrgUnitInput,
  UpdateOrgUnitInput,
} from "@/shared/schemas/org";

// Organizasyon ağacı işlemleri (§4). Ağacın bütünlük kuralları veritabanında
// zorunlu kılınmıştır (tek kök, döngü yok, azami derinlik 10, pasif birime
// aktif kullanıcı bağlanamaz); bu katman o kuralları tekrar etmez, yalnızca
// veritabanının reddettiği durumu kullanıcının anlayacağı bir cevaba çevirir.
// Kuralı iki yerde ayrı ayrı yazmak, iki yerin zamanla ayrışması demektir.

export type OrgTreeDb = Pick<
  PrismaClient,
  "orgUnit" | "user" | "auditLog" | "$transaction"
>;

export type OrgTreeErrorCode =
  | "not_found"
  | "inactive_unit"
  | "already_active"
  | "cycle"
  | "max_depth"
  | "duplicate_root"
  | "parent_not_found"
  | "has_active_users"
  | "has_active_children"
  | "inactive_parent"
  | "calendar_change_unconfirmed"
  | "calendar_preview_stale"
  | "unknown";

export interface OrgTreeFailure {
  ok: false;
  error: OrgTreeErrorCode;
  message: string;
  /**
   * Taşıma mesai penceresini değiştiriyorsa iki pencere de dönüyor; ekran
   * uyarıyı bununla çiziyor (tasarım Paket H).
   */
  calendarChange?: UnitMoveCalendarPreview;
}

export type OrgTreeResult<T> = { ok: true; value: T } | OrgTreeFailure;

/** Taşımayı geri alıp önizlemeyi çağırana taşır. */
class CalendarConfirmationNeeded extends Error {
  constructor(
    readonly code: "calendar_change_unconfirmed" | "calendar_preview_stale",
    readonly preview: UnitMoveCalendarPreview,
  ) {
    super(code);
  }
}

const MESSAGES: Record<OrgTreeErrorCode, string> = {
  not_found: "Birim bulunamadı.",
  inactive_unit: "Pasif birim düzenlenemez. Önce aktifleştirilmeli.",
  already_active: "Birim zaten aktif.",
  cycle: "Bir birim kendi altındaki bir birime taşınamaz.",
  max_depth: "Organizasyon ağacı en fazla 10 kademe olabilir.",
  duplicate_root: "Ağaçta yalnızca bir kök birim bulunabilir.",
  parent_not_found: "Üst birim bulunamadı.",
  has_active_users:
    "Bu birimde aktif kullanıcılar var. Önce kullanıcıları taşıyın veya pasifleştirin.",
  has_active_children:
    "Bu birimin altında aktif birimler var. Önce alt birimleri taşıyın veya pasifleştirin.",
  inactive_parent:
    "Üst birim pasif. Önce üst birimi aktifleştirin; pasif bir birimin altında aktif birim olamaz.",
  calendar_change_unconfirmed:
    "Bu taşıma birimin mesai penceresini değiştiriyor. Değişikliği onaylayın.",
  calendar_preview_stale:
    "Mesai penceresi siz onaylamadan önce değişti. Yeni değerleri görüp yeniden onaylayın.",
  unknown: "İşlem tamamlanamadı.",
};

function fail(error: OrgTreeErrorCode): OrgTreeFailure {
  return { ok: false, error, message: MESSAGES[error] };
}

/** Veritabanının reddettiği durumu tanınabilir bir hata koduna çevirir. */
function translateDatabaseError(error: unknown): OrgTreeFailure {
  // Kısıt adları `AD:` biçiminde aranır; çıplak dizge aramak üretim
  // derlemesinde yanlış dalı seçiyordu (bkz. `src/server/db-errors.ts`).
  if (hasDatabaseSentinel(error, "ORG_TREE_CYCLE")) return fail("cycle");
  if (hasDatabaseSentinel(error, "ORG_TREE_MAX_DEPTH")) return fail("max_depth");
  if (hasDatabaseSentinel(error, "ORG_UNIT_HAS_ACTIVE_USERS")) {
    return fail("has_active_users");
  }
  if (hasDatabaseSentinel(error, "ORG_UNIT_HAS_ACTIVE_CHILDREN")) {
    return fail("has_active_children");
  }
  if (hasDatabaseSentinel(error, "ORG_UNIT_INACTIVE_PARENT")) {
    return fail("inactive_parent");
  }
  if (hasDatabaseSentinel(error, "USER_INACTIVE_ORG_UNIT")) {
    return fail("inactive_parent");
  }

  // Kısmi tekil indeks ihlali Prisma tarafından alan adı olmadan da gelebilir;
  // bu tablodaki tek tekillik kuralı zaten kök birimdir.
  if (isUniqueViolation(error)) return fail("duplicate_root");

  return fail("unknown");
}

export async function createOrgUnit(
  db: OrgTreeDb,
  input: CreateOrgUnitInput,
  actorId: string | null = null,
  now: Date = new Date(),
): Promise<OrgTreeResult<OrgUnit>> {
  if (input.parentId) {
    const parent = await db.orgUnit.findUnique({
      where: { id: input.parentId },
      select: { isActive: true },
    });

    if (!parent) return fail("parent_not_found");
    if (!parent.isActive) return fail("inactive_parent");
  }

  try {
    const unit = await db.$transaction(async (tx) => {
      const created = await tx.orgUnit.create({ data: input });

      await recordAudit(tx, {
        userId: actorId,
        objectType: AUDIT_OBJECTS.orgUnit,
        objectId: created.id,
        action: AUDIT_ACTIONS.orgUnitCreated,
        detail: { name: created.name, type: created.type, parentId: created.parentId },
        now,
      });

      return created;
    });

    return { ok: true, value: unit };
  } catch (error) {
    return translateDatabaseError(error);
  }
}

/**
 * Birimin kimliğini ve davranış bayraklarını düzenler (§4.3).
 *
 * **Geçmişe etki etmez.** Bayraklar yalnızca yeni faaliyet yazılırken okunuyor
 * (`src/server/activities/write.ts`, `src/app/activities/new/page.tsx`); daha
 * önce yazılmış kayıtların durumu değişmiyor. Bir birimi sonradan "onaya tabi"
 * yapmak, geçmiş faaliyetleri onaysız duruma düşürmüyor.
 *
 * Yer (`parentId`) ve aktiflik burada değişmez: taşıma ağacın bütünlük
 * kurallarını, pasifleştirme §16.6'yı ilgilendirir ve ikisinin de kendi
 * kontrolleri var. Tek bir "her şeyi güncelle" fonksiyonu o kontrolleri
 * atlamanın en kolay yolu olurdu.
 */
export async function updateOrgUnit(
  db: OrgTreeDb,
  input: UpdateOrgUnitInput,
  actorId: string | null = null,
  now: Date = new Date(),
): Promise<OrgTreeResult<OrgUnit>> {
  const mevcut = await db.orgUnit.findUnique({
    where: { id: input.id },
    select: {
      name: true,
      type: true,
      isActive: true,
      requiresApproval: true,
      autoFlowsUp: true,
      attentionGroupId: true,
    },
  });

  if (!mevcut) return fail("not_found");
  // Pasif birim düzenlenmez: pasifleştirme "bu birim artık kullanılmıyor"
  // demek. Düzenlemeye açık bırakmak, kapatılmış bir kaydı sessizce yeniden
  // canlandırmanın yolu olurdu.
  if (!mevcut.isActive) return fail("inactive_unit");

  const yeni = {
    name: input.name,
    type: input.type,
    requiresApproval: input.requiresApproval,
    autoFlowsUp: input.autoFlowsUp,
    attentionGroupId: input.attentionGroupId,
  };

  // Denetim izine **yalnızca değişen alanlar** yazılır; "hiçbir şeyi
  // değiştirmedim" ile "adı değiştirdim" aynı kayda benzemez.
  type Deger = string | boolean | null;
  const degisenler: Record<string, { onceki: Deger; sonraki: Deger }> = {};

  for (const [alan, deger] of Object.entries(yeni)) {
    const oncekiDeger: Deger = mevcut[alan as keyof typeof yeni];
    if (oncekiDeger !== deger) {
      degisenler[alan] = { onceki: oncekiDeger, sonraki: deger };
    }
  }

  try {
    const unit = await db.$transaction(async (tx) => {
      const guncel = await tx.orgUnit.update({
        where: { id: input.id },
        data: yeni,
      });

      // Değişiklik yoksa denetim izine kayıt düşmez: boş kayıt izi kirletir ve
      // gerçek değişiklikleri aramayı zorlaştırır.
      if (Object.keys(degisenler).length > 0) {
        await recordAudit(tx, {
          userId: actorId,
          objectType: AUDIT_OBJECTS.orgUnit,
          objectId: guncel.id,
          action: AUDIT_ACTIONS.orgUnitUpdated,
          detail: { changed: degisenler },
          now,
        });
      }

      return guncel;
    });

    return { ok: true, value: unit };
  } catch (error) {
    return translateDatabaseError(error);
  }
}

export async function moveOrgUnit(
  db: OrgTreeDb,
  input: MoveOrgUnitInput,
  actorId: string | null = null,
  now: Date = new Date(),
): Promise<OrgTreeResult<OrgUnit>> {
  const parent = await db.orgUnit.findUnique({
    where: { id: input.newParentId },
    select: { isActive: true },
  });

  if (!parent) return fail("parent_not_found");
  if (!parent.isActive) return fail("inactive_parent");

  try {
    const unit = await db.$transaction(async (tx) => {
      // **Takvim etkisi kilit altında, taşımayla aynı işlemde doğrulanıyor**
      // (denetim 23.08.2026, bulgu 14). Ağaç kilidi, önizleme ile
      // taşıma arasında başka bir taşımanın zinciri değiştirmesini engelliyor.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('faaliyet:org_agaci'))`;
      // Takvim yazılarıyla **ortak** kilit: sıra sabit (ağaç → mesai
      // penceresi), dolayısıyla kilitlenme sarmalı oluşmuyor (P4-1).
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${MESAI_PENCERESI_KILIDI}))`;

      const takvimEtkisi = await previewUnitMoveCalendar(
        tx as unknown as OrgTreeDb & Parameters<typeof previewUnitMoveCalendar>[0],
        input.id,
        input.newParentId,
      );

      if (takvimEtkisi.degisiyor) {
        // Pencere değişiyorsa yan etki **görülmeden** onaylanamaz: taşıma o
        // birimdeki herkesin hatırlatma saatini ve skor paydasını kaydırıyor.
        if (!input.confirmedCalendarSignature) {
          throw new CalendarConfirmationNeeded(
            "calendar_change_unconfirmed",
            takvimEtkisi,
          );
        }

        // Onaylanan cümle hâlâ doğru mu: araya giren bir takvim değişikliği
        // kullanıcının okuduğu "X'ten Y'ye" ifadesini yanlış kılardı.
        if (input.confirmedCalendarSignature !== takvimEtkisi.imza) {
          throw new CalendarConfirmationNeeded(
            "calendar_preview_stale",
            takvimEtkisi,
          );
        }
      }

      const oncekiUst = await tx.orgUnit.findUnique({
        where: { id: input.id },
        select: { parentId: true },
      });

      const guncel = await tx.orgUnit.update({
        where: { id: input.id },
        data: { parentId: input.newParentId },
      });

      await recordAudit(tx, {
        userId: actorId,
        objectType: AUDIT_OBJECTS.orgUnit,
        objectId: guncel.id,
        action: AUDIT_ACTIONS.orgUnitMoved,
        detail: {
          fromParentId: oncekiUst?.parentId ?? null,
          toParentId: input.newParentId,
        },
        now,
      });

      return guncel;
    });

    return { ok: true, value: unit };
  } catch (error) {
    if (error instanceof CalendarConfirmationNeeded) {
      return { ...fail(error.code), calendarChange: error.preview };
    }

    return translateDatabaseError(error);
  }
}

/**
 * Birim silinmez, pasifleştirilir (§4.6). Aktif kullanıcı ve aktif alt birim
 * engellerinin ikisi de veritabanında zorunlu kılınmıştır; buradaki ön kontrol
 * yalnızca kullanıcıya anlaşılır mesaj verebilmek içindir — eşzamanlı bir
 * istekle delinse bile veritabanı reddeder (denetim FAZ 2, bulgu 4).
 */
export async function deactivateOrgUnit(
  db: OrgTreeDb,
  id: string,
  actorId: string | null = null,
  now: Date = new Date(),
): Promise<OrgTreeResult<OrgUnit>> {
  const activeChildren = await db.orgUnit.count({
    where: { parentId: id, isActive: true },
  });

  if (activeChildren > 0) return fail("has_active_children");

  try {
    const unit = await db.$transaction(async (tx) => {
      const guncel = await tx.orgUnit.update({
        where: { id },
        data: { isActive: false },
      });

      await recordAudit(tx, {
        userId: actorId,
        objectType: AUDIT_OBJECTS.orgUnit,
        objectId: id,
        action: AUDIT_ACTIONS.orgUnitDeactivated,
        detail: { name: guncel.name },
        now,
      });

      return guncel;
    });

    return { ok: true, value: unit };
  } catch (error) {
    return translateDatabaseError(error);
  }
}

export interface OrgUnitNode extends OrgUnit {
  children: OrgUnitNode[];
  /** Bu birime doğrudan bağlı aktif kullanıcı sayısı. */
  activeUserCount: number;
}

/** Ağacın tamamını kökten başlayarak döndürür (ekranda gösterim için). */
/**
 * Pasifleştirilmiş birimi yeniden açar (ürün sahibi kararı, 19.08.2026).
 *
 * **Alt birimler kendiliğinden açılmaz.** Bir dalı toptan geri getirmek,
 * kapatılırken bilinçli olarak pasifleştirilmiş alt birimleri de sessizce
 * canlandırırdı. Aktifleştirme yukarıdan aşağıya, birim birim yapılır.
 *
 * Üstü pasif olan birim açılamaz; kuralı veritabanı tetikleyicisi
 * (`OrgUnit_active_parent_guard`) zorluyor, bu katman yalnızca anlaşılır bir
 * cevaba çeviriyor.
 */
export async function reactivateOrgUnit(
  db: OrgTreeDb,
  id: string,
  actorId: string | null = null,
  now: Date = new Date(),
): Promise<OrgTreeResult<OrgUnit>> {
  const mevcut = await db.orgUnit.findUnique({
    where: { id },
    select: { isActive: true },
  });

  if (!mevcut) return fail("not_found");
  // Zaten aktif bir birimi "aktifleştirmek" sessizce başarılı sayılmaz:
  // ekranda bir şeyin ters gittiğinin işareti olabilir.
  if (mevcut.isActive) return fail("already_active");

  try {
    const unit = await db.$transaction(async (tx) => {
      const guncel = await tx.orgUnit.update({
        where: { id },
        data: { isActive: true },
      });

      await recordAudit(tx, {
        userId: actorId,
        objectType: AUDIT_OBJECTS.orgUnit,
        objectId: id,
        action: AUDIT_ACTIONS.orgUnitReactivated,
        detail: { name: guncel.name },
        now,
      });

      return guncel;
    });

    return { ok: true, value: unit };
  } catch (error) {
    return translateDatabaseError(error);
  }
}

export async function loadOrgTree(db: OrgTreeDb): Promise<OrgUnitNode[]> {
  const [units, userCounts] = await Promise.all([
    db.orgUnit.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    db.user.groupBy({
      by: ["orgUnitId"],
      where: { isActive: true },
      _count: { _all: true },
    }),
  ]);

  const countByUnit = new Map(
    userCounts.map((row) => [row.orgUnitId, row._count._all]),
  );

  const nodes = new Map<string, OrgUnitNode>(
    units.map((unit) => [
      unit.id,
      { ...unit, children: [], activeUserCount: countByUnit.get(unit.id) ?? 0 },
    ]),
  );

  const roots: OrgUnitNode[] = [];

  for (const node of nodes.values()) {
    if (node.parentId === null) {
      roots.push(node);
      continue;
    }

    nodes.get(node.parentId)?.children.push(node);
  }

  return roots;
}
