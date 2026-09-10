import { describe, expect, it } from "vitest";

import {
  differsFromCurrent,
  hasContent,
  parseDraft,
  savedAtLabel,
} from "@/shared/drafts/activity-draft";

// Yarım kalmış metnin karar kuralları (Görev 10.2).
//
// Bu kurallar tarayıcıya bağlı değil; saf ve testli tutulmalarının sebebi bu.
// React tarafı yalnız DOM okuyup yazıyor.

const BOS = {
  activityDate: "2026-08-19",
  title: "",
  description: "",
  targetDepartmentIds: [] as string[],
};

const DOLU = {
  activityDate: "2026-08-19",
  title: "Kalıp bakımı",
  description: "Üç numaralı kalıpta erken aşınma.",
  targetDepartmentIds: ["11111111-1111-4111-8111-111111111111"],
};

describe("depodan okuma", () => {
  it("kayıt yoksa null döner", () => {
    expect(parseDraft(null)).toBeNull();
    expect(parseDraft("")).toBeNull();
  });

  it("bozuk JSON sessizce yok sayılır", () => {
    // Yerel depo kullanıcının elinin altındadır; bozuk kayıt uygulamayı
    // düşürmemeli.
    expect(parseDraft("{bozuk")).toBeNull();
  });

  it("beklenmeyen biçim kabul edilmez", () => {
    // Başka bir sürümün bıraktığı eski biçim de olabilir.
    expect(parseDraft(JSON.stringify({ title: "yalnız başlık" }))).toBeNull();
  });

  it("departman kimliği uuid değilse reddedilir", () => {
    const bozuk = JSON.stringify({
      ...DOLU,
      targetDepartmentIds: ["'; DROP TABLE"],
      savedAt: "2026-08-19T09:00:00.000Z",
    });

    expect(parseDraft(bozuk)).toBeNull();
  });

  it("geçerli kayıt okunur", () => {
    const ham = JSON.stringify({ ...DOLU, savedAt: "2026-08-19T09:00:00.000Z" });

    const draft = parseDraft(ham);

    expect(draft?.title).toBe("Kalıp bakımı");
    expect(draft?.targetDepartmentIds).toHaveLength(1);
  });
});

describe("saklamaya değer mi", () => {
  it("boş form saklanmaz", () => {
    expect(hasContent(BOS)).toBe(false);
  });

  it("yalnız boşluk saklanmaz", () => {
    expect(hasContent({ ...BOS, title: "   ", description: "\n\t" })).toBe(false);
  });

  it("başlık ya da açıklama doluysa saklanır", () => {
    expect(hasContent({ ...BOS, title: "K" })).toBe(true);
    expect(hasContent({ ...BOS, description: "bir şey" })).toBe(true);
  });

  it("yalnız departman seçmek metin sayılmaz", () => {
    // Kutucuk işaretleyip vazgeçen kullanıcıya "yarım metniniz var" demek
    // gürültüdür.
    expect(hasContent({ ...BOS, targetDepartmentIds: ["x"] })).toBe(false);
  });
});

describe("geri getirmeyi teklif etmeye değer mi", () => {
  it("formda aynı metin varsa teklif edilmez", () => {
    // Düzeltme ekranında kendi kaydettiği metni "yarım kalmış" diye görmek
    // kafa karıştırırdı.
    expect(differsFromCurrent(DOLU, DOLU)).toBe(false);
  });

  it("baştaki ve sondaki boşluk fark sayılmaz", () => {
    expect(
      differsFromCurrent({ ...DOLU, title: "  Kalıp bakımı  " }, DOLU),
    ).toBe(false);
  });

  it("başlık farklıysa teklif edilir", () => {
    expect(differsFromCurrent({ ...DOLU, title: "Başka" }, DOLU)).toBe(true);
  });

  it("tarih farklıysa teklif edilir", () => {
    expect(
      differsFromCurrent({ ...DOLU, activityDate: "2026-08-18" }, DOLU),
    ).toBe(true);
  });

  it("departman kümesi farklıysa teklif edilir", () => {
    expect(
      differsFromCurrent({ ...DOLU, targetDepartmentIds: [] }, DOLU),
    ).toBe(true);
  });

  it("departman sırası fark sayılmaz", () => {
    const a = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"];
    const b = [...a].reverse();

    expect(
      differsFromCurrent(
        { ...DOLU, targetDepartmentIds: a },
        { ...DOLU, targetDepartmentIds: b },
      ),
    ).toBe(false);
  });
});

describe("ne zaman yazıldığı", () => {
  const simdi = new Date("2026-08-19T12:00:00.000Z");

  it("bir dakikanın altı 'az önce'", () => {
    expect(savedAtLabel("2026-08-19T11:59:30.000Z", simdi)).toBe("az önce");
  });

  it("saat altı dakika ile söylenir", () => {
    expect(savedAtLabel("2026-08-19T11:20:00.000Z", simdi)).toBe("40 dakika önce");
  });

  it("gün altı saat ile söylenir", () => {
    expect(savedAtLabel("2026-08-19T09:00:00.000Z", simdi)).toBe("3 saat önce");
  });

  it("daha eskisi tarih olarak yazılır", () => {
    expect(savedAtLabel("2026-08-15T09:00:00.000Z", simdi)).toMatch(/15\.08\.2026/);
  });
});
