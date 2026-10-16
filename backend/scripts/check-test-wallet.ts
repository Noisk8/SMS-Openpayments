import { readFileSync } from "node:fs";
import { createUnauthenticatedClient } from "@interledger/open-payments";
import { loadConfig } from "../src/config";
import {
  findRegisteredKey,
  jwksUrl,
  keyMatchesPrivate,
  matchesAsset,
  type PublicJwk,
} from "../src/payments/test-wallet-check";

/**
 * Preflight de solo lectura para una cuenta de prueba (Interledger Test Wallet).
 *
 * Uso (desde backend/):
 *   npm run check:testwallet -- [wallet_emisor] [wallet_receptor]
 *
 * Comprueba: la wallet cliente (OP_CLIENT_WALLET_ADDRESS) publica OP_KEY_ID en su JWKS con la
 * clave de OP_PRIVATE_KEY_PATH, y las wallets indicadas usan el activo PAYMENT_CURRENCY /
 * PAYMENT_ASSET_SCALE. No imprime la clave privada.
 */

const config = loadConfig();
const failures: string[] = [];
const expected = { currency: config.PAYMENT_CURRENCY, assetScale: config.PAYMENT_ASSET_SCALE };

if (!config.OP_CLIENT_WALLET_ADDRESS) failures.push("Falta OP_CLIENT_WALLET_ADDRESS");
if (!config.OP_KEY_ID) failures.push("Falta OP_KEY_ID");
if (!config.OP_PRIVATE_KEY_PATH) failures.push("Falta OP_PRIVATE_KEY_PATH");

const client = await createUnauthenticatedClient({});

// 1. Wallets: activo y servidores de autorización.
const wallets = [config.OP_CLIENT_WALLET_ADDRESS, ...process.argv.slice(2)].filter(Boolean);
for (const url of wallets) {
  try {
    const wallet = await client.walletAddress.get({ url });
    const label = url === config.OP_CLIENT_WALLET_ADDRESS ? "client" : "wallet";
    console.log(`[${label}] ${url} asset=${wallet.assetCode} scale=${wallet.assetScale} authServer=${wallet.authServer}`);
    if (!matchesAsset(wallet, expected)) {
      failures.push(
        `${url} usa ${wallet.assetCode}/${wallet.assetScale}, se esperaba ${expected.currency}/${expected.assetScale}`,
      );
    }
  } catch (error) {
    failures.push(`No se pudo leer la wallet ${url}: ${(error as Error).message}`);
  }
}

// 2. Clave: el JWKS de la wallet cliente debe publicar la clave privada configurada con OP_KEY_ID.
if (config.OP_CLIENT_WALLET_ADDRESS && config.OP_KEY_ID && config.OP_PRIVATE_KEY_PATH) {
  try {
    const response = await fetch(jwksUrl(config.OP_CLIENT_WALLET_ADDRESS));
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const jwks = (await response.json()) as { keys?: PublicJwk[] };
    const registered = findRegisteredKey(jwks, config.OP_KEY_ID);
    const privateKeyPem = readFileSync(config.OP_PRIVATE_KEY_PATH, "utf8");
    if (!registered) {
      failures.push(`El JWKS de la wallet cliente no contiene kid=${config.OP_KEY_ID}`);
    } else if (!keyMatchesPrivate(registered, privateKeyPem)) {
      failures.push("La clave privada no corresponde a la clave publicada en el JWKS");
    } else {
      console.log(`[key] kid=${config.OP_KEY_ID} coincide con la clave privada (Ed25519)`);
    }
  } catch (error) {
    failures.push(`No se pudo verificar la clave: ${(error as Error).message}`);
  }
}

if (failures.length > 0) {
  console.error("\nPreflight NO superado:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log("\nPreflight superado. Nada se firmó ni se movió.");
