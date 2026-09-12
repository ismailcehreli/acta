


//





const ALLOWED_DATABASE_NAMES = new Set(["acta_test", "acta_e2e"]);


const ALLOWED_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "test-postgres"]);


export function canonicalTarget(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  const host = ALLOWED_HOSTS.has(url.hostname) ? "127.0.0.1" : url.hostname;
  const port = url.port || "5432";
  const database = url.pathname.replace(/^\//, "");

  return `${host}:${port}/${database}`;
}

/** Masks the password when logging a connection URL. */
export function maskUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    if (url.password) url.password = "***";
    return url.toString();
  } catch {
    return "(unparseable URL)";
  }
}

export interface AssertOptions {
  /** Environment variable name, included in error messages. */
  variableName: string;
  /** Production/development URL; the test URL must not target the same database. */
  applicationUrl?: string;
}

/**
 * Verifies that the URL points to a test database that can be safely emptied.
 * Refuses to connect when anything is uncertain.
 */
export function assertTestDatabaseUrl(
  rawUrl: string | undefined,
  options: AssertOptions,
): string {
  const { variableName, applicationUrl } = options;

  if (!rawUrl) {
    throw new Error(
      `${variableName} is not set. Copy \`.env.example\` to \`.env\` and start the ` +
        "test database with `docker compose --profile test up -d test-postgres`.",
    );
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Tests cannot run in production (NODE_ENV=production).",
    );
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`${variableName} is not a valid connection URL.`);
  }

  if (applicationUrl) {
    const target = canonicalTarget(rawUrl);
    const applicationTarget = canonicalTarget(applicationUrl);

    if (target !== null && target === applicationTarget) {
      throw new Error(
        `${variableName} points to the same database as DATABASE_URL ` +
          `(${maskUrl(rawUrl)}). Tests cannot empty the application database.`,
      );
    }
  }

  if (!ALLOWED_HOSTS.has(url.hostname)) {
    throw new Error(
      `${variableName} points to a non-local host ` +
        `(${url.hostname}). Allowed hosts: ${[...ALLOWED_HOSTS].join(", ")}.`,
    );
  }

  const databaseName = url.pathname.replace(/^\//, "");
  if (!ALLOWED_DATABASE_NAMES.has(databaseName)) {
    throw new Error(
      `${variableName} does not point to an allowed test database ` +
        `(database name: "${databaseName}"). Allowed names: ` +
        `${[...ALLOWED_DATABASE_NAMES].join(", ")}.`,
    );
  }

  return rawUrl;
}
