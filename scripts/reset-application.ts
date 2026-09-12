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
    throw new Error("A valid reset request ID was not provided.");
  }

  const db = new PrismaClient();

  try {
    const result = await resetApplicationData(db, REQUEST_ID);
    console.log(
      `[application reset] completed: request=${result.requestId} root=${result.rootUnitId}`,
    );
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(
    "[application reset] failed:",
    error instanceof Error ? error.message : String(error),
  );
  process.exitCode = 1;
});
