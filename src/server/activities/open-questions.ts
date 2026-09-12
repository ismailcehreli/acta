import type { Prisma } from "@prisma/client";


export function openQuestionActivityWhere(
  viewerId: string,
): Prisma.ActivityWhereInput {
  return {
    conversations: {
      some: {
        status: "OPEN",
        askerId: { not: viewerId },
      },
    },
  };
}
