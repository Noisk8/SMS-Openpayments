import argon2 from "argon2";

const OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

/** Hash Argon2id para secretos verificables (claves de usuario, códigos de verificación). */
export function hashSecret(secret: string): Promise<string> {
  return argon2.hash(secret, OPTIONS);
}

export async function verifySecret(hash: string, secret: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, secret);
  } catch {
    return false;
  }
}
