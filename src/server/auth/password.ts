import { hash, verify } from "@node-rs/argon2";

import {
  ARGON2_MEMORY_COST_KIB,
  ARGON2_PARALLELISM,
  ARGON2_TIME_COST,
} from "./config";


//




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


    return false;
  }
}
