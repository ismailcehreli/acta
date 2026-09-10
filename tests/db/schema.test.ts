import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createActivity, createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

/** Sürüm 1 kapsamındaki tablolar (§16, plan Görev 0.2a). */
const VERSION_1_TABLES = [
  "Activity",
  // Takdir ve dönemsel skor (Görev 11.10, 11.11).
  "ActivityAppreciation",
  // Kaydın uygun onaylayıcıları; bir birimde birden fazla müdür olabilir
  // (ürün sahibi kararı, 20.08.2026).
  "ActivityApprover",
  // Root'un silme talebi ve onay kodu (ürün sahibi kararı, 03.09.2026).
  // Kayıt silindikten sonra da durur: silmenin kanıtıdır.
  "ActivityDeletionRequest",
  // Gönderilmemiş faaliyet taslakları (ürün sahibi isteği, 21.08.2026).
  "ActivityDraft",
  // Taslağın gönderilene veya açıkça silinene kadar korunan dosya ekleri.
  "ActivityDraftAttachment",
  "ActivityRevision",
  "ActivityTargetDept",
  // Onay kararı gerekçe kataloğu (19.08.2026 kararı).
  "ApprovalReason",
  // Onay turunun değişmez kaydı: gönderim anı karar verilirken kaybolmasın
  // (denetim 23.08.2026, P3-R2-1).
  "ApprovalRound",
  "Attachment",
  "AuditLog",
  "BackupRequest",
  "CancellationRecord",
  "Conversation",
  "ConversationMessage",
  // Örnek verinin köken kaydı: hangi nesneleri kurulum **gerçekten**
  // oluşturdu (denetim 23.08.2026, P3-R5-2).
  "DemoObject",
  "Feedback",
  // Takip maddeleri Sürüm 1'e alındı (ürün sahibi kararı, 19.08.2026).
  "FollowUpItem",
  "FollowUpItemEvent",
  "HelpArticle",
  "Holiday",
  "NoActivityPeriod",
  "NotificationQueue",
  "OrgUnit",
  // Birime özel mesai penceresi (Görev 11.9).
  "OrgUnitWorkCalendar",
  // Tarayıcı push abonelikleri (Görev 5.3b).
  "PushSubscription",
  "ReadReceipt",
  "ScheduledJobStatus",
  // Kapanmış skor sürümleri, yeniden hesaplama kuyruğu ve etkili-tarih
  // görüntüsü (denetim 25.08.2026, P8-R3-1..4).
  "ScoreCompanyCalendarEvent",
  "ScoreHistoryControl",
  "ScoreHolidayEvent",
  "ScoreOrgUnitStateEvent",
  "ScorePeriodLedger",
  "ScoreRecalculationRequest",
  "ScoreSettingEvent",
  "ScoreUnitCalendarEvent",
  "ScoreUserStateEvent",
  "Session",
  "SystemResetRequest",
  "SystemSetting",
  "User",
  "UserCredential",
  "UserScorePeriod",
  // Kapanmış dönemin katkı gerçekleri (denetim 23.08.2026, P3-R2-4).
  "UserScorePeriodFact",
  "WorkCalendar",
];

/** Sürüm 2'ye ait; bu sürümde açılmaz (§18.2, plan çalışma kuralı 7). */
const VERSION_2_TABLES = [
  "ApprovalTask",
  "ApprovalAction",
  "Escalation",
  "Delegation",
];

async function tableNames(): Promise<string[]> {
  const rows = await testDb.$queryRaw<{ tablename: string }[]>`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename <> '_prisma_migrations'
    ORDER BY tablename
  `;
  return rows.map((r) => r.tablename);
}

describe("şema kurulumu", () => {
  it("Sürüm 1 tablolarının tamamı kurulmuş", async () => {
    expect(await tableNames()).toEqual(VERSION_1_TABLES);
  });

  it("Sürüm 2 tabloları açılmamış", async () => {
    const names = await tableNames();
    for (const table of VERSION_2_TABLES) {
      expect(names).not.toContain(table);
    }
  });
});

// Denetim (17.08.2026, bulgu 12): kapsam testi yalnız tablo adına
// bakıyordu, dolayısıyla Sürüm 1 tablosuna eklenen bir Sürüm 2 kolonunu
// yakalayamazdı. Aşağıdaki test kolon düzeyinde bakar.
describe("kapsam disiplini — kolon düzeyi", () => {
  /**
   * Sürüm 2 kavramlarını çağrıştıran kolonlar. Tek bilinçli istisna
   * `NoActivityPeriod.deputyId`: tasarım §16.5 bu alanı Sürüm 1 tablosunun
   * içinde tanımlıyor, davranışı Sürüm 2'de bağlanacak (§4.5).
   */
  //
  // `followUp` deseni listeden **çıkarıldı** (19.08.2026): takip maddeleri
  // ürün sahibi kararıyla Sürüm 1'e alındı ve artık bu kapsamda değil.
  const ALLOWED_VERSION_2_COLUMNS = new Set(["NoActivityPeriod.deputyId"]);

  it("Sürüm 2 kavramına ait beklenmedik kolon yok", async () => {
    const rows = await testDb.$queryRaw<
      { table_name: string; column_name: string }[]
    >`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND (
          column_name ILIKE '%deputy%' OR
          column_name ILIKE '%delegation%' OR
          column_name ILIKE '%approvalTask%' OR
          column_name ILIKE '%escalation%'
        )
      ORDER BY table_name, column_name
    `;

    const unexpected = rows
      .map((r) => `${r.table_name}.${r.column_name}`)
      .filter((name) => !ALLOWED_VERSION_2_COLUMNS.has(name));

    expect(unexpected).toEqual([]);
  });
});

describe("tekillik kısıtları", () => {
  it("aynı e-posta ikinci kez kaydedilemez", async () => {
    const unit = await createOrgUnit();
    await createUser(unit.id, { email: "ayni@ornek.test" });

    await expect(
      createUser(unit.id, { email: "ayni@ornek.test" }),
    ).rejects.toThrow(/Unique constraint/i);
  });

  it("aynı muhatap departman aynı faaliyete iki kez eklenemez", async () => {
    const unit = await createOrgUnit();
    const user = await createUser(unit.id);
    const activity = await createActivity(user);
    // Ağaçta tek kök bulunabilir (§4.2); muhatap birim köke bağlanır.
    const target = await createOrgUnit({ parentId: unit.id });

    await testDb.activityTargetDept.create({
      data: { activityId: activity.id, orgUnitId: target.id },
    });

    await expect(
      testDb.activityTargetDept.create({
        data: { activityId: activity.id, orgUnitId: target.id },
      }),
    ).rejects.toThrow(/Unique constraint/i);
  });

  it("aynı faaliyet için aynı revizyon numarası iki kez yazılamaz", async () => {
    const unit = await createOrgUnit();
    const user = await createUser(unit.id);
    const activity = await createActivity(user);

    const revision = {
      activityId: activity.id,
      revisionNo: 1,
      title: activity.title,
      description: activity.description,
      targetOrgUnitIds: [],
      changedById: user.id,
    };

    await testDb.activityRevision.create({ data: revision });

    await expect(
      testDb.activityRevision.create({ data: revision }),
    ).rejects.toThrow(/Unique constraint/i);
  });

  it("okundu kaydı kullanıcı başına tek satırdır", async () => {
    const unit = await createOrgUnit();
    const author = await createUser(unit.id);
    const reader = await createUser(unit.id);
    const activity = await createActivity(author);

    await testDb.readReceipt.create({
      data: { activityId: activity.id, userId: reader.id },
    });

    await expect(
      testDb.readReceipt.create({
        data: { activityId: activity.id, userId: reader.id },
      }),
    ).rejects.toThrow(/Unique constraint/i);
  });
});

// §16.6: fiziksel silme yoktur. Bu kural iki katmanla korunur: her satır için
// çalışan silme engeli (bkz. constraints/no-physical-delete.test.ts) ve
// yabancı anahtarlardaki RESTRICT. Aşağıdaki testler ikinci katmanın şemada
// gerçekten kurulu olduğunu doğrular — davranış testi silme engeline takıldığı
// için tek başına bunu gösteremez.
describe("yabancı anahtar kuralları", () => {
  it("silmeyi engelleyen kurallar RESTRICT olarak tanımlı", async () => {
    const rules = await testDb.$queryRaw<
      { constraint_name: string; delete_rule: string }[]
    >`
      SELECT rc.constraint_name, rc.delete_rule
      FROM information_schema.referential_constraints rc
      WHERE rc.constraint_schema = 'public'
      ORDER BY rc.constraint_name
    `;

    expect(rules.length).toBeGreaterThan(0);
    const cascading = rules.filter((r) => r.delete_rule !== "RESTRICT");
    expect(cascading).toEqual([]);
  });

  it("kullanıcı silinmeye çalışılırsa veritabanı reddeder", async () => {
    const unit = await createOrgUnit();
    const user = await createUser(unit.id);
    await createActivity(user);

    await expect(testDb.user.delete({ where: { id: user.id } })).rejects.toThrow(
      /PHYSICAL_DELETE_FORBIDDEN/,
    );
  });
});

describe("tarih ve saat davranışı", () => {
  it("faaliyet tarihi gün olarak saklanır, zaman dilimiyle kaymaz", async () => {
    const unit = await createOrgUnit();
    const user = await createUser(unit.id);

    const activity = await createActivity(user, {
      activityDate: new Date("2026-08-17T00:00:00.000Z"),
    });

    const stored = await testDb.activity.findUniqueOrThrow({
      where: { id: activity.id },
    });

    // Europe/Istanbul (UTC+3) altında bile gün 17 Ağustos kalmalı.
    expect(stored.activityDate.toISOString()).toBe("2026-08-17T00:00:00.000Z");
  });

  it("oluşturulma zamanı zaman dilimi bilgisiyle saklanır", async () => {
    const unit = await createOrgUnit();

    const [column] = await testDb.$queryRaw<{ data_type: string }[]>`
      SELECT data_type
      FROM information_schema.columns
      WHERE table_name = 'OrgUnit' AND column_name = 'createdAt'
    `;

    expect(column.data_type).toBe("timestamp with time zone");
    expect(unit.createdAt).toBeInstanceOf(Date);
  });
});

// Denetim (17.08.2026, bulgu 11): tekil indeks harfe duyarlıydı, oysa
// uygulama e-postayı küçük harfe çeviriyor — aynı kişi iki kimliğe bölünebilirdi.
describe("e-posta tekilliği", () => {
  it("aynı adres büyük harfle ikinci kez kaydedilemez", async () => {
    const unit = await createOrgUnit();
    await createUser(unit.id, { email: "mudur@ornek.test" });

    await expect(
      createUser(unit.id, { email: "Mudur@Ornek.Test" }),
    ).rejects.toThrow(/Unique constraint|23505/i);
  });
});
