import { PrismaClient } from "@prisma/client";

import { resetApplicationData } from "@/server/reset/service";

const REQUEST_ID = process.argv[2] ?? "";

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

async function main(): Promise<void> {
  if (!isUuid(REQUEST_ID)) {
    throw new Error("Geçerli bir sıfırlama isteği kimliği verilmedi.");
  }

  const db = new PrismaClient();

  try {
    const result = await resetApplicationData(db, REQUEST_ID);
    console.log(
      `[başlangıca dönüş] tamamlandı: istek=${result.requestId} kök=${result.rootUnitId}`,
    );
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(
    "[başlangıca dönüş] başarısız:",
    error instanceof Error ? error.message : String(error),
  );
  process.exitCode = 1;
});
