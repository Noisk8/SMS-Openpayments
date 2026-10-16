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

  PAYMENT_PROVIDER: z.enum(["fake", "openpayments"]).default("fake"),
  PAYMENT_CURRENCY: z
    .string()
    .regex(/^[A-Z]{3}$/, "Debe ser un código ISO 4217 de 3 letras")
    .default("COP"),
  PAYMENT_ASSET_SCALE: z.coerce.number().int().min(0).max(12).default(0),

  OP_CLIENT_WALLET_ADDRESS: z.string().default(""),
  OP_KEY_ID: z.string().default(""),
  OP_PRIVATE_KEY_PATH: z.string().default(""),
  /** Inline PEM of the signing key, for containers without a mounted file. */
  OP_PRIVATE_KEY_PEM: z.string().default(""),

  SMS_PROVIDER: z.enum(["mock", "twilio"]).default("mock"),
  SMS_FROM: z.string().min(1).default("+570000000000"),
  SMS_WEBHOOK_SECRET: z.string().default("dev-webhook-secret"),

  // Twilio (SMS_PROVIDER=twilio). TWILIO_WEBHOOK_URL is the public URL Twilio calls, byte for byte.
  TWILIO_ACCOUNT_SID: z.string().default(""),
  TWILIO_AUTH_TOKEN: z.string().default(""),
  TWILIO_WEBHOOK_URL: z.string().default(""),
})
  .superRefine((config, ctx) => {
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
    if (config.SMS_PROVIDER === "twilio") {
      for (const key of ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_WEBHOOK_URL"] as const) {
        if (!config[key]) {
          ctx.addIssue({ code: "custom", path: [key], message: `${key} es obligatoria con SMS_PROVIDER=twilio` });
        }
      }
    }
  });

export type AppConfig = z.infer<typeof envSchema>;

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
