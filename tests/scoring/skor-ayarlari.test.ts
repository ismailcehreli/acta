import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { readUserScore } from "@/server/scoring/read";
import { readScoreWeights } from "@/server/scoring/weights";
import { SETTING_KEYS, saveSettings } from "@/server/settings/system-settings";

import {
  createActivity,
  createApprovalReason,
  createOrgUnit,
  createUser,
} from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Skor ağırlıkları **ayardır** (denetim 23.08.2026, bulgu 8).
//
// Tasarım (satır 672-686) dört ağırlığın tamamını `SystemSetting` olarak,
// yönetim panelinden değiştirilebilir ve **her üç profilde toplamı 100 olacak
// şekilde çapraz doğrulamalı** tanımlıyor. Ağırlıklar koda gömülüydü: formülü
// değiştirmek için dağıtım gerekiyordu ve panelde beklenen doğrulama yoktu.
//
// Buradaki testler ayarın **üretim davranışını** değiştirdiğini ölçüyor;
// sabit nesnedeki sayıların toplamını kontrol etmek bunu ölçmezdi.

const NOW = new Date("2026-08-20T09:00:00.000Z");

beforeEach(async () => {
  await resetDatabase();
  await saveSettings(testDb, { [SETTING_KEYS.scoringEnabled]: "true" });
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function sirket() {
  const kok = await createOrgUnit({ name: "Şirket", type: "Kök" });
  const birim = await createOrgUnit({
    name: "Kalıphane",
    parentId: kok.id,
    requiresApproval: true,
  });

  const mudur = await createUser(birim.id, {
    fullName: "Kalıphane Müdürü",
    isUnitManager: true,
  });
  const kadir = await createUser(birim.id, { fullName: "Kadir Usta" });

  // Ağustos'un iki iş gününde kayıt: biri onaylı, biri reddedilmiş.
  // Düzenlilik oranı ile kabul oranı **farklı** olsun ki ağırlığı
  // değiştirmek toplamı gerçekten oynatsın.
  await createActivity(kadir, {
    activityDate: new Date("2026-08-03T00:00:00.000Z"),
    approvalStatus: "APPROVED",
    approverId: mudur.id,
  });
  const gerekce = await createApprovalReason("REJECTED");
  await createActivity(kadir, {
    activityDate: new Date("2026-08-04T00:00:00.000Z"),
    approvalStatus: "REJECTED",
    approverId: mudur.id,
    approvalSubmittedAt: new Date("2026-08-04T08:00:00.000Z"),
    approvalDecidedAt: new Date("2026-08-04T09:00:00.000Z"),
    approvalReasonId: gerekce.id,
    approvalReasonKind: "REJECTED",
  });

  return { kadir, mudur };
}

describe("skor ağırlıkları ayardan geliyor", () => {
  it("varsayılanlar tasarımdaki sayılar", async () => {
    const agirliklar = await readScoreWeights(testDb);

    expect(agirliklar).toEqual({
      regularity: 60,
      acceptance: 30,
      approval: 30,
      followUp: 10,
    });
  });

  it("ağırlık ayarı değişince skor değişir", async () => {
    const { kadir } = await sirket();
    const bakan = { id: kadir.id, isSystemAdmin: false };

    const once = await readUserScore(testDb, bakan, kadir.id, NOW);

    // Düzenlilik ile kabul oranının ağırlıkları yer değiştiriyor; toplam
    // yine 100.
    const sonuc = await saveSettings(testDb, {
      [SETTING_KEYS.scoringWeightRegularity]: "30",
      [SETTING_KEYS.scoringWeightAcceptance]: "60",
      [SETTING_KEYS.scoringWeightApproval]: "60",
    });
    expect(sonuc.ok).toBe(true);

    const sonra = await readUserScore(testDb, bakan, kadir.id, NOW);

    expect(once?.total).not.toBe(sonra?.total);
    // Kabul oranı (1/2) düzenlilikten (2/beklenen gün) daha iyi olduğu için
    // ağırlık ona kayınca toplam **yükselmeli**.
    expect(sonra?.total ?? 0).toBeGreaterThan(once?.total ?? 0);
  });

  it("çalışan profilinde toplam 100 etmeyen bileşim reddedilir", async () => {
    const sonuc = await saveSettings(testDb, {
      [SETTING_KEYS.scoringWeightRegularity]: "70",
    });

    expect(sonuc.ok).toBe(false);
    if (!sonuc.ok) expect(sonuc.message).toContain("100");
  });

  it("yönetici profilinde toplam 100 etmeyen bileşim reddedilir", async () => {
    // Çalışan profili tutuyor (60 + 30 + 10), yönetici profili tutmuyor
    // (60 + 40 + 10 = 110).
    const sonuc = await saveSettings(testDb, {
      [SETTING_KEYS.scoringWeightApproval]: "40",
    });

    expect(sonuc.ok).toBe(false);
    if (!sonuc.ok) expect(sonuc.message).toContain("Yönetici");
  });

  it("toplamı koruyan bileşim kabul edilir", async () => {
    const sonuc = await saveSettings(testDb, {
      [SETTING_KEYS.scoringWeightRegularity]: "50",
      [SETTING_KEYS.scoringWeightAcceptance]: "40",
      [SETTING_KEYS.scoringWeightApproval]: "40",
      [SETTING_KEYS.scoringWeightFollowUp]: "10",
    });

    expect(sonuc.ok).toBe(true);
    expect(await readScoreWeights(testDb)).toEqual({
      regularity: 50,
      acceptance: 40,
      approval: 40,
      followUp: 10,
    });
  });

  it("geçersiz bileşim reddedildiğinde hiçbir ayar yazılmaz", async () => {
    // "Hepsi ya da hiçbiri": yarısı yeni yarısı eski bir formül, hiçbir
    // profilde 100 etmeyen bir skor üretirdi.
    await saveSettings(testDb, {
      [SETTING_KEYS.scoringWeightRegularity]: "50",
      [SETTING_KEYS.scoringWeightAcceptance]: "20",
    });

    expect(await readScoreWeights(testDb)).toEqual({
      regularity: 60,
      acceptance: 30,
      approval: 30,
      followUp: 10,
    });
  });
});

// Çapraz doğrulama **kaydetme sınırında** durmalı (denetim
// 23.08.2026, P3-4).
//
// Okuma, doğrulama ve `değişen` hesabı işlemin dışındaydı; işlem yalnız
// doğrulanmış değerleri yazıyordu. İki istek aynı eski görüntüyü okuyup ayrı
// ayrı geçerli **kısmi** bileşimleri doğrulayabiliyor, sonra birbirinin
// anahtarlarını ezerek 100 etmeyen bir formül bırakabiliyordu. Kodun
// "her profilde toplam 100" değişmezi gerçekte zorlanmıyordu.

/**
 * Ayarları işlem içinde okuduktan **sonra** duran bir istemci.
 *
 * Araya girmenin çağrıdan önce yapıldığı bir test, doğrulama ile yazma
 * arasındaki pencereyi hiç açmazdı; eski kod geri konsa yine geçerdi.
 */
function bariyerliDb(hazirEt: () => void, bekle: Promise<void>) {
  let ilkOkuma = true;

  /** `systemSetting.findMany` çağrısından sonra bir kez duraklatır. */
  const ayarProxy = (asil: unknown) =>
    new Proxy(asil as object, {
      get(hedef, alan) {
        if (alan !== "findMany") return Reflect.get(hedef, alan);

        const findMany = Reflect.get(hedef, alan) as (
          ...args: unknown[]
        ) => Promise<unknown>;

        return async (...args: unknown[]) => {
          const sonuc = await findMany.apply(hedef, args);
          if (ilkOkuma) {
            ilkOkuma = false;
            hazirEt();
            await bekle;
          }
          return sonuc;
        };
      },
    });

  const istemciProxy = (hedefIstemci: object): object =>
    new Proxy(hedefIstemci, {
      get(hedef, alan) {
        if (alan === "systemSetting") {
          return ayarProxy(Reflect.get(hedef, alan));
        }

        if (alan === "$transaction") {
          const asil = Reflect.get(hedef, alan) as (
            fn: (tx: unknown) => Promise<unknown>,
          ) => Promise<unknown>;

          return (fn: (tx: unknown) => Promise<unknown>) =>
            asil.call(hedef, (tx: unknown) => fn(istemciProxy(tx as object)));
        }

        const deger = Reflect.get(hedef, alan);
        return typeof deger === "function" ? deger.bind(hedef) : deger;
      },
    });

  return istemciProxy(testDb) as unknown as typeof testDb;
}

describe("eşzamanlı kaydetme toplamı bozamaz", () => {
  it("iki kısmi kaydetme yarışsa da her profilde toplam 100 kalır", async () => {
    let hazirEt = () => {};
    let birak = () => {};
    const hazir = new Promise<void>((c) => (hazirEt = c));
    const bekle = new Promise<void>((c) => (birak = c));

    // A: düzenlilik 40, kabul 50, onay 50 — eski görüntüde geçerli (40+50+10).
    const aSozu = saveSettings(bariyerliDb(() => hazirEt(), bekle), {
      [SETTING_KEYS.scoringWeightRegularity]: "40",
      [SETTING_KEYS.scoringWeightAcceptance]: "50",
      [SETTING_KEYS.scoringWeightApproval]: "50",
    });

    await hazir;

    // B: takip 20, kabul 20, onay 20 — **aynı eski görüntüde** geçerli
    // (60+20+20). İkisi birlikte 40+20+20 = 80 eder.
    const bSozu = saveSettings(testDb, {
      [SETTING_KEYS.scoringWeightFollowUp]: "20",
      [SETTING_KEYS.scoringWeightAcceptance]: "20",
      [SETTING_KEYS.scoringWeightApproval]: "20",
    });

    await new Promise((c) => setTimeout(c, 150));
    birak();
    await Promise.all([aSozu, bSozu]);

    const son = await readScoreWeights(testDb);

    expect(son.regularity + son.acceptance + son.followUp).toBe(100);
    expect(son.regularity + son.approval + son.followUp).toBe(100);
  });
});
