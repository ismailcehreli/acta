import { describe, expect, it } from "vitest";

import {
  formatJobInterval,
  jobDescription,
  jobLabel,
  JOB_LABELS,
} from "@/server/jobs/labels";
import { JOB_NAMES } from "@/server/jobs/status";

describe("scheduled job labels", () => {
  it("provides a user-facing label for every known job", () => {
    for (const jobName of Object.values(JOB_NAMES)) {
      expect(JOB_LABELS[jobName]).toBeDefined();
      expect(jobLabel(jobName)).not.toBe(jobName);
      expect(jobDescription(jobName).length).toBeGreaterThan(0);
    }
  });

  it("formats intervals in plain language", () => {
    expect(formatJobInterval(1)).toBe("1 minute");
    expect(formatJobInterval(90)).toBe("1 hour 30 minutes");
    expect(formatJobInterval(1440)).toBe("24 hours");
  });

  it("does not expose a raw name for an unknown job", () => {
    expect(jobLabel("unknown_job")).toBe("Scheduled job");
    expect(jobDescription("unknown_job")).toBe("Runs a background job.");
  });
});
