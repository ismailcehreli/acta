// Testler ve uçtan uca kurulum, bağlandıkları veritabanını tamamen
// boşaltabilir veya içine hesap yazabilir. Bu yüzden bağlanmadan önce hedefin
// gerçekten bir test veritabanı olduğu kanıtlanır.
//
// Denetim (17.08.2026, bulgu 3) önceki kontrolün — adreste "test"
// kelimesi aramanın — yetersiz olduğunu gösterdi: `latest` gibi bir ad da
// geçiyordu, host ve üretim adresiyle karşılaştırma hiç yapılmıyordu.

/** Test amaçlı kullanılmasına izin verilen veritabanı adları. */
const ALLOWED_DATABASE_NAMES = new Set(["faaliyet_test", "faaliyet_e2e"]);

/** Test veritabanı yalnızca geliştirme makinesinde veya CI'da çalışır. */
const ALLOWED_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "test-postgres"]);

/**
 * İki adresin aynı fiziksel veritabanını gösterip göstermediğini karşılaştırmak
 * için kanonik biçim. `localhost` ile `127.0.0.1`, yazılmış ve yazılmamış
 * varsayılan port, farklı kimlik bilgisi veya ek parametre aynı hedefi
 * gösterebilir; ham metin karşılaştırması bunu kaçırıyordu
 * (denetim FAZ 2, bulgu 6).
 */
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

/** Bağlantı adresini loga yazarken parolayı gizler. */
export function maskUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    if (url.password) url.password = "***";
    return url.toString();
  } catch {
    return "(çözümlenemeyen adres)";
  }
}

export interface AssertOptions {
  /** Hangi değişkenden geldiği; hata mesajında görünür. */
  variableName: string;
  /** Üretim/geliştirme adresi; test adresi bununla aynı olamaz. */
  applicationUrl?: string;
}

/**
 * Verilen adresin güvenle boşaltılabilecek bir test veritabanı olduğunu
 * doğrular. Şüphe varsa bağlanmaz: hata fırlatır.
 */
export function assertTestDatabaseUrl(
  rawUrl: string | undefined,
  options: AssertOptions,
): string {
  const { variableName, applicationUrl } = options;

  if (!rawUrl) {
    throw new Error(
      `${variableName} tanımlı değil. \`.env.example\` dosyasını \`.env\` olarak ` +
        "kopyalayın ve `docker compose --profile test up -d test-postgres` ile " +
        "test veritabanını başlatın.",
    );
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Testler üretim ortamında (NODE_ENV=production) çalıştırılamaz.",
    );
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`${variableName} geçerli bir bağlantı adresi değil.`);
  }

  if (applicationUrl) {
    const target = canonicalTarget(rawUrl);
    const applicationTarget = canonicalTarget(applicationUrl);

    if (target !== null && target === applicationTarget) {
      throw new Error(
        `${variableName}, uygulamanın DATABASE_URL değeriyle aynı veritabanını ` +
          `gösteriyor (${maskUrl(rawUrl)}). Testler uygulamanın veritabanını ` +
          "boşaltamaz.",
      );
    }
  }

  if (!ALLOWED_HOSTS.has(url.hostname)) {
    throw new Error(
      `${variableName} yerel olmayan bir sunucuya işaret ediyor ` +
        `(${url.hostname}). İzinli sunucular: ${[...ALLOWED_HOSTS].join(", ")}.`,
    );
  }

  const databaseName = url.pathname.replace(/^\//, "");
  if (!ALLOWED_DATABASE_NAMES.has(databaseName)) {
    throw new Error(
      `${variableName} izinli bir test veritabanına işaret etmiyor ` +
        `(veritabanı adı: "${databaseName}"). İzinli adlar: ` +
        `${[...ALLOWED_DATABASE_NAMES].join(", ")}.`,
    );
  }

  return rawUrl;
}
