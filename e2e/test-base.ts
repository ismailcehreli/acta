import { test, expect, type Browser, type Page } from "@playwright/test";

// Shared base for end-to-end tests.
//
// **There is no navigation wrapper here** (audit 2026-08-23, finding 12).
//
// Previously, `page.goto` was wrapped globally and **all** cancelled
// navigations were retried silently. The reason was "solve the race in one
// place", but the wrapper never examined why navigation was cancelled. When
// an authorization check, session guard, or server action intentionally
// redirected the page, its error matched the same pattern; the wrapper hid
// the redirect and forced the requested address a second time. If the
// redirect was one-time, the second attempt passed. The product's actual
// redirect disappeared and later assertions stayed green on the wrong page.
// The behavior that E2E tests needed to measure was erased as infrastructure
// noise.
//
// Now, navigation goes through named functions in `e2e/navigation.ts`. They
// inspect **where the page went** when navigation is cancelled; they do not
// retry the application's redirect and instead surface the error. The reason,
// measurements, and scope are documented at the top of that file.

export { test, expect };
export type { Browser, Page };
