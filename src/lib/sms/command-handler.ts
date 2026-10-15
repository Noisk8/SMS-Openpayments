import { confirmarCuenta, crearCuenta } from "@/lib/accounts/create-account";
import { verSaldo } from "@/lib/balances/get-balance";
import type { AppContext } from "@/lib/context";
import { encryptSecret } from "@/lib/crypto/encryption";
import { AppError } from "@/lib/errors";
import { enviarDinero } from "@/lib/transfers/send-money";
import { parseCommand } from "@/lib/sms/command-parser";
import { sendTrackedSms } from "@/lib/sms/service";
import type { IncomingSms } from "@/lib/sms/types";

export interface SmsHandlingResult {
  duplicate: boolean;
  command: string;
  operation?: unknown;
  reply?: string;
}

const HELP_TEXT =
  "Comandos: CREAR <alias> | CONFIRMAR <código> | ENVIAR <monto> <teléfono> | SALDO";

/**
 * Procesa un SMS entrante. Es el mismo flujo para proveedores reales y para el simulador:
 * deduplicación por (proveedor, id), interpretación, operación de negocio y respuesta.
 */
export async function handleIncomingSms(message: IncomingSms, ctx: AppContext): Promise<SmsHandlingResult> {
  const duplicate = await recordInbound(message, ctx);
  if (duplicate) {
    return { duplicate: true, command: "DUPLICADO" };
  }

  const rate = ctx.limits.smsCommand.consume(`sms:${message.from}`);
  if (!rate.allowed) {
    return reply(ctx, message, "command.rate_limited", "Demasiados mensajes. Espera un minuto.");
  }

  let parsed;
  try {
    parsed = parseCommand(message.body);
  } catch (error) {
    return reply(ctx, message, "command.invalid", errorMessage(error));
  }

  try {
    switch (parsed.command) {
      case "CREAR": {
        const result = await crearCuenta({ telefono: message.from, alias: parsed.alias }, ctx);
        return { duplicate: false, command: "CREAR", operation: result };
      }
      case "CONFIRMAR": {
        const result = await confirmarCuenta({ telefono: message.from, codigo: parsed.code }, ctx);
        const text = `Cuenta creada. Alias: ${result.account.alias}. Teléfono: ${result.account.telefono}.`;
        return reply(ctx, message, "CONFIRMAR", text, result);
      }
      case "ENVIAR": {
        const userId = await requireUserId(ctx, message.from);
        const result = await enviarDinero(
          {
            origen: message.from,
            destino: parsed.destination,
            monto: parsed.amount,
            idempotencyKey: `sms:${message.provider}:${message.id}`,
            authorizationContext: { userId, channel: "sms" },
          },
          ctx,
        );
        const tx = result.transaction;
        const text = describeTransfer(tx.estado, tx.monto, tx.moneda, tx.destino, tx.reference);
        if (tx.estado === "COMPLETED") {
          await notifyReceiver(ctx, message.from, tx.destino, tx.monto, tx.moneda, tx.reference);
        }
        return reply(ctx, message, "ENVIAR", text, result);
      }
      case "SALDO": {
        const userId = await requireUserId(ctx, message.from);
        const result = await verSaldo(
          { telefono: message.from, authorizationContext: { userId, channel: "sms" } },
          ctx,
        );
        const text = result.success
          ? `Alias: ${result.alias}. Saldo: ${result.saldo} ${result.moneda}.`
          : "No es posible consultar el saldo de esta billetera.";
        return reply(ctx, message, "SALDO", text, result);
      }
      case "AYUDA":
        return reply(ctx, message, "AYUDA", HELP_TEXT);
      default:
        return reply(ctx, message, "DESCONOCIDO", `Comando no reconocido. ${HELP_TEXT}`);
    }
  } catch (error) {
    if (error instanceof AppError) {
      return reply(ctx, message, parsed.command, error.message);
    }
    console.error("[sms] error procesando comando", error instanceof Error ? error.message : "desconocido");
    return reply(ctx, message, parsed.command, "Ocurrió un error. Intenta de nuevo más tarde.");
  }
}

async function recordInbound(message: IncomingSms, ctx: AppContext): Promise<boolean> {
  try {
    await ctx.prisma.smsMessage.create({
      data: {
        provider: message.provider,
        providerMessageId: message.id,
        direction: "INBOUND",
        from: message.from,
        to: message.to,
        bodyEncrypted: encryptSecret(message.body),
        status: "RECEIVED",
      },
    });
    return false;
  } catch (error) {
    if (typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002") {
      return true;
    }
    throw error;
  }
}

async function requireUserId(ctx: AppContext, telefono: string): Promise<string> {
  const user = await ctx.prisma.user.findUnique({ where: { telefono } });
  if (!user || !user.phoneVerifiedAt) {
    throw new AppError("ACCOUNT_NOT_FOUND", "No tienes una cuenta. Envía CREAR <alias> para registrarte.");
  }
  return user.id;
}

async function reply(
  ctx: AppContext,
  message: IncomingSms,
  command: string,
  text: string,
  operation?: unknown,
): Promise<SmsHandlingResult> {
  await sendTrackedSms(ctx, message.from, text);
  return { duplicate: false, command, operation, reply: text };
}

function describeTransfer(estado: string, monto: string, moneda: string, destino: string, reference: string): string {
  const destinoCorto = destino.replace(/^\+57/, "");
  switch (estado) {
    case "COMPLETED":
      return `Transferencia exitosa. Monto: ${monto} ${moneda}. Destino: ${destinoCorto}. Referencia: ${reference}`;
    case "PROCESSING":
      return `Transferencia en proceso. Referencia: ${reference}`;
    case "REQUIRES_AUTHORIZATION":
      return `Transferencia pendiente. Se requiere autorización segura. Referencia: ${reference}`;
    default:
      return `No se pudo completar la transferencia. Referencia: ${reference}`;
  }
}

async function notifyReceiver(
  ctx: AppContext,
  fromPhone: string,
  toPhone: string,
  monto: string,
  moneda: string,
  reference: string,
): Promise<void> {
  const sender = await ctx.prisma.user.findUnique({ where: { telefono: fromPhone } });
  await sendTrackedSms(
    ctx,
    toPhone,
    `Recibiste ${monto} ${moneda} de ${sender?.alias ?? "un usuario"}. Referencia: ${reference}`,
  );
}

function errorMessage(error: unknown): string {
  return error instanceof AppError ? error.message : "No se pudo interpretar el mensaje.";
}

