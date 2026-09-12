import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";


//




//



const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const KEY_LENGTH = 32;

function deriveKey(secret: string, purpose: string): Buffer {


  return Buffer.from(
    hkdfSync("sha256", Buffer.from(secret), Buffer.alloc(0), Buffer.from(purpose), KEY_LENGTH),
  );
}


export function sealSecret(plain: string, secret: string, purpose: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, deriveKey(secret, purpose), iv);

  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    iv.toString("base64url"),
    authTag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}


export function openSecret(
  sealed: string,
  secret: string,
  purpose: string,
): string | null {
  const parts = sealed.split(".");
  if (parts.length !== 3) return null;

  try {
    const [iv, authTag, ciphertext] = parts.map((part) =>
      Buffer.from(part, "base64url"),
    );
    if (iv.length !== IV_LENGTH) return null;

    const decipher = createDecipheriv(ALGORITHM, deriveKey(secret, purpose), iv);
    decipher.setAuthTag(authTag);

    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
