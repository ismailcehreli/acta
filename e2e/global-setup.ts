import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";

import { PrismaClient } from "@prisma/client";

import { hashPassword } from "../src/server/auth/password";
import { assertTestDatabaseUrl } from "../tests/helpers/assert-test-database";
import { prepareTestDatabase } from "../tests/helpers/prepare-test-database";
import {
  assertSentinelPresent,
  isRequiredSchemaPresent,
} from "../tests/helpers/test-db";

// Uçtan uca testler gerçek sunucuya karşı koşar ve giriş yapabilen bir kullanıcı
// gerektirir. Bu kurulum **yalnızca** E2E_DATABASE_URL'e yazar ve o adresin
// izinli bir test veritabanı olduğunu önce kanıtlar.
//
// Denetim (17.08.2026, bulgu 1): önceki hâli uygulamanın DATABASE_URL
// değerine, depoda açıkça yazılı sabit bir parolayla kalıcı hesap açıyordu.
// Artık parola her koşuda rastgele üretilir ve koşu sonunda hesap kapatılır.

export const E2E_USER = {
  fullName: "Deneme Müdürü",
  title: "Kalıphane Müdürü",
  email: "e2e@ornek.test",
};

/** Yönetim ekranları için ayrı hesap: yetki ayrımı gerçek kullanıcıyla sınanır. */
export const E2E_ADMIN = {
  fullName: "Sistem Yöneticisi",
  title: "Bilgi İşlem Uzmanı",
  email: "e2e-admin@ornek.test",
};

// Üç kademeli örnek şirket (§13): kapsam görünümünün kademeye göre genişlediği
// gerçek kullanıcılarla sınanabilsin diye.
//
//   Şirket ────────────── YK Başkanı  → "Tüm şirket"
//     └─ Genel Müdürlük ── Genel Müdür → "Departmanlarım"
//          ├─ Kalıphane ── Deneme Müdürü + Kalıphane Çalışanı → "Departmanım"
//          └─ Planlama  ── Planlama Müdürü
export const E2E_CHAIRMAN = {
  fullName: "YK Başkanı",
  title: "Yönetim Kurulu Başkanı",
  email: "e2e-baskan@ornek.test",
};

export const E2E_GM = {
  fullName: "Genel Müdür",
  title: "Genel Müdür",
  email: "e2e-gm@ornek.test",
};

export const E2E_WORKER = {
  fullName: "Kalıphane Çalışanı",
  title: "Kalıp Operatörü",
  email: "e2e-calisan@ornek.test",
};

export const E2E_PLANNER = {
  fullName: "Planlama Müdürü",
  title: "Üretim Planlama Müdürü",
  email: "e2e-planlama@ornek.test",
};

// Boyahane, **kalıcı olarak onaya tabi** bir birimdir ve onay bayrağını
// hiçbir test değiştirmez (21.08.2026).
//
// Sebep: Kalıphane'nin bayrağını sekiz ayrı spec açıp kapıyordu ve dosyalar
// paralel koştuğu için biri diğerinin altını oyuyordu. Vekâlet senaryosu
// bayrağı açıyor, aynı anda koşan başka bir spec kapatıyor, kayıt onaysız
// doğuyor ve vekilin kuyruğu boş kalıyordu. Hata testin çok ilerisinde,
// yanlış yerde patlıyordu.
//
// Paylaşılan değiştirilebilir durum, paralel testlerde en sinsi hata
// kaynağıdır: her spec tek başına yeşil, paket kırmızı.
export const E2E_DYE_MANAGER = {
  fullName: "Boyahane Müdürü",
  title: "Boyahane Müdürü",
  email: "e2e-boya-mudur@ornek.test",
};

export const E2E_DYER = {
  fullName: "Boyahane Çalışanı",
  title: "Boya Operatörü",
  email: "e2e-boyaci@ornek.test",
};

/** Kurulumun ürettiği parola; testler buradan okur. */
export function e2ePassword(): string {
  const password = process.env.E2E_PASSWORD;

  if (!password) {
    throw new Error(
      "E2E_PASSWORD yok — uçtan uca kurulum çalışmamış olabilir.",
    );
  }

  return password;
}

export function e2eDatabaseUrl(): string {
  return assertTestDatabaseUrl(process.env.E2E_DATABASE_URL, {
    variableName: "E2E_DATABASE_URL",
    applicationUrl: process.env.DATABASE_URL,
  });
}

export default async function globalSetup(): Promise<void> {
  // Sıra Vitest ile ortak modülden gelir: adres, işaret, migration. İkisinin
  // ayrı ayrı yazılması, birinin geride kalması demekti (denetim
  // 18.08.2026, FAZ 4 bulgu 12).
  await prepareTestDatabase({
    resolveUrl: e2eDatabaseUrl,
    assertSentinel: assertSentinelPresent,
    runMigrations: (target) => {
      execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
        env: { ...process.env, DATABASE_URL: target },
        stdio: "inherit",
      });
    },
    isSchemaReady: isRequiredSchemaPresent,
    resetDatabase: (target) => {
      execFileSync("pnpm", ["exec", "prisma", "migrate", "reset", "--force"], {
        env: { ...process.env, DATABASE_URL: target },
        stdio: "inherit",
      });
    },
  });

  const url = e2eDatabaseUrl();

  const password = randomBytes(18).toString("base64url");
  process.env.E2E_PASSWORD = password;

  const prisma = new PrismaClient({ datasources: { db: { url } } });

  try {
    // Her koşu temiz başlar: birikmiş birimler seçicileri kırılgan yapıyor ve
    // testlerin birbirini etkilemesine yol açıyordu.
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
    `;
    if (tables.length > 0) {
      const quoted = tables.map((t) => `"public"."${t.tablename}"`).join(", ");
      await prisma.$executeRawUnsafe(
        `TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE`,
      );
    }

    const root = await prisma.orgUnit.create({
      data: { name: "Şirket", type: "Kök" },
    });
    const generalManagement = await prisma.orgUnit.create({
      data: { name: "Genel Müdürlük", type: "Genel Müdürlük", parentId: root.id },
    });
    const moldShop = await prisma.orgUnit.create({
      data: { name: "Kalıphane", type: "Departman", parentId: generalManagement.id },
    });
    const planning = await prisma.orgUnit.create({
      data: { name: "Planlama", type: "Departman", parentId: generalManagement.id },
    });
    // Kalıcı olarak onaya tabi; bayrağı hiçbir test değiştirmez.
    const dyeHouse = await prisma.orgUnit.create({
      data: {
        name: "Boyahane",
        type: "Departman",
        parentId: generalManagement.id,
        requiresApproval: true,
      },
    });

    // Onay kararı gerekçe kataloğu. Geçiş dosyası bunu tohumluyor ama kurulum
    // tabloları boşaltıyor; karar ekranı gerekçesiz çalışamaz.
    await prisma.approvalReason.createMany({
      data: [
        { kind: "CHANGES_REQUESTED", label: "Eksik bilgi", sortOrder: 10 },
        { kind: "CHANGES_REQUESTED", label: "Diğer", sortOrder: 90 },
        { kind: "REJECTED", label: "Faaliyet niteliği taşımıyor", sortOrder: 10 },
        { kind: "REJECTED", label: "Mükerrer kayıt", sortOrder: 20 },
        { kind: "REJECTED", label: "Diğer", sortOrder: 90 },
      ],
    });

    const passwordHash = await hashPassword(password);

    for (const account of [
      {
        ...E2E_CHAIRMAN,
        unitId: root.id,
        isUnitManager: true,
        isSystemAdmin: false,
        canViewReports: true,
        canViewScoreReports: true,
      },
      {
        ...E2E_ADMIN,
        unitId: root.id,
        isUnitManager: false,
        isSystemAdmin: true,
        canViewReports: false,
        canViewScoreReports: false,
      },
      {
        ...E2E_GM,
        unitId: generalManagement.id,
        isUnitManager: true,
        isSystemAdmin: false,
        canViewReports: true,
        canViewScoreReports: false,
      },
      {
        ...E2E_USER,
        unitId: moldShop.id,
        isUnitManager: true,
        isSystemAdmin: false,
        canViewReports: false,
        canViewScoreReports: false,
      },
      {
        ...E2E_WORKER,
        unitId: moldShop.id,
        isUnitManager: false,
        isSystemAdmin: false,
        canViewReports: false,
        canViewScoreReports: false,
      },
      {
        ...E2E_PLANNER,
        unitId: planning.id,
        isUnitManager: true,
        isSystemAdmin: false,
        canViewReports: false,
        canViewScoreReports: false,
      },
      {
        ...E2E_DYE_MANAGER,
        unitId: dyeHouse.id,
        isUnitManager: true,
        isSystemAdmin: false,
        canViewReports: false,
        canViewScoreReports: false,
      },
      {
        ...E2E_DYER,
        unitId: dyeHouse.id,
        isUnitManager: false,
        isSystemAdmin: false,
        canViewReports: false,
        canViewScoreReports: false,
      },
    ]) {
      const user = await prisma.user.upsert({
        where: { email: account.email },
        update: {
          isActive: true,
          isSystemAdmin: account.isSystemAdmin,
          canViewReports: account.canViewReports,
          canViewScoreReports: account.canViewScoreReports,
          title: account.title,
        },
        create: {
          fullName: account.fullName,
          // Unvan listede ve faaliyet detayında gösteriliyor (Görev 11.1);
          // test verisi de gerçek ekranı yansıtmalı.
          title: account.title,
          email: account.email,
          orgUnitId: account.unitId,
          isUnitManager: account.isUnitManager,
          isSystemAdmin: account.isSystemAdmin,
          canViewReports: account.canViewReports,
          canViewScoreReports: account.canViewScoreReports,
        },
      });

      await prisma.userCredential.upsert({
        where: { userId: user.id },
        update: { passwordHash, failedLoginCount: 0, lockedUntil: null },
        create: { userId: user.id, passwordHash },
      });

      // Önceki koşulardan kalan oturumlar kapatılır.
      await prisma.session.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
  } finally {
    await prisma.$disconnect();
  }
}
