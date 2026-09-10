import { PrismaClient } from "@prisma/client";

// Next.js geliştirme modunda modüller yeniden yüklendiğinde her seferinde yeni
// bir bağlantı havuzu açılmasın diye istemci global nesnede tutulur.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
