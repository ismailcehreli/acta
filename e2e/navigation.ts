interface NavigableFrame {
  url(): string;
}

export interface NavigablePage<TResponse = unknown> {
  goto(address: string, options?: unknown): Promise<TResponse>;
  url(): string;
  mainFrame(): NavigableFrame;
  on(
    event: "framenavigated",
    listener: (frame: NavigableFrame) => void,
  ): unknown;
  off(
    event: "framenavigated",
    listener: (frame: NavigableFrame) => void,
  ): unknown;
  waitForTimeout(milliseconds: number): Promise<void>;
}

const NAVIGATION_CANCELLATIONS = [
  "interrupted by another navigation",
  "NS_BINDING_ABORTED",
];

function isNavigationCancellation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return NAVIGATION_CANCELLATIONS.some((marker) => message.includes(marker));
}

function sameUrl(left: string, right: string): boolean {
  try {
    let base = "http://local.test";
    for (const candidate of [left, right]) {
      try {
        base = new URL(candidate).href;
        break;
      } catch {
        // Relative URLs are resolved against the local test origin below.
      }
    }

    const leftUrl = new URL(left, base);
    const rightUrl = new URL(right, base);
    return (
      leftUrl.origin === rightUrl.origin &&
      leftUrl.pathname === rightUrl.pathname &&
      leftUrl.search === rightUrl.search
    );
  } catch {
    return left.split("#")[0] === right.split("#")[0];
  }
}

function matchesPattern(value: string, pattern: RegExp): boolean {
  pattern.lastIndex = 0;
  return pattern.test(value);
}

function getCancellationTarget(error: unknown): string | null {
  const message = error instanceof Error ? error.message : String(error);
  const match = /interrupted by another navigation to "([^"]+)"/.exec(message);
  return match?.[1] ?? null;
}

export class UnexpectedRedirect extends Error {
  constructor(
    readonly target: string,
    readonly landedAt: string,
  ) {
    super(
      "Navigation was cancelled and the page landed at an unexpected address. " +
        `Requested: ${target} · Landed at: ${landedAt}. ` +
        "The application redirected there; this test must measure that behavior " +
        "instead of retrying it.",
    );
  }
}

/**
 * Retry `page.goto` only when a proven same-page navigation race interrupted it.
 * Application redirects are surfaced as failures; a real page-load failure is
 * never hidden by this helper.
 */
export async function resilientGoto<TResponse>(
  page: NavigablePage<TResponse>,
  address: string,
  options?: unknown,
): Promise<TResponse> {
  const previousUrl = page.url();
  let observedMainFrameTarget: string | null = null;
  const mainFrame = page.mainFrame();
  const navigationListener = (frame: NavigableFrame): void => {
    if (frame === mainFrame) observedMainFrameTarget = frame.url();
  };

  page.on("framenavigated", navigationListener);

  try {
    return await page.goto(address, options);
  } catch (error) {
    if (!isNavigationCancellation(error)) throw error;

    // Chromium and WebKit include the competing target in the error. Firefox
    // exposes it through the main-frame event instead.
    let competingTarget = getCancellationTarget(error);

    if (!competingTarget) {
      await page.waitForTimeout(50);
      const currentUrl = page.url();
      competingTarget =
        observedMainFrameTarget ??
        (!sameUrl(currentUrl, previousUrl) ? currentUrl : null);

      if (!competingTarget) throw error;
    }

    const safeRace =
      sameUrl(competingTarget, previousUrl) || sameUrl(competingTarget, address);

    if (!safeRace) throw new UnexpectedRedirect(address, competingTarget);
  } finally {
    page.off("framenavigated", navigationListener);
  }

  return await page.goto(address, options);
}

/**
 * Navigate while accepting an application redirect that the test explicitly
 * expects. There is no retry: retrying would erase the redirect being measured.
 */
export async function gotoExpectingRedirect<TResponse>(
  page: NavigablePage<TResponse>,
  address: string,
  expected: RegExp,
): Promise<void> {
  try {
    await page.goto(address);
    const landedAt = page.url();
    if (!matchesPattern(landedAt, expected)) {
      throw new UnexpectedRedirect(address, landedAt);
    }
  } catch (error) {
    if (error instanceof UnexpectedRedirect) throw error;
    if (!isNavigationCancellation(error)) throw error;

    const landedAt = getCancellationTarget(error) ?? page.url();
    if (!matchesPattern(landedAt, expected)) {
      throw new UnexpectedRedirect(address, landedAt);
    }
  }
}
