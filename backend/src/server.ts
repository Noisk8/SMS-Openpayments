import { buildApp } from "./app";
import { loadConfig } from "./config";
import { createDatabase } from "./db";
import { createPaymentProvider } from "./payments/provider-factory";
import { SecretBox } from "./security/encryption";
import { createSmsProvider } from "./sms/provider-factory";

async function main(): Promise<void> {
  const config = loadConfig();
  const db = createDatabase(config.SQLITE_PATH);
  const provider = createSmsProvider(config);
  const paymentProvider = createPaymentProvider(config);
  const secretBox = config.ENCRYPTION_KEY ? new SecretBox(config.ENCRYPTION_KEY) : null;

  if (!secretBox && config.PAYMENT_PROVIDER === "openpayments") {
    throw new Error("ENCRYPTION_KEY is required to persist Open Payments credentials.");
  }

  const app = buildApp({ config, db, provider, paymentProvider, secretBox });

  await app.listen({ port: config.PORT, host: "0.0.0.0" });

  const shutdown = async (): Promise<void> => {
    await app.close();
    db.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
