import { describe, expect, it } from "vitest";

import {
  differsFromCurrent,
  hasContent,
  parseDraft,
  savedAtLabel,
} from "@/shared/drafts/activity-draft";

// Decision rules for draft content.
//
// These rules are decoupled from the browser; that is why they are kept pure and tested.
// The React layer only reads and writes the DOM.

const EMPTY_DRAFT = {
  activityDate: "2026-08-19",
  title: "",
  description: "",
  targetDepartmentIds: [] as string[],
};

const FILLED_DRAFT = {
  activityDate: "2026-08-19",
  title: "Mold maintenance",
  description: "Early wear detected in mold number 3.",
  targetDepartmentIds: ["11111111-1111-4111-8111-111111111111"],
};

describe("storage parsing", () => {
  it("returns null when empty or missing", () => {
    expect(parseDraft(null)).toBeNull();
    expect(parseDraft("")).toBeNull();
  });

  it("corrupted JSON is silently ignored", () => {
    // Local storage is under client control; corrupted entry should not crash the app.
    expect(parseDraft("{corrupted")).toBeNull();
  });

  it("unexpected schema shape is rejected", () => {
    // Might also be an obsolete format from an older version.
    expect(parseDraft(JSON.stringify({ title: "title only" }))).toBeNull();
  });

  it("rejects non-uuid department IDs", () => {
    const invalid = JSON.stringify({
      ...FILLED_DRAFT,
      targetDepartmentIds: ["'; DROP TABLE"],
      savedAt: "2026-08-19T09:00:00.000Z",
    });

    expect(parseDraft(invalid)).toBeNull();
  });

  it("reads valid draft record", () => {
    const raw = JSON.stringify({ ...FILLED_DRAFT, savedAt: "2026-08-19T09:00:00.000Z" });

    const draft = parseDraft(raw);

    expect(draft?.title).toBe("Mold maintenance");
    expect(draft?.targetDepartmentIds).toHaveLength(1);
  });
});

describe("worth saving check", () => {
  it("empty form is not saved", () => {
    expect(hasContent(EMPTY_DRAFT)).toBe(false);
  });

  it("whitespace-only content is not saved", () => {
    expect(hasContent({ ...EMPTY_DRAFT, title: "   ", description: "\n\t" })).toBe(false);
  });

  it("saved when title or description is populated", () => {
    expect(hasContent({ ...EMPTY_DRAFT, title: "K" })).toBe(true);
    expect(hasContent({ ...EMPTY_DRAFT, description: "some content" })).toBe(true);
  });

  it("selecting target departments alone is not considered content", () => {
    // Telling a user who ticked a checkbox and gave up that "you have an unfinished draft" is noise.
    expect(hasContent({ ...EMPTY_DRAFT, targetDepartmentIds: ["x"] })).toBe(false);
  });
});

describe("worth offering restore check", () => {
  it("not offered if current form content is identical", () => {
    // Showing "draft available" on an edit screen for the exact content just saved would be confusing.
    expect(differsFromCurrent(FILLED_DRAFT, FILLED_DRAFT)).toBe(false);
  });

  it("leading and trailing whitespace differences are ignored", () => {
    expect(
      differsFromCurrent({ ...FILLED_DRAFT, title: "  Mold maintenance  " }, FILLED_DRAFT),
    ).toBe(false);
  });

  it("offered when title differs", () => {
    expect(differsFromCurrent({ ...FILLED_DRAFT, title: "Other title" }, FILLED_DRAFT)).toBe(true);
  });

  it("offered when activity date differs", () => {
    expect(
      differsFromCurrent({ ...FILLED_DRAFT, activityDate: "2026-08-18" }, FILLED_DRAFT),
    ).toBe(true);
  });

  it("offered when department selection differs", () => {
    expect(
      differsFromCurrent({ ...FILLED_DRAFT, targetDepartmentIds: [] }, FILLED_DRAFT),
    ).toBe(true);
  });

  it("department order difference is ignored", () => {
    const a = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"];
    const b = [...a].reverse();

    expect(
      differsFromCurrent(
        { ...FILLED_DRAFT, targetDepartmentIds: a },
        { ...FILLED_DRAFT, targetDepartmentIds: b },
      ),
    ).toBe(false);
  });
});

describe("saved at label formatting", () => {
  const now = new Date("2026-08-19T12:00:00.000Z");

  it("less than a minute displays 'just now'", () => {
    expect(savedAtLabel("2026-08-19T11:59:30.000Z", now)).toBe("just now");
  });

  it("under an hour displays minutes", () => {
    expect(savedAtLabel("2026-08-19T11:20:00.000Z", now)).toBe("40m ago");
  });

  it("under a day displays hours", () => {
    expect(savedAtLabel("2026-08-19T09:00:00.000Z", now)).toBe("3h ago");
  });

  it("older timestamps display full date", () => {
    expect(savedAtLabel("2026-08-15T09:00:00.000Z", now)).toMatch(/08\/15\/2026/);
  });

  it("can use translated relative-time labels", () => {
    expect(
      savedAtLabel("2026-08-19T11:20:00.000Z", now, "tr", {
        justNow: "az önce",
        minutesAgo: (count) => `${count} dakika önce`,
        hoursAgo: (count) => `${count} saat önce`,
      }),
    ).toBe("40 dakika önce");
  });
});
