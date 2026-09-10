import type { PrismaClient } from "@prisma/client";

import type { VisibilityDb } from "@/server/authz/visibility";

export type ReportDb = VisibilityDb &
  Pick<
    PrismaClient,
    | "notificationQueue"
    | "userScorePeriod"
    | "userScorePeriodFact"
    | "feedback"
  >;
