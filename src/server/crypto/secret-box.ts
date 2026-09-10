import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

// Uygulama sırlarının şifrelenmiş saklanması.
//
// SMTP parolası gibi değerler veritabanına **düz yazılamaz**: veritabanı yedeği
// alan, kopyalayan ya da okuma yetkisi olan herkes onu ele geçirirdi. Parola
// özetlerinden farkı, bunun geri çevrilebilir olması gerektiğidir — SMTP
// sunucusuna gerçek parolayla bağlanılır.
//
// Anahtar `APP_SECRET`ten HKDF ile türetilir; sır dosyada değil ortamda durur.
// AES-256-GCM kullanılır: hem şifreler hem de kurcalanmayı yakalar.

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const KEY_LENGTH = 32;

function deriveKey(secret: string, purpose: string): Buffer {
  // Amaca göre ayrı anahtar: aynı sırdan türeyen iki değer birbirinin yerine
  // kullanılamasın.
  return Buffer.from(
    hkdfSync("sha256", Buffer.from(secret), Buffer.alloc(0), Buffer.from(purpose), KEY_LENGTH),
  );
}

/** Şifreli metin: `iv.etiket.gövde`, hepsi base64url. */
export function sealSecret(plain: string, secret: string, purpose: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, deriveKey(secret, purpose), iv);

  const govde = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const etiket = cipher.getAuthTag();

  return [
    iv.toString("base64url"),
    etiket.toString("base64url"),
    govde.toString("base64url"),
  ].join(".");
}

/**
 * Şifreli metni çözer. Kurcalanmış, başka anahtarla şifrelenmiş ya da bozuk
 * bir değer `null` döner — çağıran bunu "sır yok" gibi ele alır; sessizce
 * yanlış bir değer üretmez.
 */
export function openSecret(
  sealed: string,
  secret: string,
  purpose: string,
): string | null {
  const parcalar = sealed.split(".");
  if (parcalar.length !== 3) return null;

  try {
    const [iv, etiket, govde] = parcalar.map((p) => Buffer.from(p, "base64url"));
    if (iv.length !== IV_LENGTH) return null;

    const decipher = createDecipheriv(ALGORITHM, deriveKey(secret, purpose), iv);
    decipher.setAuthTag(etiket);

    return Buffer.concat([decipher.update(govde), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
