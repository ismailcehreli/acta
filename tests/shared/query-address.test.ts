import { describe, expect, it } from "vitest";

import { buildQueryAddress } from "@/shared/filters/query-address";

// Süzgeçleri koruyan adres üretici (Görev 11.3).
//
// Her listeleyen sayfa aynı işi yapıyordu ve her birinde ayrı yazılmıştı:
// sayfalama, sayfa boyu ve daraltma bağlantıları mevcut seçimi taşımalı.
// Arama sayfasında taşımıyordu — süzgeç uygulayıp ikinci sayfaya geçen
// kullanıcı bütün daraltmasını kaybediyordu.

describe("buildQueryAddress", () => {
  it("dolu parametreleri taşır", () => {
    const adres = buildQueryAddress("/search", { q: "kalıp", period: "week" });

    expect(adres).toBe("/search?q=kal%C4%B1p&period=week");
  });

  // Boş değer bir seçim değildir: adres çubuğunu `durum=` gibi anlamsız
  // parçalarla doldurmak, paylaşılan bağlantıyı da okunmaz yapardı.
  it("boş ve tanımsız değerleri atar", () => {
    const adres = buildQueryAddress("/activities", {
      period: "all",
      durum: "",
      targetOrgUnitId: undefined,
    });

    expect(adres).toBe("/activities?period=all");
  });

  it("hiç parametre kalmazsa yalın yolu döndürür", () => {
    expect(buildQueryAddress("/drafts", { tur: "" })).toBe("/drafts");
  });

  it("ek parametreler mevcutları ezer", () => {
    const adres = buildQueryAddress("/activities", { sayfa: "1" }, { sayfa: "3" });

    expect(adres).toBe("/activities?sayfa=3");
  });

  // Bir süzgeci bilerek düşürmek gerekebilir: "daraltmayı kaldır" bağlantısı
  // mevcut adresi alıp tek bir alanı çıkarır.
  it("çıkarılan parametreyi yazmaz", () => {
    const adres = buildQueryAddress(
      "/feed",
      { period: "week", durum: "onay" },
      {},
      ["durum"],
    );

    expect(adres).toBe("/feed?period=week");
  });
});
