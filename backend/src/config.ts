import "dotenv/config";
import { z } from "zod";

const envSchema = z
  .object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  PUBLIC_BASE_URL: z.string().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL es obligatoria"),

  ADMIN_API_TOKEN: z.string().min(1).default("dev-admin-token"),
  ENCRYPTION_KEY: z.string().default(""),
  JOB_WORKER_ENABLED: z.enum(["true", "false"]).default("true"),
  TEST_PASSWORD_LOGIN_ENABLED: z.enum(["true", "false"]).default("false"),

  PAYMENT_PROVIDER: z.enum(["fake", "openpayments"]).default("fake"),
  PAYMENT_CURRENCY: z
    .string()
    .regex(/^[A-Z]{3}$/, "Debe ser un código ISO 4217 de 3 letras")
    .default("COP"),
  PAYMENT_ASSET_SCALE: z.coerce.number().int().min(0).max(12).default(0),

  // Demo wallet pool: pre-created Open Payments wallets assigned at registration.
  // Server-side only: never accepted from clients and never returned to them.
  DEMO_WALLET_ASSIGNMENT_ENABLED: z.enum(["true", "false"]).default("false"),
  /** Amount the customer must RECEIVE on the automatic initial top-up (minor units). */
  DEMO_TOPUP_AMOUNT: z
    .string()
    .regex(/^\d+$/, "Debe ser un entero en unidades mínimas")
    .default("1000"),
  DEMO_TOPUP_CURRENCY: z
    .string()
    .regex(/^[A-Z]{3}$/, "Debe ser un código ISO 4217 de 3 letras")
    .default("COP"),
  DEMO_TOPUP_ASSET_SCALE: z.coerce.number().int().min(0).max(12).default(0),
  /** Hard ceiling for automated funding: the treasury debit can never exceed it. */
  DEMO_TOPUP_MAX_AMOUNT: z
    .string()
    .regex(/^\d+$/, "Debe ser un entero en unidades mínimas")
    .default("10000"),
  /**
   * Alias under which the pool's optional external recipient is pre-registered
   * for each assigned customer, so they can pay it with `PAGAR <amount> A <alias>`.
   */
  DEMO_EXTERNAL_ALIAS: z.string().trim().min(1).max(64).default("EXTERNAL"),


  OP_HISTORY_WALLET_ADDRESS: z.string().default(""),
  OP_HISTORY_KEY_ID: z.string().default(""),
  OP_HISTORY_PRIVATE_KEY_PATH: z.string().default(""),
  OP_CLIENT_WALLET_ADDRESS: z.string().default(""),
  OP_KEY_ID: z.string().default(""),
  OP_PRIVATE_KEY_PATH: z.string().default(""),
  /** Inline PEM of the signing key, for containers without a mounted file. */
  OP_PRIVATE_KEY_PEM: z.string().default(""),
  /**
   * Optional GNAP/ISO-8601 repeating interval for the outgoing-payment grant
   * budget window, e.g. `R1/2026-10-16T00:00:00Z/P1Y`. When empty the grant is
   * requested without `limits.interval`.
   */
  OP_GRANT_INTERVAL: z.string().default(""),

  SMS_PROVIDER: z.enum(["mock", "relayion"]).default("mock"),
  SMS_FROM: z.string().min(1).default("+570000000000"),
  SMS_WEBHOOK_SECRET: z.string().default("dev-webhook-secret"),

  // Relayion (SMS_PROVIDER=relayion). RELAYION_WEBHOOK_SECRET signs the webhook
  // payload (HMAC-SHA256 of the raw body); RELAYION_API_KEY authenticates API
  // calls. RELAYION_DEVICE_ID is an optional routing override.
  RELAYION_API_KEY: z.string().default(""),
  RELAYION_WEBHOOK_SECRET: z.string().default(""),
  RELAYION_DEVICE_ID: z.string().default(""),
})
  .superRefine((config, ctx) => {
    if (config.OP_GRANT_INTERVAL && !isValidGrantInterval(config.OP_GRANT_INTERVAL)) {
      ctx.addIssue({
        code: "custom",
        path: ["OP_GRANT_INTERVAL"],
        message:
          "OP_GRANT_INTERVAL debe ser un intervalo ISO-8601 repetido (p. ej. R1/2026-10-16T00:00:00Z/P1Y)",
      });
    }
    if (config.PAYMENT_PROVIDER === "openpayments") {
      for (const key of ["OP_CLIENT_WALLET_ADDRESS", "OP_KEY_ID"] as const) {
        if (!config[key]) {
          ctx.addIssue({
            code: "custom",
            path: [key],
            message: `${key} es obligatoria con PAYMENT_PROVIDER=openpayments`,
          });
        }
      }
      if (!config.OP_PRIVATE_KEY_PATH && !config.OP_PRIVATE_KEY_PEM) {
        ctx.addIssue({
          code: "custom",
          path: ["OP_PRIVATE_KEY_PEM"],
          message: "Define OP_PRIVATE_KEY_PATH o OP_PRIVATE_KEY_PEM con PAYMENT_PROVIDER=openpayments",
        });
      }
    }
    if (config.SMS_PROVIDER === "relayion") {
      for (const key of ["RELAYION_API_KEY", "RELAYION_WEBHOOK_SECRET"] as const) {
        if (!config[key]) {
          ctx.addIssue({ code: "custom", path: [key], message: `${key} es obligatoria con SMS_PROVIDER=relayion` });
        }
      }
    }
    if (config.DEMO_WALLET_ASSIGNMENT_ENABLED === "true") {
      const amount = BigInt(config.DEMO_TOPUP_AMOUNT);
      const max = BigInt(config.DEMO_TOPUP_MAX_AMOUNT);
      if (amount <= 0n) {
        ctx.addIssue({ code: "custom", path: ["DEMO_TOPUP_AMOUNT"], message: "El top-up inicial debe ser mayor que cero" });
      }
      if (max <= 0n || amount > max) {
        ctx.addIssue({
          code: "custom",
          path: ["DEMO_TOPUP_MAX_AMOUNT"],
          message: "DEMO_TOPUP_MAX_AMOUNT debe ser mayor o igual que DEMO_TOPUP_AMOUNT",
        });
      }
    }
  });

export type AppConfig = z.infer<typeof envSchema>;

/**
 * Loosely validates a GNAP/ISO-8601 repeating interval such as
 * `R1/2026-10-16T00:00:00Z/P1Y` (repetitions / start / period-or-end).
 * The Authorization Server is the authority on the interval semantics; here we
 * only reject clearly malformed input so a typo does not silently disable the
 * budget window.
 */
export function isValidGrantInterval(value: string): boolean {
  return /^R\d*\/[^/]+\/[^/]+$/.test(value);
}

let cached: AppConfig | undefined;

/** Valida el entorno una sola vez. Lanza un error claro si algo es inválido. */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  if (source === process.env && cached) {
    return cached;
  }
  const parsed = envSchema.parse(source);
  if (source === process.env) {
    cached = parsed;
  }
  return parsed;
}

export function resetConfigCache(): void {
  cached = undefined;
}

export const isProduction = (config: AppConfig): boolean => config.NODE_ENV === "production";
