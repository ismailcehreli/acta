

//






export interface TestDatabasePreparation {

  resolveUrl: () => string;

  assertSentinel: (url: string) => Promise<void>;

  runMigrations: (url: string) => void;

  isSchemaReady: (url: string) => Promise<boolean>;

  resetDatabase: (url: string) => void;
}

export async function prepareTestDatabase(
  steps: TestDatabasePreparation,
): Promise<void> {
  const url = steps.resolveUrl();
  await steps.assertSentinel(url);
  steps.runMigrations(url);

  if (await steps.isSchemaReady(url)) return;





  steps.resetDatabase(url);

  if (!(await steps.isSchemaReady(url))) {
    throw new Error(
      "Required tables are still missing after resetting the test database; " +
        "the application server was not started.",
    );
  }
}
