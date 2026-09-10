import { describe, expect, it } from "vitest";

import { computeScoreV1 } from "@/server/scoring/formula-v1";
import type { ScoreInput, ScoreWeights } from "@/server/scoring/compute";

// Formül **sürüm 1**'in altın sonuçları (denetim 25.08.2026, P8-R2-4).
//
// V1 önce ortak `profileWeights` ve `puan` yardımcılarını çağırıyordu: yeni
// bir formül için o ortaklardan biri değiştirildiğinde V1 dönemleri de
// yeniden yorumlanırdı. Sürüm kolonu vardı ama korumak için eklendiği
// davranışı garanti etmiyordu.
//
// Bu dosya V1'i **sayılarla** çiviliyor. Profil dağılımı, boş payda
// davranışı, sınırlama ya da yuvarlama değişirse buradaki bir satır kırılır.
// Kırıldığında yapılacak şey testi güncellemek değil: yeni davranış **yeni
// bir sürüme** yazılır.

const AGIRLIKLAR: ScoreWeights = {
  regularity: 60,
  acceptance: 30,
  approval: 30,
  followUp: 10,
};

function girdi(ek: Partial<ScoreInput> = {}): ScoreInput {
  return {
    expectedDays: 20,
    writtenDays: 10,
    writtenCount: 10,
    approvedCount: 5,
    decidedCount: 4,
    decidedOnTimeCount: 3,
    followUpTotal: 4,
    followUpHandled: 2,
    ...ek,
  };
}

describe("formül V1 — altın sonuçlar", () => {
  it("çalışan profili: kabul oranı var, onay süresi yok", () => {
    // düzenlilik 60×(10/20)=30 · kabul 30×(5/10)=15 · takip 10×(2/4)=5
    expect(computeScoreV1("employee", girdi(), AGIRLIKLAR)).toEqual({
      regularity: 30,
      acceptance: 15,
      approval: null,
      followUp: 5,
      total: 50,
    });
  });

  it("onaya tabi olmayan profil: kabul ağırlığı düzenliliğe eklenir", () => {
    // düzenlilik (60+30)×(10/20)=45 · kabul yok · takip 5
    expect(computeScoreV1("unapproved", girdi(), AGIRLIKLAR)).toEqual({
      regularity: 45,
      acceptance: null,
      approval: null,
      followUp: 5,
      total: 50,
    });
  });

  it("yönetici profili: kabul yerine onay süresi", () => {
    // düzenlilik 30 · onay 30×(3/4)=23 (yuvarlama) · takip 5
    expect(computeScoreV1("manager", girdi(), AGIRLIKLAR)).toEqual({
      regularity: 30,
      acceptance: null,
      approval: 23,
      followUp: 5,
      total: 58,
    });
  });

  it("boş payda cezalandırmaz, tam puan verir", () => {
    // Bütün dönem izinli: yazmadığı için değil, beklenmediği için yok.
    expect(
      computeScoreV1(
        "employee",
        girdi({
          expectedDays: 0,
          writtenDays: 0,
          writtenCount: 0,
          approvedCount: 0,
          followUpTotal: 0,
          followUpHandled: 0,
        }),
        AGIRLIKLAR,
      ),
    ).toEqual({
      regularity: 60,
      acceptance: 30,
      approval: null,
      followUp: 10,
      total: 100,
    });
  });

  it("pay paydayı aşarsa oran birde sınırlanır", () => {
    expect(
      computeScoreV1(
        "employee",
        girdi({ writtenDays: 40, expectedDays: 20 }),
        AGIRLIKLAR,
      ).regularity,
    ).toBe(60);
  });

  it("yuvarlama en yakına gider", () => {
    // 60 × (1/3) = 20; 30 × (1/3) = 10; 10 × (1/3) = 3.33 → 3
    expect(
      computeScoreV1(
        "employee",
        girdi({
          expectedDays: 3,
          writtenDays: 1,
          writtenCount: 3,
          approvedCount: 1,
          followUpTotal: 3,
          followUpHandled: 1,
        }),
        AGIRLIKLAR,
      ),
    ).toEqual({
      regularity: 20,
      acceptance: 10,
      approval: null,
      followUp: 3,
      total: 33,
    });
  });
});
