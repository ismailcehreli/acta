// E-posta alan adı kısıtı (ürün sahibi kararı, 19.08.2026).
//
// Hesapları sistem yöneticisi açtığı için bu kısıt bir güvenlik duvarı değil,
// **yanlış yazmaya karşı bir emniyet mandalı**dır: "@acme.com" yerine
// "@acme.co" yazılan bir adres kimsenin fark etmediği bir hesap üretir
// ve o kişi hiçbir bildirimi alamaz.
//
// Varsayılanı boştur — boş liste "kısıt yok" demektir. Değer ayar ekranından
// değiştirilir; kodda alan adı sabiti tutulmaz.

/** Alt alan adları eşleşmez: "posta.acme.com", "acme.com" değildir. */
const DOMAIN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

export type DomainListResult =
  | { ok: true; domains: string[] }
  | { ok: false; message: string };

/**
 * Serbest metni alan adı listesine çevirir. Virgül, boşluk ve satır sonu
 * ayırıcı sayılır; baştaki "@" atılır; tekrarlar teke iner.
 */
export function parseDomainList(raw: string): DomainListResult {
  const parcalar = raw
    .split(/[\s,;]+/)
    .map((parca) => parca.trim().replace(/^@/, "").toLowerCase())
    .filter((parca) => parca !== "");

  const domains: string[] = [];

  for (const parca of parcalar) {
    if (!DOMAIN.test(parca)) {
      return {
        ok: false,
        message: `"${parca}" geçerli bir alan adı değil. Örnek: acme.com`,
      };
    }
    if (!domains.includes(parca)) domains.push(parca);
  }

  return { ok: true, domains };
}

/** Ayarda saklanan kanonik biçim. */
export function formatDomainList(domains: string[]): string {
  return domains.join(", ");
}

/**
 * Adres izinli mi? **Boş liste her adrese izin verir** — kısıt kapalıdır.
 * Kapalıyken "hiçbir adrese izin yok" demek, sistemi kurulur kurulmaz
 * kullanılamaz hâle getirirdi.
 */
export function isEmailDomainAllowed(email: string, domains: string[]): boolean {
  if (domains.length === 0) return true;

  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return false;

  return domains.includes(domain);
}
