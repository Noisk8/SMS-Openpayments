import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { getEnv } from "@/lib/config/env";

const ALGORITHM = "aes-256-gcm";
const VERSION = "v1";
const IV_BYTES = 12;

/** Clave AES-256 (32 bytes) derivada de ENCRYPTION_KEY en base64. */
export function getEncryptionKey(keyBase64: string = getEnv().ENCRYPTION_KEY): Buffer {
  const key = Buffer.from(keyBase64, "base64");
  if (key.length !== 32) {
    throw new Error("ENCRYPTION_KEY debe ser una clave de 32 bytes codificada en base64");
  }
  return key;
}

/** Cifra con AES-256-GCM. Formato: v1.<iv>.<tag>.<ciphertext> (base64url). */
export function encryptSecret(plaintext: string, keyBase64?: string): string {
  const key = getEncryptionKey(keyBase64);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

/** Descifra y verifica la autenticidad del texto. Lanza si fue manipulado. */
export function decryptSecret(payload: string, keyBase64?: string): string {
  const [version, ivPart, tagPart, dataPart] = payload.split(".");
  if (version !== VERSION || !ivPart || !tagPart || !dataPart) {
    throw new Error("Formato de secreto cifrado no válido");
  }
  const key = getEncryptionKey(keyBase64);
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivPart, "base64url"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(dataPart, "base64url")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}

/** HMAC-SHA256 con una clave derivada de ENCRYPTION_KEY y una etiqueta de uso. */
export function signWithPurpose(purpose: string, data: string, keyBase64?: string): string {
  const key = getEncryptionKey(keyBase64);
  return createHmac("sha256", key).update(`${purpose}:${data}`).digest("base64url");
}
