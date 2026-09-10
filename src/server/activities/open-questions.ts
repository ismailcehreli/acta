import type { Prisma } from "@prisma/client";

/**
 * Dashboard ve faaliyet listelerinin ortak açık soru koşulu.
 *
 * Bu gösterge kullanıcının kendi sorduğu soruyu "cevaplanacak iş" saymaz;
 * onun yeri iş kuyruğundaki "İzlediklerim" bölümüdür. Koşul faaliyet
 * seviyesindedir: aynı faaliyette birden çok uygun konuşma olsa da faaliyet
 * sorgudan bir kez döner.
 */
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
