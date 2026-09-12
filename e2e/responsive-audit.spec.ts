import { resilientGoto } from "./navigation";
import { expect, test, type Page } from "./test-base";

import { E2E_ADMIN, E2E_GM, e2ePassword } from "./global-setup";

// Responsive audit (design Phase 9).
//
// This file does not ask whether the page "looks nice" — it **measures**. Three
// properties are tested:
//
//  1. No page produces horizontal scrolling. Overflow is the most common and
//     silent narrow-screen failure: the page appears to work while content is
//     outside the viewport.
//  2. Touch targets are 44px. The bottom tab bar is the primary mobile
//     navigation; a 32px target is easy to miss.
//  3. Text/background contrast passes the WCAG AA threshold. Tokens use oklch;
//     deciding that something is "dark enough" by eye is not a measurement.
//
// Screenshots are written to `test-results/screenshots/` (not committed).
//
// **A separate time budget is intentional** (audit 2026-08-21, finding 18).
// Each measurement test logs in twice, visits 11 routes, waits for the network
// to settle, and captures a full-page screenshot at every route. The default
// 30 seconds is not enough for this work; without a separate budget, `pnpm e2e`
// would make the quality gate unable to distinguish a real regression from noise.
//
// Increasing the timeout does not hide failures: measurements take 23–28 seconds
// with one worker and are slower in the full suite. This value leaves margin for
// the measured runtime.
test.describe.configure({ timeout: 150_000 });

const VIEWPORTS = [
  { label: "390-phone", width: 390, height: 844 },
  { label: "768-tablet", width: 768, height: 1024 },
  { label: "1024-small-desktop", width: 1024, height: 768 },
  { label: "1440-desktop", width: 1440, height: 900 },
];

const ROUTES = [
  { path: "/", label: "home" },
  { path: "/activities", label: "activities" },
  { path: "/activities/new", label: "new-activity" },
  { path: "/approvals", label: "approvals" },
  { path: "/follow-ups", label: "follow-ups" },
  { path: "/search", label: "search" },
  { path: "/team/absence", label: "team-absence" },
];

// Administrative routes are visited as the system administrator; the general
// manager sees an access warning on these pages (correct, but not a design test).
const ADMIN_ROUTES = [
  { path: "/admin/org", label: "admin-organization" },
  { path: "/admin/users", label: "admin-users" },
  { path: "/admin/settings", label: "admin-settings" },
  { path: "/admin/audit", label: "admin-audit" },
];

async function signIn(page: Page, email: string = E2E_GM.email) {
  await page.context().clearCookies();
  await resilientGoto(page, "/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(e2ePassword());
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page).toHaveURL(/\/$/);
}

/** Return horizontal overflow; one pixel is allowed for rounding. */
async function getHorizontalOverflow(page: Page) {
  return page.evaluate(() => {
    const documentElement = document.documentElement;
    return {
      scrollWidth: documentElement.scrollWidth,
      clientWidth: documentElement.clientWidth,
      overflowingElements: [...document.querySelectorAll<HTMLElement>("body *")]
        .filter((el) => {
          const bounds = el.getBoundingClientRect();
          return bounds.width > 0 && bounds.right > documentElement.clientWidth + 1;
        })
        .slice(0, 3)
        .map((el) => `${el.tagName.toLowerCase()}.${el.className?.toString().slice(0, 60)}`),
    };
  });
}

for (const viewport of VIEWPORTS) {
  test(`${viewport.label}: no page produces horizontal scrolling`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });

    for (const [email, routes] of [
      [E2E_GM.email, ROUTES],
      [E2E_ADMIN.email, ADMIN_ROUTES],
    ] as const) {
      await signIn(page, email);

      for (const route of routes) {
        await resilientGoto(page, route.path);
        // Let layout settle so the screenshot and measurement observe the same state.
        await page.waitForLoadState("networkidle");

        await page.screenshot({
          path: `test-results/screenshots/${viewport.label}--${route.label}.png`,
          fullPage: true,
        });

        const overflow = await getHorizontalOverflow(page);
        expect(
          overflow.scrollWidth,
          `${route.path} @${viewport.width}px overflows; elements: ${overflow.overflowingElements.join(" | ")}`,
        ).toBeLessThanOrEqual(overflow.clientWidth + 1);
      }
    }
  });
}

test("the mobile tab bar provides 44px touch targets", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);

  const tabs = page.getByRole("navigation", { name: "Primary navigation" }).getByRole("link");
  const tabCount = await tabs.count();
  expect(tabCount).toBeGreaterThan(0);

  for (let i = 0; i < tabCount; i += 1) {
    const bounds = await tabs.nth(i).boundingBox();
    expect(bounds, `tab ${i} could not be measured`).not.toBeNull();
    expect(bounds!.height, `tab ${i} height`).toBeGreaterThanOrEqual(44);
  }
});

test("text colors pass the WCAG AA contrast threshold", async ({ page }) => {
  await signIn(page);

  const measurements = await page.evaluate(() => {
    // Relative sRGB luminance (WCAG 2.x definition).
    function luminance(color: string) {
      const [r, g, b] = color
        .replace(/^rgba?\(|\)$/g, "")
        .split(/[\s,/]+/)
        .slice(0, 3)
        .map(Number)
        .map((value) => {
          const normalized = value / 255;
          return normalized <= 0.03928
            ? normalized / 12.92
            : ((normalized + 0.055) / 1.055) ** 2.4;
        });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }

    function contrastRatio(foreground: string, background: string) {
      const foregroundLuminance = luminance(foreground);
      const backgroundLuminance = luminance(background);
      return (
        (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
        (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
      );
    }

    // Tokens use oklch; getComputedStyle does not convert them to rgb. Painting
    // a pixel on a canvas and reading it uses the browser's actual screen color,
    // which is more reliable than reimplementing the conversion manually.
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext("2d", { willReadFrequently: true })!;
    const rootStyles = getComputedStyle(document.documentElement);
    const resolveColor = (token: string) => {
      const rawColor = rootStyles.getPropertyValue(token).trim();
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = rawColor;
      context.fillRect(0, 0, 1, 1);
      const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
      return `rgb(${r}, ${g}, ${b})`;
    };

    const canvasColor = resolveColor("--color-canvas");
    const surfaceColor = resolveColor("--color-surface");
    const result = {
      "ink/canvas": contrastRatio(resolveColor("--color-ink"), canvasColor),
      "muted/canvas": contrastRatio(resolveColor("--color-muted"), canvasColor),
      "faint/canvas": contrastRatio(resolveColor("--color-faint"), canvasColor),
      "ink/surface": contrastRatio(resolveColor("--color-ink"), surfaceColor),
      "muted/surface": contrastRatio(resolveColor("--color-muted"), surfaceColor),
      "primary/canvas": contrastRatio(resolveColor("--color-primary"), canvasColor),
      "white/primary": contrastRatio("rgb(255,255,255)", resolveColor("--color-primary")),
      "danger/canvas": contrastRatio(resolveColor("--color-danger"), canvasColor),
    };
    return result;
  });

  // Include measurements in the report: saying "passed" without numbers is not
  // evidence.
  console.log("[contrast]", JSON.stringify(measurements, null, 2));

  // Body text and links: AA normal-text threshold is 4.5.
  expect(measurements["ink/canvas"]).toBeGreaterThanOrEqual(4.5);
  expect(measurements["muted/canvas"]).toBeGreaterThanOrEqual(4.5);
  expect(measurements["ink/surface"]).toBeGreaterThanOrEqual(4.5);
  expect(measurements["muted/surface"]).toBeGreaterThanOrEqual(4.5);
  expect(measurements["primary/canvas"]).toBeGreaterThanOrEqual(4.5);
  expect(measurements["danger/canvas"]).toBeGreaterThanOrEqual(4.5);
  // White text over the primary button.
  expect(measurements["white/primary"]).toBeGreaterThanOrEqual(4.5);
  // `faint` is used only for labels and scale text; AA large-text threshold is 3.
  expect(measurements["faint/canvas"]).toBeGreaterThanOrEqual(3);
});
