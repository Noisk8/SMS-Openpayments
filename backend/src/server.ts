import { buildApp } from "./app";
import { loadConfig } from "./config";
import { createDatabase } from "./db";
import { registerJobHandlers } from "./jobs/handlers";
import { JobProcessor } from "./jobs/processor";
import { createPaymentProvider } from "./payments/provider-factory";
import { SecretBox } from "./security/encryption";
import { createSmsProvider } from "./sms/provider-factory";

const JOB_POLL_MS = 500;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const config = loadConfig();
  const db = await createDatabase(config.DATABASE_URL);
  const provider = createSmsProvider(config);
  const paymentProvider = createPaymentProvider(config);
  const secretBox = config.ENCRYPTION_KEY ? new SecretBox(config.ENCRYPTION_KEY) : null;

  if (!secretBox && config.PAYMENT_PROVIDER === "openpayments") {
    throw new Error("ENCRYPTION_KEY is required to persist Open Payments credentials.");
  }

  const app = buildApp({ config, db, provider, paymentProvider, secretBox });

  const processor = new JobProcessor({ db });
  registerJobHandlers(processor, {
    config,
    db,
    provider: paymentProvider,
    sms: provider,
    secretBox,
  });

  await app.listen({ port: config.PORT, host: "0.0.0.0" });

  // Inspect interrupted work before serving new jobs (spec §12): never replay blind.
  const recovered = await processor.recoverExpiredLeases();
  if (recovered > 0) {
    app.log.info(`Recovered ${recovered} interrupted job lease(s).`);
  }

  let running = true;
  const loop = async (): Promise<void> => {
    while (running) {
      try {
        const processed = await processor.runOnce();
        if (!processed) {
          await delay(JOB_POLL_MS);
        }
      } catch (error) {
        app.log.error({ err: error }, "job processor error");
        await delay(1000);
      }
    }
  };
  void loop();

  const shutdown = async (): Promise<void> => {
    running = false;
    await app.close();
    await db.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
