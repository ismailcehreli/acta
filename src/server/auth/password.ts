import { hash, verify } from "@node-rs/argon2";

import {
  ARGON2_MEMORY_COST_KIB,
  ARGON2_PARALLELISM,
  ARGON2_TIME_COST,
} from "./config";

// Parolalar Argon2id ile özetlenir, asla düz metin saklanmaz (§15.3).
//
// Algoritma açıkça yazılmaz: kütüphanenin `Algorithm` numaralandırması
// `const enum` olduğu için `isolatedModules` altında kullanılamıyor ve sayısını
// elle yazmak sessizce yanlışa dönebilir. Varsayılan zaten Argon2id'dir ve
// üretilen özetin `$argon2id$` ile başladığı testle güvence altındadır
// (tests/auth/password.test.ts).
const options = {
  memoryCost: ARGON2_MEMORY_COST_KIB,
  timeCost: ARGON2_TIME_COST,
  parallelism: ARGON2_PARALLELISM,
};

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, options);
}

export async function verifyPassword(
  storedHash: string,
  plain: string,
): Promise<boolean> {
  try {
    return await verify(storedHash, plain, options);
  } catch {
    // Bozuk veya tanınmayan özet, doğrulanamamış paroladır. Hatayı yukarı
    // taşımak giriş ucunda bilgi sızdırır; sonuç "eşleşmedi" olur.
    return false;
  }
}
