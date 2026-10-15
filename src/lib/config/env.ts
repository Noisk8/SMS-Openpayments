import { z } from "zod";

const booleanFromString = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  APP_URL: z.string().url().default("http://localhost:3000"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PAYMENT_PROVIDER: z.enum(["mock", "openpayments"]).default("mock"),
  SMS_PROVIDER: z.enum(["mock", "twilio", "onurix", "inalambria", "generic"]).default("mock"),
  MOCK_CURRENCY: z.string().regex(/^[A-Z]{3}$/).default("COP"),
  MOCK_ASSET_SCALE: z.coerce.number().int().min(0).max(12).default(0),
  ENCRYPTION_KEY: z.string().default(""),
  SMS_SIMULATOR_ENABLED: booleanFromString,
  SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
  /** Límite por transferencia en unidades mínimas del activo. */
  MAX_TRANSFER_MINOR: z.coerce.bigint().positive().default(2000000n),

  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_PHONE_NUMBER: z.string().optional(),

  ONURIX_API_KEY: z.string().optional(),
  ONURIX_CLIENT_ID: z.string().optional(),
  ONURIX_WEBHOOK_SECRET: z.string().optional(),

  INALAMBRIA_USER: z.string().optional(),
  INALAMBRIA_PASSWORD: z.string().optional(),

  GENERIC_SMS_API_URL: z.string().optional(),
  GENERIC_SMS_API_KEY: z.string().optional(),
  GENERIC_SMS_WEBHOOK_SECRET: z.string().optional(),

  OPENPAYMENTS_CLIENT_WALLET_ADDRESS: z.string().optional(),
  OPENPAYMENTS_KEY_ID: z.string().optional(),
  OPENPAYMENTS_PRIVATE_KEY_PATH: z.string().optional(),
});

export type AppEnv = z.infer<typeof envSchema>;

let cached: AppEnv | undefined;

/** Valida las variables de entorno una sola vez. Lanza error si falta algo obligatorio. */
export function getEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  if (source === process.env && cached) {
    return cached;
  }
  const parsed = envSchema.parse(source);
  if (source === process.env) {
    cached = parsed;
  }
  return parsed;
}

export function resetEnvCache(): void {
  cached = undefined;
}

/** Devuelve los campos requeridos por un proveedor y lanza si alguno falta. */
export function requireEnv<K extends keyof AppEnv>(
  env: AppEnv,
  keys: readonly K[],
  context: string,
): { [P in K]: string } {
  const missing = keys.filter((key) => {
    const value = env[key];
    return value === undefined || value === "";
  });
  if (missing.length > 0) {
    throw new Error(`Faltan variables de entorno para ${context}: ${missing.join(", ")}`);
  }
  const values: Partial<Record<K, string>> = {};
  for (const key of keys) {
    values[key] = String(env[key]);
  }
  return values as { [P in K]: string };
}
