import { describe, expect, it } from "vitest";

import {
  gotoExpectingRedirect,
  UnexpectedRedirect,
  resilientGoto,
} from "../../e2e/navigation";

// Navigation cancellation classifier helper.
//
// The dismantled global `page.goto` wrapper swallowed ALL navigation cancellations:
// when the app's own redirect cancelled an ongoing navigation, the error matched
// the pattern, and the wrapper blindly retried the target address.
// Permissions, sessions, and server action redirects are essential test subjects.
//
// The mock page here simulates real race conditions: `goto` throws "interrupted
// by another navigation". The distinction is made by inspecting where the page is at cancellation.

const CHROMIUM_ABORT = new Error(
  "page.goto: net::ERR_ABORTED; navigation interrupted by another navigation",
);
const FIREFOX_ABORT = new Error(
  "page.goto: NS_BINDING_ABORTED; maybe frame was detached?",
);

interface Step {
  /** Error thrown on this invocation. */
  error?: Error;
  /** Address the page navigated to before the error was thrown (competing navigation). */
  navigatedTo?: string;
  /** Final destination when goto resolves normally (redirect). */
  destination?: string;
  /** Delayed competing navigation observed on the main frame after cancellation. */
  delayedNavigatedTo?: string;
}

function mockPage(initialUrl: string, steps: Step[]) {
  let currentUrl = initialUrl;
  let stepIndex = 0;
  let callCount = 0;
  let timeoutCount = 0;
  let delayedNavigatedTo: string | undefined;
  const listeners = new Set<(frame: { url(): string }) => void>();
  const mainFrame = { url: () => currentUrl };

  function navigate(newUrl: string): void {
    currentUrl = newUrl;
    for (const listener of listeners) listener(mainFrame);
  }

  const page = {
    url: () => currentUrl,
    mainFrame: () => mainFrame,
    on(
      _event: "framenavigated",
      listener: (frame: { url(): string }) => void,
    ) {
      listeners.add(listener);
    },
    off(
      _event: "framenavigated",
      listener: (frame: { url(): string }) => void,
    ) {
      listeners.delete(listener);
    },
    async waitForTimeout() {
      timeoutCount += 1;
      if (delayedNavigatedTo) {
        navigate(delayedNavigatedTo);
        delayedNavigatedTo = undefined;
      }
    },
    callCount: () => callCount,
    timeoutCount: () => timeoutCount,
    async goto(target: string) {
      callCount += 1;
      const step = steps[stepIndex] ?? {};
      stepIndex += 1;

      if (step.navigatedTo) navigate(step.navigatedTo);
      delayedNavigatedTo = step.delayedNavigatedTo;
      if (step.error) throw step.error;

      currentUrl =
        step.destination ??
        (target.startsWith("http") ? target : `http://server${target}`);
      return `response:${currentUrl}`;
    },
  };

  return page;
}

describe("resilient goto", () => {
  it("retries once if the main frame refreshed the same page", async () => {
    // Firefox error message does not state competing target.
    // Safe retry is evidenced by same-page reload observed on the main frame.
    const page = mockPage("http://server/", [
      {
        error: FIREFOX_ABORT,
        delayedNavigatedTo: "http://server/",
      },
    ]);

    const response = await resilientGoto(page, "/activities/abc");

    expect(response).toBe("response:http://server/activities/abc");
    expect(page.callCount()).toBe(2);
    expect(page.timeoutCount()).toBe(1);
  });

  it("does not assume unknown cancellation target is safe just because page stayed at old URL", async () => {
    const page = mockPage("http://server/", [{ error: FIREFOX_ABORT }]);

    await expect(resilientGoto(page, "/feed")).rejects.toThrow(
      /NS_BINDING_ABORTED/,
    );
    expect(page.callCount()).toBe(1);
  });

  it("throws an error if application redirected to another URL", async () => {
    // Competing navigation is a genuine redirect: page landed on /login.
    const page = mockPage("http://server/", [
      { error: CHROMIUM_ABORT, navigatedTo: "http://server/login" },
    ]);

    await expect(resilientGoto(page, "/feed")).rejects.toBeInstanceOf(
      UnexpectedRedirect,
    );
    // Not retried.
    expect(page.callCount()).toBe(1);
  });

  it("relies on error competing target instead of premature page.url read", async () => {
    // Chromium/WebKit provides competing /login target in error message,
    // but page.url() might still return origin address when error is caught.
    const page = mockPage("https://server/", [
      {
        error: new Error(
          'page.goto: Navigation to "https://server/feed" is interrupted by ' +
            'another navigation to "https://server/login"',
        ),
      },
    ]);

    await expect(resilientGoto(page, "/feed")).rejects.toBeInstanceOf(
      UnexpectedRedirect,
    );
    expect(page.callCount()).toBe(1);
  });

  it("redirect error message includes target destination", async () => {
    const page = mockPage("http://server/", [
      { error: CHROMIUM_ABORT, navigatedTo: "http://server/login?next=%2Ffeed" },
    ]);

    await expect(resilientGoto(page, "/feed")).rejects.toThrow(
      /Requested: \/feed · Landed at: http:\/\/server\/login\?next=%2Ffeed/,
    );
  });

  it("cancellation occurring when already at destination is treated as race", async () => {
    // Navigation completed, background refresh caused cancellation error.
    const page = mockPage("http://server/", [
      { error: CHROMIUM_ABORT, navigatedTo: "http://server/feed" },
    ]);

    await resilientGoto(page, "/feed");

    expect(page.callCount()).toBe(2);
  });

  it("errors other than navigation cancellations are not swallowed", async () => {
    const page = mockPage("http://server/", [
      { error: new Error("page.goto: net::ERR_CONNECTION_REFUSED") },
    ]);

    await expect(resilientGoto(page, "/feed")).rejects.toThrow(
      /CONNECTION_REFUSED/,
    );
    expect(page.callCount()).toBe(1);
  });

  it("propagates error if second retry also fails", async () => {
    // Single retry; infinite loops would turn genuine failures into timeouts.
    const page = mockPage("http://server/login", [
      {
        error: FIREFOX_ABORT,
        delayedNavigatedTo: "http://server/login",
      },
      { error: FIREFOX_ABORT },
    ]);

    await expect(resilientGoto(page, "/feed")).rejects.toThrow(
      /NS_BINDING_ABORTED/,
    );
    expect(page.callCount()).toBe(2);
  });

  it("makes single call and returns response when there is no race", async () => {
    const page = mockPage("http://server/", []);

    expect(await resilientGoto(page, "/feed")).toBe("response:http://server/feed");
    expect(page.callCount()).toBe(1);
  });
});

describe("expected redirect goto", () => {
  // Verifies the scenario where the cancellation itself IS the test assertion:
  // e.g. opening `/` with expired session redirects to `/login`.

  const TARGETED_ABORT = new Error(
    'page.goto: Navigation to "https://server/" is interrupted by another ' +
      'navigation to "https://server/login"',
  );

  it("passes and avoids retrying when expected redirect occurred", async () => {
    const page = mockPage("https://server/panel", [{ error: TARGETED_ABORT }]);

    await gotoExpectingRedirect(page, "/", /\/login$/);

    // Single call: second navigation would overwrite redirect.
    expect(page.callCount()).toBe(1);
  });

  it("throws error if redirected elsewhere", async () => {
    const page = mockPage("https://server/panel", [
      {
        error: new Error(
          'page.goto: Navigation to "https://server/" is interrupted by ' +
            'another navigation to "https://server/error"',
        ),
      },
    ]);

    await expect(
      gotoExpectingRedirect(page, "/", /\/login$/),
    ).rejects.toBeInstanceOf(UnexpectedRedirect);
  });

  it("checks page location for browsers without target in error message", async () => {
    // Firefox only reports NS_BINDING_ABORTED without target.
    const page = mockPage("https://server/panel", [
      { error: FIREFOX_ABORT, navigatedTo: "https://server/login" },
    ]);

    await gotoExpectingRedirect(page, "/", /\/login$/);
    expect(page.callCount()).toBe(1);
  });

  it("verifies genuine redirect completing normally", async () => {
    const page = mockPage("https://server/panel", [
      { destination: "https://server/login" },
    ]);

    await gotoExpectingRedirect(page, "/", /\/login$/);
    expect(page.callCount()).toBe(1);
  });

  it("throws error if completed normally without redirect", async () => {
    const page = mockPage("https://server/panel", []);

    await expect(
      gotoExpectingRedirect(page, "/", /\/login$/),
    ).rejects.toBeInstanceOf(UnexpectedRedirect);
    expect(page.callCount()).toBe(1);
  });

  it("errors other than navigation cancellation are not swallowed", async () => {
    const page = mockPage("https://server/panel", [
      { error: new Error("page.goto: net::ERR_CONNECTION_REFUSED") },
    ]);

    await expect(
      gotoExpectingRedirect(page, "/", /\/login$/),
    ).rejects.toThrow(/CONNECTION_REFUSED/);
  });
});
