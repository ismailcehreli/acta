import { describe, expect, it } from "vitest";

import {
  formatJobInterval,
  jobDescription,
  jobLabel,
  JOB_LABELS,
} from "@/server/jobs/labels";
import { JOB_NAMES } from "@/server/jobs/status";

describe("zamanlanmış iş adları", () => {
  it("beklenen her işin kullanıcıya görünen adı vardır", () => {
    for (const jobName of Object.values(JOB_NAMES)) {
      expect(JOB_LABELS[jobName]).toBeDefined();
      expect(jobLabel(jobName)).not.toBe(jobName);
      expect(jobDescription(jobName).length).toBeGreaterThan(0);
    }
  });

  it("aralıkları günlük dile çevirir", () => {
    expect(formatJobInterval(1)).toBe("1 dakika");
    expect(formatJobInterval(90)).toBe("1 saat 30 dakika");
    expect(formatJobInterval(1440)).toBe("24 saat");
  });

  it("tanınmayan iş adı ham adı kullanıcıya taşımaz", () => {
    expect(jobLabel("unknown_job")).toBe("Zamanlanmış iş");
    expect(jobDescription("unknown_job")).toBe("Arka plandaki bir işi çalıştırır.");
  });
});
