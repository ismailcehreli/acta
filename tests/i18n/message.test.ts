import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  localizeServiceMessage,
  localizeValidationIssue,
} from "@/shared/i18n/message";
import { createTranslator } from "@/shared/i18n";

describe("localized domain and validation messages", () => {
  it("resolves a stable service error code in the active locale", () => {
    const t = createTranslator("tr");

    expect(
      localizeServiceMessage(t, "activity", {
        error: "conflict",
        message: "The activity changed while you were working.",
      }),
    ).toBe("Siz çalışırken faaliyet değişti. Sayfayı yenileyip tekrar deneyin.");
  });

  it("uses an explicit message key and values for dynamic service errors", () => {
    const t = createTranslator("tr");

    expect(
      localizeServiceMessage(t, "user", {
        error: "email_domain_not_allowed",
        message: "fallback",
        messageKey: "errors.user.emailDomainNotAllowedWithList",
        messageValues: { domains: "example.com" },
      }),
    ).toBe("Hesaplar yalnızca şu alan adları için oluşturulabilir: example.com");
  });

  it("localizes known Zod messages and hides unknown implementation text", () => {
    const t = createTranslator("tr");
    const known = z.string().min(1, "Email address is required").safeParse("");
    const unknown = z.string().uuid().safeParse("not-an-id");

    expect(localizeValidationIssue(t, known.success ? undefined : known.error.issues[0])).toBe(
      "E-posta adresi zorunludur",
    );
    expect(
      localizeValidationIssue(t, unknown.success ? undefined : unknown.error.issues[0]),
    ).toBe("Geçersiz giriş.");
  });
});
