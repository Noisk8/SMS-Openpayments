import { encryptSecret } from "@/lib/crypto/encryption";
import type { AppContext } from "@/lib/context";
import type { SendSmsResult } from "@/lib/sms/types";

/**
 * Envía un SMS y lo registra. `recordedBody` permite registrar una versión sin secretos
 * (por ejemplo, sin el código de verificación).
 */
export async function sendTrackedSms(
  ctx: Pick<AppContext, "sms" | "prisma">,
  to: string,
  body: string,
  recordedBody: string = body,
): Promise<SendSmsResult> {
  const result = await ctx.sms.sendSms({ to, body });
  await ctx.prisma.smsMessage.create({
    data: {
      provider: ctx.sms.name,
      providerMessageId: result.messageId ?? null,
      direction: "OUTBOUND",
      from: "app",
      to,
      bodyEncrypted: encryptSecret(recordedBody),
      status: result.success ? "SENT" : "FAILED",
    },
  });
  return result;
}

/** Retención limitada: elimina mensajes registrados más antiguos que `days`. */
export async function purgeOldSmsMessages(ctx: Pick<AppContext, "prisma">, days: number): Promise<number> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const result = await ctx.prisma.smsMessage.deleteMany({ where: { createdAt: { lt: cutoff } } });
  return result.count;
}
