import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  findRegisteredKey,
  jwksUrl,
  keyMatchesPrivate,
  matchesAsset,
  publicJwkFromPrivateKey,
} from "../src/payments/test-wallet-check";

function ed25519Pair() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privatePem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    publicJwk: { ...publicKey.export({ format: "jwk" }), kid: "key-1", alg: "EdDSA" },
  };
}

describe("test wallet preflight", () => {
  it("accepts the registered key that matches the private key", () => {
    const { privatePem, publicJwk } = ed25519Pair();
    expect(keyMatchesPrivate(publicJwk, privatePem)).toBe(true);
  });

  it("rejects a registered key from a different pair", () => {
    const first = ed25519Pair();
    const other = ed25519Pair();
    expect(keyMatchesPrivate(other.publicJwk, first.privatePem)).toBe(false);
  });

  it("rejects a missing or non-Ed25519 key", () => {
    const { privatePem, publicJwk } = ed25519Pair();
    expect(keyMatchesPrivate(undefined, privatePem)).toBe(false);
    expect(keyMatchesPrivate({ ...publicJwk, crv: "P-256" }, privatePem)).toBe(false);
  });

  it("finds the key by kid in a JWKS", () => {
    const { publicJwk } = ed25519Pair();
    expect(findRegisteredKey({ keys: [publicJwk] }, "key-1")).toBe(publicJwk);
    expect(findRegisteredKey({ keys: [publicJwk] }, "other")).toBeUndefined();
    expect(findRegisteredKey({}, "key-1")).toBeUndefined();
  });

  it("derives an Ed25519 public JWK from the private key", () => {
    const { privatePem, publicJwk } = ed25519Pair();
    const derived = publicJwkFromPrivateKey(privatePem);
    expect(derived.kty).toBe("OKP");
    expect(derived.crv).toBe("Ed25519");
    expect(derived.x).toBe(publicJwk.x);
  });

  it("compares asset code and scale exactly", () => {
    const expected = { currency: "COP", assetScale: 0 };
    expect(matchesAsset({ assetCode: "COP", assetScale: 0 }, expected)).toBe(true);
    expect(matchesAsset({ assetCode: "USD", assetScale: 2 }, expected)).toBe(false);
    expect(matchesAsset({ assetCode: "COP", assetScale: 2 }, expected)).toBe(false);
  });

  it("builds the JWKS url without double slashes", () => {
    expect(jwksUrl("https://ilp.example/alice/")).toBe("https://ilp.example/alice/jwks.json");
    expect(jwksUrl("https://ilp.example/alice")).toBe("https://ilp.example/alice/jwks.json");
  });
});
