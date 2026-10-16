import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { AppError } from "../errors";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;

/**
 * Cifra credenciales (tokens de acceso, tokens de continuación) con AES-256-GCM.
 * La clave vive fuera de la base y del repositorio (variable ENCRYPTION_KEY, 32 bytes base64).
 * Formato del payload: iv.tag.ciphertext (todo base64).
 */
export class SecretBox {
  private readonly key: Buffer;

  constructor(base64Key: string) {
    if (!base64Key) {
      throw new AppError("INTERNAL", "Falta ENCRYPTION_KEY para cifrar credenciales.");
    }
    const key = Buffer.from(base64Key, "base64");
    if (key.length !== 32) {
      throw new AppError("INTERNAL", "ENCRYPTION_KEY debe ser de 32 bytes en base64 (openssl rand -base64 32).");
    }
    this.key = key;
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [iv.toString("base64"), tag.toString("base64"), ciphertext.toString("base64")].join(".");
  }

  decrypt(payload: string): string {
    const [ivB64, tagB64, dataB64] = payload.split(".");
    if (!ivB64 || !tagB64 || !dataB64) {
      throw new AppError("INTERNAL", "Formato de secreto cifrado inválido.");
    }
    const decipher = createDecipheriv(ALGORITHM, this.key, Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64")),
      decipher.final(),
    ]);
    return plaintext.toString("utf8");
  }
}

/** Genera una clave válida (32 bytes base64) para usar en ENCRYPTION_KEY. */
export function generateEncryptionKey(): string {
  return randomBytes(32).toString("base64");
}
