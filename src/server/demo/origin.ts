import type { PrismaClient } from "@prisma/client";

import { AUDIT_ACTIONS, AUDIT_OBJECTS, recordAudit } from "@/server/audit/log";
import type { DemoObjectOriginInput } from "@/shared/schemas/demo";

export const DEMO_OBJECT_ORG_UNIT = "org_unit";
export const DEMO_EMAIL_DOMAIN = "ornek.test";
export const DEMO_ORIGIN_CREATED = "CREATED_BY_INSTALLER" as const;
export const DEMO_ORIGIN_REUSED = "REUSED_EXISTING" as const;

export interface LegacyDemoOriginCandidate {
  id: string;
  name: string;
  parentName: string | null;
}

type OriginReadDb = Pick<PrismaClient, "user" | "orgUnit" | "demoObject">;

/**
 * Örnek kullanıcı taşıyan fakat köken kararı olmayan birimler.
 *
 * Ad bir kanıt değildir. Aday kümesi yalnız mevcut ilişkiye bakar; kararın
 * kendisini sistem yöneticisi verir (denetim 24.08.2026, P3-R6-2).
 */
export async function listLegacyDemoOriginCandidates(
  db: OriginReadDb,
): Promise<LegacyDemoOriginCandidate[]> {
  const birimler = await db.orgUnit.findMany({
    where: {
      users: { some: { email: { endsWith: `@${DEMO_EMAIL_DOMAIN}` } } },
    },
    select: {
      id: true,
      name: true,
      parent: { select: { name: true } },
    },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });

  if (birimler.length === 0) return [];

  const kayitli = await db.demoObject.findMany({
    where: {
      objectType: DEMO_OBJECT_ORG_UNIT,
      objectId: { in: birimler.map((birim) => birim.id) },
    },
    select: { objectId: true },
  });
  const kayitliIds = new Set(kayitli.map((kayit) => kayit.objectId));

  return birimler
    .filter((birim) => !kayitliIds.has(birim.id))
    .map((birim) => ({
      id: birim.id,
      name: birim.name,
      parentName: birim.parent?.name ?? null,
    }));
}

export type ClassifyLegacyDemoOriginsResult =
  | { ok: true; classified: number }
  | { ok: false; error: "candidate_set_changed" | "invalid_origin" };

export async function classifyLegacyDemoOrgUnits(
  db: PrismaClient,
  actorId: string,
  selections: Array<{ orgUnitId: string; origin: DemoObjectOriginInput }>,
  now: Date = new Date(),
): Promise<ClassifyLegacyDemoOriginsResult> {
  const allowedOrigins = new Set<DemoObjectOriginInput>([
    DEMO_ORIGIN_CREATED,
    DEMO_ORIGIN_REUSED,
  ]);
  if (selections.some((selection) => !allowedOrigins.has(selection.origin))) {
    return { ok: false, error: "invalid_origin" };
  }

  const submittedIds = selections.map((selection) => selection.orgUnitId);
  if (new Set(submittedIds).size !== submittedIds.length) {
    return { ok: false, error: "candidate_set_changed" };
  }

  return db.$transaction(async (tx) => {
    // Sınıflandırma ile temizlik birbirini geçemez. Void döndüren advisory
    // lock `$queryRaw` ile çözümlenemez; `$executeRaw` kullanılmalı.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('faaliyet:demo_verisi'))`;

    const adaylar = await listLegacyDemoOriginCandidates(tx as OriginReadDb);
    const expectedIds = adaylar.map((aday) => aday.id).sort();
    const actualIds = [...submittedIds].sort();
    if (
      expectedIds.length !== actualIds.length ||
      expectedIds.some((id, index) => id !== actualIds[index])
    ) {
      return { ok: false as const, error: "candidate_set_changed" as const };
    }

    await tx.demoObject.createMany({
      data: selections.map((selection) => ({
        objectType: DEMO_OBJECT_ORG_UNIT,
        objectId: selection.orgUnitId,
        origin: selection.origin,
      })),
    });

    await recordAudit(tx, {
      userId: actorId,
      objectType: AUDIT_OBJECTS.setting,
      objectId: "demo_data_origin",
      action: AUDIT_ACTIONS.demoOriginClassified,
      detail: {
        createdByInstaller: selections
          .filter((selection) => selection.origin === DEMO_ORIGIN_CREATED)
          .map((selection) => selection.orgUnitId),
        reusedExisting: selections
          .filter((selection) => selection.origin === DEMO_ORIGIN_REUSED)
          .map((selection) => selection.orgUnitId),
      },
      now,
    });

    return { ok: true as const, classified: selections.length };
  });
}

/** İdempotent kurulumda kanıtlı köken kararını değiştirmeden kaydeder. */
export async function rememberDemoOrgUnitOrigin(
  db: Pick<PrismaClient, "demoObject">,
  objectId: string,
  origin: DemoObjectOriginInput,
): Promise<void> {
  await db.demoObject.upsert({
    where: {
      objectType_objectId: { objectType: DEMO_OBJECT_ORG_UNIT, objectId },
    },
    create: { objectType: DEMO_OBJECT_ORG_UNIT, objectId, origin },
    // İkinci kurulumda birim artık “mevcut” görünür. Önceki kesin kararı
    // REUSED_EXISTING ile ezmek, kurulumun oluşturduğu birimi ölümsüz yapardı.
    update: {},
  });
}
