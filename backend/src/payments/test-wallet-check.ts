import { createPublicKey } from "node:crypto";

/**
 * Comprobaciones de solo lectura para configurar una cuenta de prueba de Open Payments
 * (p. ej. Interledger Test Wallet). No firman peticiones, no crean grants y no mueven fondos.
 */

export interface PublicJwk {
  kty?: string;
  crv?: string;
  x?: string;
  kid?: string;
  alg?: string;
}

export interface AssetExpectation {
  currency: string;
  assetScale: number;
}

/** Deriva la clave pública Ed25519 (JWK) a partir de una clave privada en PEM. */
export function publicJwkFromPrivateKey(privateKeyPem: string): PublicJwk {
  return createPublicKey(privateKeyPem).export({ format: "jwk" }) as PublicJwk;
}

/** Devuelve la clave registrada con el kid indicado en el JWKS de la wallet. */
export function findRegisteredKey(jwks: { keys?: PublicJwk[] }, keyId: string): PublicJwk | undefined {
  return jwks.keys?.find((key) => key.kid === keyId);
}

/** True si la clave registrada es Ed25519 y corresponde a la clave privada indicada. */
export function keyMatchesPrivate(registered: PublicJwk | undefined, privateKeyPem: string): boolean {
  if (!registered || registered.kty !== "OKP" || registered.crv !== "Ed25519" || !registered.x) {
    return false;
  }
  const derived = publicJwkFromPrivateKey(privateKeyPem);
  return derived.kty === "OKP" && derived.crv === "Ed25519" && derived.x === registered.x;
}

/** True si la wallet expone exactamente el activo esperado (código y escala). */
export function matchesAsset(actual: { assetCode: string; assetScale: number }, expected: AssetExpectation): boolean {
  return actual.assetCode === expected.currency && actual.assetScale === expected.assetScale;
}

/** URL del JWKS de una wallet address, sin doble barra. */
export function jwksUrl(walletAddress: string): string {
  return `${walletAddress.replace(/\/+$/, "")}/jwks.json`;
}
