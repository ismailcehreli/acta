import type { Prisma } from "@prisma/client";



//


//








export const CURRENT_PERIOD = {
  cancelledAt: null,
  status: "APPROVED",
} satisfies Prisma.NoActivityPeriodWhereInput;


export function periodCoveringDay(day: Date): Prisma.NoActivityPeriodWhereInput {
  return {
    ...CURRENT_PERIOD,
    startDate: { lte: day },
    endDate: { gte: day },
  };
}
