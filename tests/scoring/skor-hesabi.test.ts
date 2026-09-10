import { describe, expect, it } from "vitest";

import {
  VARSAYILAN_AGIRLIKLAR,
  computeScore,
  profileWeights,
  resolveScoreProfile,
} from "@/server/scoring/compute";

const SCORE_PROFILES = {
  employee: profileWeights("employee"),
  unapproved: profileWeights("unapproved"),
  manager: profileWeights("manager"),
};

// Dönemsel skor hesabı (Görev 11.10, tasarım Paket I).
//
// **Temel skor 100 üzerindendir**; takdir katkısı bunun üzerine eklenebilir.
// Üç profil var çünkü bazı boyutlar bazı kişilerde tanımı gereği sabit:
// onaya tabi olmayan birimde kabul oranı hep %100 olur, yöneticiler onaya
// tabi değildir. Ölçmeyen bir boyut ağırlığını boşa harcar.

const BOS = {
  expectedDays: 0,
  writtenDays: 0,
  writtenCount: 0,
  approvedCount: 0,
  decidedCount: 0,
  decidedOnTimeCount: 0,
  followUpTotal: 0,
  followUpHandled: 0,
};

describe("profil seçimi", () => {
  it("onaya tabi çalışan", () => {
    expect(resolveScoreProfile({ isUnitManager: false, requiresApproval: true })).toBe("employee");
  });

  it("onaya tabi olmayan çalışan", () => {
    expect(resolveScoreProfile({ isUnitManager: false, requiresApproval: false })).toBe("unapproved");
  });

  it("yönetici, birimi onaya tabi olsa da yönetici profilini alır", () => {
    expect(resolveScoreProfile({ isUnitManager: true, requiresApproval: true })).toBe("manager");
  });
});

describe("ağırlık toplamı her profilde 100", () => {
  it("üç profilin de tavanı aynı", () => {
    for (const [ad, p] of Object.entries(SCORE_PROFILES)) {
      expect(p.regularity + p.acceptance + p.approval + p.followUp, ad).toBe(100);
    }
  });

  // Sabit nesnenin toplamını kontrol etmek yetmez: ağırlıklar artık ayardan
  // geliyor ve **hesabın** onları kullandığı ölçülmeli (denetim
  // 23.08.2026, bulgu 8).
  it("ayardan gelen ağırlık dağılımı hesabı değiştirir", () => {
    const agirliklar = { regularity: 30, acceptance: 60, approval: 60, followUp: 10 };
    const girdi = {
      ...BOS,
      expectedDays: 10,
      writtenDays: 5,
      writtenCount: 4,
      approvedCount: 4,
    };

    const varsayilan = computeScore("employee", girdi);
    const ayarli = computeScore("employee", girdi, agirliklar);

    // Düzenlilik yarım (%50), kabul oranı tam (%100): ağırlık kabul oranına
    // kayınca toplam yükselir.
    // Varsayılan: düzenlilik 60×½ = 30, kabul oranı 30, takip 10.
    expect(varsayilan.total).toBe(30 + 30 + 10);
    // Ayarlı: düzenlilik 30×½ = 15, kabul oranı 60, takip 10.
    expect(ayarli.total).toBe(15 + 60 + 10);
  });

  it("onaya tabi olmayan profilin düzenliliği iki ağırlığın toplamıdır", () => {
    const agirliklar = { regularity: 50, acceptance: 40, approval: 40, followUp: 10 };

    expect(profileWeights("unapproved", agirliklar).regularity).toBe(90);
    expect(profileWeights("unapproved", VARSAYILAN_AGIRLIKLAR).regularity).toBe(90);
  });
});

describe("düzenlilik", () => {
  it("beklenen günlerin tamamında yazan tam puan alır", () => {
    const skor = computeScore("employee", { ...BOS, expectedDays: 20, writtenDays: 20 });
    expect(skor.regularity).toBe(SCORE_PROFILES.employee.regularity);
  });

  // Bir günde beş kayıt bir gün sayılır: sayı ödüllendirilseydi bir işi
  // anlatan tek kayıt yerine onu bölen beş kayıt yazılırdı.
  it("aynı gün beş kayıt bir gün sayılır", () => {
    const bir = computeScore("employee", {
      ...BOS, expectedDays: 20, writtenDays: 10, writtenCount: 10, approvedCount: 10,
    });
    const bes = computeScore("employee", {
      ...BOS, expectedDays: 20, writtenDays: 10, writtenCount: 50, approvedCount: 50,
    });
    expect(bes.regularity).toBe(bir.regularity);
  });

  // Bütün dönem izinliyse payda sıfırdır; kişi yazmadığı için değil,
  // beklenmediği için yok — boyut cezalandırmamalı.
  it("beklenen gün yoksa düzenlilik tam sayılır", () => {
    expect(computeScore("employee", BOS).regularity).toBe(
      SCORE_PROFILES.employee.regularity,
    );
  });

  it("hiç yazmamışsa sıfırlanır", () => {
    const skor = computeScore("employee", { ...BOS, expectedDays: 20 });
    expect(skor.regularity).toBe(0);
    expect(skor.total).toBeLessThan(100);
  });
});

describe("kabul oranı", () => {
  it("onaya tabi çalışanda hesaplanır", () => {
    const skor = computeScore("employee", {
      ...BOS, expectedDays: 10, writtenDays: 10, writtenCount: 10, approvedCount: 5,
    });
    expect(skor.acceptance).toBe(Math.round(SCORE_PROFILES.employee.acceptance * 0.5));
  });

  it("onaya tabi olmayanda boş kalır", () => {
    const skor = computeScore("unapproved", {
      ...BOS, expectedDays: 10, writtenDays: 10, writtenCount: 10, approvedCount: 10,
    });
    expect(skor.acceptance).toBeNull();
  });
});

describe("yönetici onay süresi", () => {
  // Ret de karardır ve aynı puanı getirir: onaylayana puan verip reddedene
  // vermemek, onay mekanizmasının işini tersine çevirirdi.
  it("zamanında verilen kararlar puan getirir", () => {
    const skor = computeScore("manager", {
      ...BOS, expectedDays: 10, writtenDays: 10, decidedCount: 10, decidedOnTimeCount: 10,
    });
    expect(skor.approval).toBe(SCORE_PROFILES.manager.approval);
  });

  it("hiç karar düşmemişse boyut cezalandırmaz", () => {
    const skor = computeScore("manager", { ...BOS, expectedDays: 10, writtenDays: 10 });
    expect(skor.approval).toBe(SCORE_PROFILES.manager.approval);
  });

  it("çalışanda onay boyutu boş", () => {
    expect(computeScore("employee", BOS).approval).toBeNull();
  });
});

describe("toplam", () => {
  it("tam performansta üç profil de 100 verir", () => {
    for (const profil of ["employee", "unapproved", "manager"] as const) {
      const skor = computeScore(profil, {
        expectedDays: 20, writtenDays: 20, writtenCount: 20, approvedCount: 20,
        decidedCount: 5, decidedOnTimeCount: 5, followUpTotal: 3, followUpHandled: 3,
      });
      expect(skor.total, profil).toBe(100);
    }
  });

  it("takdir puanı temel skorun üzerine eklenir", () => {
    const skor = computeScore("employee", {
      ...BOS,
      expectedDays: 20,
      writtenDays: 20,
      writtenCount: 20,
      approvedCount: 20,
      appreciationCount: 4,
      appreciationPointsPer: 2,
    });

    expect(skor.baseTotal).toBe(100);
    expect(skor.appreciationCount).toBe(4);
    expect(skor.appreciationPoints).toBe(8);
    expect(skor.total).toBe(108);
  });

  it("takdir başına puan sıfırsa temel skor değişmez", () => {
    const skor = computeScore("employee", {
      ...BOS,
      expectedDays: 20,
      writtenDays: 20,
      writtenCount: 20,
      approvedCount: 20,
      appreciationCount: 4,
      appreciationPointsPer: 0,
    });

    expect(skor.appreciationCount).toBe(4);
    expect(skor.appreciationPoints).toBe(0);
    expect(skor.total).toBe(100);
  });
});
