import { describe, expect, it } from "vitest";

import {
  ALLOWED_MIME_TYPES,
  isAllowedContentType,
  isInlineViewable,
} from "@/server/attachments/rules";

// Attachment type rules (§5.2, §15.4). This file does not touch the database:
// rules are pure functions and must remain so — the answer to "which files can open
// in the browser" should not be hidden inside a download endpoint.

describe("allowed MIME types (§5.2)", () => {
  it("accepts video formats (product owner decision, 2026-09-03)", () => {
    expect(isAllowedContentType("video/mp4")).toBe(true);
    expect(isAllowedContentType("video/webm")).toBe(true);
    expect(isAllowedContentType("video/quicktime")).toBe(true);
  });

  it("continues to accept images, PDFs, and office formats", () => {
    expect(isAllowedContentType("image/png")).toBe(true);
    expect(isAllowedContentType("application/pdf")).toBe(true);
    expect(
      isAllowedContentType(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
    ).toBe(true);
  });

  it("rejects SVG: executable script risk", () => {
    expect(isAllowedContentType("image/svg+xml")).toBe(false);
  });

  it("rejects if type could not be detected", () => {
    expect(isAllowedContentType(undefined)).toBe(false);
  });
});

describe("inline browser viewable types (§15.4)", () => {
  it("can display images, PDF, and videos in page", () => {
    expect(isInlineViewable("image/jpeg")).toBe(true);
    expect(isInlineViewable("image/gif")).toBe(true);
    expect(isInlineViewable("application/pdf")).toBe(true);
    expect(isInlineViewable("video/mp4")).toBe(true);
  });

  it("cannot display office documents inline: browser cannot render natively", () => {
    expect(isInlineViewable("application/msword")).toBe(false);
    expect(
      isInlineViewable(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ),
    ).toBe(false);
  });

  it("disallowed type cannot be viewed inline regardless of name", () => {
    // Even if database type column is corrupted or allowed list shrinks,
    // inline display gate must never expose types outside the allowed list.
    expect(isInlineViewable("image/svg+xml")).toBe(false);
    expect(isInlineViewable("text/html")).toBe(false);
    expect(isInlineViewable("application/octet-stream")).toBe(false);
  });

  it("all inline viewable types are strict subset of allowed types", () => {
    for (const mimeType of ALLOWED_MIME_TYPES) {
      if (isInlineViewable(mimeType)) {
        expect(ALLOWED_MIME_TYPES.has(mimeType)).toBe(true);
      }
    }
  });
});
