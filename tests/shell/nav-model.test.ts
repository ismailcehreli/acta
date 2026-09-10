import { describe, expect, it } from "vitest";

import { buildNav, isActive, mobileTabs, type NavUser } from "@/components/shell/nav-model";
import { createTranslator } from "@/shared/i18n";

const baseUser: NavUser = {
  isSystemAdmin: false,
  hasTeam: true,
  writesActivities: true,
  hasDeputyHistory: false,
  activeDeputyCount: 0,
  draftCount: 0,
  unreadCount: 0,
  pendingApprovals: 0,
  scoringEnabled: true,
  canViewReports: false,
  canViewScoreReports: false,
};

describe("ana gezinme modeli", () => {
  it("kişisel ve yönetilen alanı ayrı, varsayılan İngilizce adlandırır", () => {
    const nav = buildNav(baseUser);

    expect(nav.personal.find((item) => item.href === "/activities")?.label).toBe(
      "My Activities",
    );
    expect(nav.management.find((item) => item.href === "/feed")?.label).toBe(
      "Team Activities",
    );
    expect(
      nav.management.find((item) => item.href === "/team/absence")?.label,
    ).toBe("Team Absences");
    expect(nav.personal.some((item) => item.href === "/feed")).toBe(false);
  });

  it("Türkçe çevirmen ile Türkçe etiketler üretir", () => {
    const t = createTranslator("tr");
    const nav = buildNav(baseUser, t);

    expect(nav.personal.find((item) => item.href === "/activities")?.label).toBe(
      "Faaliyetlerim",
    );
    expect(nav.management.find((item) => item.href === "/feed")?.label).toBe(
      "Yönettiğim faaliyetler",
    );
    expect(
      nav.management.find((item) => item.href === "/team/absence")?.label,
    ).toBe("Yönettiğim izinler");
  });

  it("rapor bağlantısını yalnız rapor yetkisi olan kişiye verir", () => {
    expect(buildNav(baseUser).management.some((item) => item.href === "/reports")).toBe(
      false,
    );
    expect(
      buildNav({ ...baseUser, canViewReports: true }).management.find(
        (item) => item.href === "/reports",
      ),
    ).toMatchObject({ label: "Reports" });
  });

  it("rapor bağlantısını skor ekranından ayrı tutar", () => {
    const nav = buildNav({
      ...baseUser,
      scoringEnabled: false,
      canViewReports: true,
    });
    expect(nav.management.some((item) => item.href === "/reports")).toBe(true);
    expect(nav.management.some((item) => item.href === "/scores")).toBe(false);
  });

  it("ekibi olmayan kişide akış kişisel bölümde kalır", () => {
    const nav = buildNav({ ...baseUser, hasTeam: false });
    expect(nav.personal.find((item) => item.href === "/feed")?.label).toBe(
      "Activity Feed",
    );
    expect(nav.management).toHaveLength(0);
    expect(mobileTabs(nav).length).toBeLessThanOrEqual(5);
  });

  it("okunmamış sayacı akışı doğrudan dikkat filtresine bağlar", () => {
    const nav = buildNav({ ...baseUser, unreadCount: 2 });
    const akis = nav.management.find((item) => item.icon === "akis");

    expect(akis).toMatchObject({
      href: "/feed?period=all&okunmamis=1",
      count: 2,
    });
    expect(mobileTabs(nav)).toContainEqual(akis);
    expect(isActive("/feed", akis?.href ?? "")).toBe(true);
  });
});
