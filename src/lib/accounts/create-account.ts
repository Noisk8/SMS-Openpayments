import type { AppContext } from "@/lib/context";
import { hashSecret, verifySecret } from "@/lib/crypto/password";
import { AppError } from "@/lib/errors";
import { sendTrackedSms } from "@/lib/sms/service";
import { parseCreateAccountInput, parseVerifyInput } from "@/lib/validation/schemas";
import {
  MAX_VERIFICATION_ATTEMPTS,
  VERIFICATION_TTL_MS,
  generateVerificationCode,
  verificationMessage,
} from "@/lib/accounts/verification";

export interface CrearCuentaInput {
  telefono: string;
  alias: string;
  clave?: string;
  walletAddress?: string;
}

export interface PublicAccount {
  id: string;
  telefono: string;
  alias: string;
  walletAddress: string;
  moneda: string;
  provider: string;
}

export interface CrearCuentaResult {
  success: true;
  verification: {
    id: string;
    telefono: string;
    expiresAt: string;
    estado: "PENDIENTE_VERIFICACION";
  };
}

export interface ConfirmarCuentaResult {
  success: true;
  account: PublicAccount;
}

/**
 * Paso 1 de crearCuenta: valida, comprueba disponibilidad y envía un código al celular.
 * La cuenta no existe hasta que el código se confirma (control del número).
 */
export async function crearCuenta(input: CrearCuentaInput, ctx: AppContext): Promise<CrearCuentaResult> {
  const data = parseCreateAccountInput(input);
  if (ctx.env.PAYMENT_PROVIDER === "openpayments" && !data.walletAddress) {
    throw new AppError("VALIDATION_FAILED", "Indica la wallet address existente de tu proveedor Open Payments.");
  }
  if (ctx.env.PAYMENT_PROVIDER === "mock" && data.walletAddress) {
    throw new AppError("VALIDATION_FAILED", "En modo mock no se acepta una wallet address externa.");
  }

  const rate = ctx.limits.verification.consume(`create:${data.telefono}`);
  if (!rate.allowed) {
    throw new AppError("RATE_LIMITED", "Demasiados intentos. Espera antes de volver a intentarlo.");
  }

  await assertAvailable(ctx, data.telefono, data.alias);

  const code = generateVerificationCode();
  const verification = await ctx.prisma.phoneVerification.create({
    data: {
      telefono: data.telefono,
      alias: data.alias,
      passwordHash: data.clave ? await hashSecret(data.clave) : null,
      walletAddress: data.walletAddress ?? null,
      codeHash: await hashSecret(code),
      expiresAt: new Date(Date.now() + VERIFICATION_TTL_MS),
    },
  });

  const sent = await sendTrackedSms(
    ctx,
    data.telefono,
    verificationMessage(code),
    "[código de verificación]",
  );
  if (!sent.success) {
    await ctx.prisma.phoneVerification.delete({ where: { id: verification.id } });
    throw new AppError("PROVIDER_ERROR", "No se pudo enviar el código de verificación.");
  }

  return {
    success: true,
    verification: {
      id: verification.id,
      telefono: data.telefono,
      expiresAt: verification.expiresAt.toISOString(),
      estado: "PENDIENTE_VERIFICACION",
    },
  };
}

/** Paso 2 de crearCuenta: confirma el código, crea el usuario y vincula su billetera. */
export async function confirmarCuenta(
  input: { telefono: string; codigo: string },
  ctx: AppContext,
): Promise<ConfirmarCuentaResult> {
  const data = parseVerifyInput(input);
  const rate = ctx.limits.verification.consume(`confirm:${data.telefono}`);
  if (!rate.allowed) {
    throw new AppError("RATE_LIMITED", "Demasiados intentos. Espera antes de volver a intentarlo.");
  }

  const pending = await ctx.prisma.phoneVerification.findFirst({
    where: { telefono: data.telefono, status: "PENDING" },
    orderBy: { createdAt: "desc" },
  });
  if (!pending) {
    throw new AppError("VERIFICATION_REQUIRED", "No hay una verificación pendiente para este número.");
  }
  if (pending.expiresAt.getTime() < Date.now()) {
    throw new AppError("VERIFICATION_EXPIRED", "El código venció. Solicita una nueva cuenta.");
  }
  if (pending.attempts >= MAX_VERIFICATION_ATTEMPTS) {
    throw new AppError("VERIFICATION_INVALID", "Se superó el número de intentos. Solicita un nuevo código.");
  }

  const matches = await verifySecret(pending.codeHash, data.codigo);
  if (!matches) {
    await ctx.prisma.phoneVerification.update({
      where: { id: pending.id },
      data: { attempts: { increment: 1 } },
    });
    throw new AppError("VERIFICATION_INVALID", "El código no es válido.");
  }

  await assertAvailable(ctx, data.telefono, pending.alias);

  const consumed = await ctx.prisma.phoneVerification.updateMany({
    where: { id: pending.id, status: "PENDING" },
    data: { status: "CONSUMED", consumedAt: new Date() },
  });
  if (consumed.count !== 1) {
    throw new AppError("VERIFICATION_REQUIRED", "La verificación ya fue utilizada.");
  }

  const user = await ctx.prisma.user.create({
    data: {
      telefono: data.telefono,
      alias: pending.alias,
      passwordHash: pending.passwordHash,
      phoneVerifiedAt: new Date(),
    },
  });

  let wallet;
  try {
    wallet = await ctx.payments.provisionWallet({
      userId: user.id,
      alias: user.alias,
      walletAddress: pending.walletAddress ?? undefined,
    });
  } catch (error) {
    await ctx.prisma.user.delete({ where: { id: user.id } });
    await ctx.prisma.phoneVerification.update({
      where: { id: pending.id },
      data: { status: "PENDING", consumedAt: null },
    });
    throw error;
  }

  return {
    success: true,
    account: {
      id: user.id,
      telefono: user.telefono,
      alias: user.alias,
      walletAddress: wallet.walletAddress,
      moneda: wallet.currency,
      provider: wallet.provider,
    },
  };
}

async function assertAvailable(ctx: AppContext, telefono: string, alias: string): Promise<void> {
  const [byPhone, byAlias] = await Promise.all([
    ctx.prisma.user.findUnique({ where: { telefono } }),
    ctx.prisma.user.findUnique({ where: { alias } }),
  ]);
  if (byPhone) {
    throw new AppError("PHONE_ALREADY_REGISTERED", "Ya existe una cuenta con este número.");
  }
  if (byAlias) {
    throw new AppError("ALIAS_UNAVAILABLE", "Ese alias ya está en uso.");
  }
}

