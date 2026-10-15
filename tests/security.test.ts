import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { decryptSecret, encryptSecret } from "@/lib/crypto/encryption";
import { hashSecret, verifySecret } from "@/lib/crypto/password";
import { assertSafeOutboundUrl } from "@/lib/sms/http-safety";
import { createSessionToken, verifySessionToken } from "@/lib/auth/session";
import { assertSimulatorEnabled } from "@/lib/dev/simulator-guard";
import { resetEnvCache } from "@/lib/config/env";
import { AppError } from "@/lib/errors";

const KEY = randomBytes(32).toString("base64");

describe("cifrado de secretos (AES-256-GCM)", () => {
  it("cifra y descifra sin exponer el texto plano", () => {
    const encrypted = encryptSecret("token-secreto", KEY);
    expect(encrypted).not.toContain("token-secreto");
    expect(decryptSecret(encrypted, KEY)).toBe("token-secreto");
  });

  it("detecta manipulación del texto cifrado", () => {
    const encrypted = encryptSecret("dato", KEY);
    const parts = encrypted.split(".");
    parts[3] = Buffer.from("otro").toString("base64url");
    expect(() => decryptSecret(parts.join("."), KEY)).toThrow();
  });

  it("rechaza claves de longitud incorrecta", () => {
    expect(() => encryptSecret("x", Buffer.alloc(8).toString("base64"))).toThrow();
  });
});

describe("hash de claves con Argon2id", () => {
  it("verifica la clave correcta y rechaza la incorrecta", async () => {
    const hash = await hashSecret("clave-segura-123");
    expect(hash.startsWith("$argon2id$")).toBe(true);
    expect(await verifySecret(hash, "clave-segura-123")).toBe(true);
    expect(await verifySecret(hash, "otra-clave")).toBe(false);
  });
});

describe("sesiones firmadas", () => {
  it("acepta un token válido y rechaza uno alterado o expirado", () => {
    const token = createSessionToken("11111111-2222-3333-4444-555555555555");
    expect(verifySessionToken(token)?.userId).toBe("11111111-2222-3333-4444-555555555555");
    const tampered = token.replace("11111111", "99999999");
    expect(verifySessionToken(tampered)).toBeNull();
    expect(verifySessionToken(token, Date.now() + 10 * 24 * 3600 * 1000)).toBeNull();
  });
});

describe("protección SSRF en URLs de proveedores", () => {
  it("permite HTTPS público", () => {
    expect(assertSafeOutboundUrl("https://api.proveedor.example/sms", false).hostname).toBe("api.proveedor.example");
  });

  it("rechaza destinos privados, locales y HTTP sin excepción", () => {
    expect(() => assertSafeOutboundUrl("https://10.0.0.5/sms", false)).toThrow(AppError);
    expect(() => assertSafeOutboundUrl("https://169.254.169.254/latest", false)).toThrow(AppError);
    expect(() => assertSafeOutboundUrl("https://localhost/sms", false)).toThrow(AppError);
    expect(() => assertSafeOutboundUrl("http://api.proveedor.example/sms", false)).toThrow(AppError);
  });
});

describe("simulador SMS", () => {
  it("queda deshabilitado en producción", () => {
    const previous = process.env.NODE_ENV;
    try {
      (process.env as Record<string, string>).NODE_ENV = "production";
      resetEnvCache();
      expect(() => assertSimulatorEnabled()).toThrow(AppError);
    } finally {
      (process.env as Record<string, string>).NODE_ENV = previous;
      resetEnvCache();
    }
  });

  it("está disponible en desarrollo y pruebas", () => {
    resetEnvCache();
    expect(() => assertSimulatorEnabled()).not.toThrow();
  });
});
