import { describe, expect, it } from "vitest";

import {
  ALLOWED_MIME_TYPES,
  isAllowedContentType,
  isInlineViewable,
} from "@/server/attachments/rules";

// Ek türü kuralları (§5.2, §15.4). Bu dosya veritabanına dokunmaz: kural saf
// bir fonksiyondur ve öyle kalmalıdır — "hangi dosya tarayıcıda açılabilir"
// sorusunun cevabı, indirme ucunun içinde saklı kalırsa ikinci bir yerde
// yeniden yazılır ve iki cevap zamanla ayrışır.

describe("izinli türler (§5.2)", () => {
  it("video biçimleri kabul edilir (ürün sahibi kararı, 03.09.2026)", () => {
    expect(isAllowedContentType("video/mp4")).toBe(true);
    expect(isAllowedContentType("video/webm")).toBe(true);
    expect(isAllowedContentType("video/quicktime")).toBe(true);
  });

  it("resim, PDF ve ofis biçimleri kabul edilmeye devam eder", () => {
    expect(isAllowedContentType("image/png")).toBe(true);
    expect(isAllowedContentType("application/pdf")).toBe(true);
    expect(
      isAllowedContentType(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
    ).toBe(true);
  });

  it("SVG kabul edilmez: içinde betik çalışır", () => {
    expect(isAllowedContentType("image/svg+xml")).toBe(false);
  });

  it("tür tespit edilemediyse kabul edilmez", () => {
    expect(isAllowedContentType(undefined)).toBe(false);
  });
});

describe("tarayıcıda açılabilir türler (§15.4)", () => {
  it("resim, PDF ve video sayfada gösterilebilir", () => {
    expect(isInlineViewable("image/jpeg")).toBe(true);
    expect(isInlineViewable("image/gif")).toBe(true);
    expect(isInlineViewable("application/pdf")).toBe(true);
    expect(isInlineViewable("video/mp4")).toBe(true);
  });

  it("ofis belgeleri gösterilemez: tarayıcı bunları çizemez", () => {
    expect(isInlineViewable("application/msword")).toBe(false);
    expect(
      isInlineViewable(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ),
    ).toBe(false);
  });

  it("izinli olmayan tür, adı ne olursa olsun gösterilemez", () => {
    // Veritabanındaki tür sütunu bozulsa ya da ileride izin listesi
    // daralsa bile gösterim kapısı izin listesinin **dışına** açılmamalı.
    expect(isInlineViewable("image/svg+xml")).toBe(false);
    expect(isInlineViewable("text/html")).toBe(false);
    expect(isInlineViewable("application/octet-stream")).toBe(false);
  });

  it("gösterilebilir türlerin tamamı izinli türlerin alt kümesidir", () => {
    for (const tur of ALLOWED_MIME_TYPES) {
      if (isInlineViewable(tur)) {
        expect(ALLOWED_MIME_TYPES.has(tur)).toBe(true);
      }
    }
  });
});
