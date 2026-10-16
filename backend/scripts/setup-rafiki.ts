import { existsSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL("../../", import.meta.url));
const envFile = resolve(root, "backend/.env");
let content = existsSync(envFile) ? readFileSync(envFile, "utf8") : "# Entorno local COP, exclusivamente de pruebas.\n";
const ensure = (key: string, value: string, replace = false) => {
  const pattern = new RegExp(`^${key}=(.*)$`, "m");
  const match = content.match(pattern);
  if (!match) content += `\n${key}=${value}\n`;
  else if (replace || !match[1]?.trim()) content = content.replace(pattern, `${key}=${value}`);
};
ensure("NODE_ENV", "development");
ensure("PORT", "3000");
ensure("PUBLIC_BASE_URL", "http://localhost:3000");
if (!/^DATABASE_URL=.+$/m.test(content)) {
  throw new Error("Configura DATABASE_URL en backend/.env con la base PostgreSQL existente antes de ejecutar este comando.");
}
ensure("PAYMENT_PROVIDER", "rafiki", true);
ensure("RAFIKI_TEST_MODE", "true", true);
ensure("PAYMENT_CURRENCY", "COP", true);
ensure("PAYMENT_ASSET_SCALE", "0", true);
ensure("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
ensure("ADMIN_API_TOKEN", randomBytes(32).toString("hex"));
ensure("RAFIKI_ADMIN_URL", "http://127.0.0.1:3101/graphql");
ensure("RAFIKI_WALLET_ADDRESS_BASE", "https://rafiki-backend:3000/accounts");
ensure("RAFIKI_TENANT_ID", randomUUID());
ensure("RAFIKI_API_SECRET", randomBytes(32).toString("base64"));
ensure("RAFIKI_STREAM_SECRET", randomBytes(32).toString("base64"));
ensure("RAFIKI_WEBHOOK_SECRET", randomBytes(32).toString("base64"));
ensure("RAFIKI_DB_ENCRYPTION_SECRET", randomBytes(32).toString("base64"));
ensure("RAFIKI_DB_PASSWORD", randomBytes(24).toString("hex"));
ensure("SMS_PROVIDER", "mock");
ensure("SMS_FROM", "+570000000000");
ensure("SMS_WEBHOOK_SECRET", randomBytes(32).toString("hex"));
ensure("TWILIO_ACCOUNT_SID", "");
ensure("TWILIO_AUTH_TOKEN", "");
ensure("TWILIO_WEBHOOK_URL", "");
writeFileSync(envFile, content, { mode: 0o600 });
chmodSync(envFile, 0o600);
console.log("Configurado backend/.env: Rafiki propio, COP y escala 0. Secretos existentes conservados. No se imprimen credenciales.");
