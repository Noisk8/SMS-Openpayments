import { randomBytes, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import {
  createAuthenticatedClient,
  isPendingGrant,
  type AuthenticatedClient,
  type Grant,
  type GrantRequest,
  type OutgoingPayment,
} from "@interledger/open-payments";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { decryptSecret, encryptSecret } from "@/lib/crypto/encryption";
import { getEnv, requireEnv, type AppEnv } from "@/lib/config/env";
import { AppError } from "@/lib/errors";
import type {
  BalanceOutcome,
  PaymentProvider,
  ProvisionWalletInput,
  TransferOutcome,
  TransferRequest,
  WalletRef,
} from "@/lib/payments/types";
import { toWalletRef } from "@/lib/payments/providers/mock";

export const OPEN_PAYMENTS_CALLBACK_PATH = "/api/payments/authorizations";

interface OpenPaymentsConfig {
  walletAddressUrl: string;
  keyId: string;
  privateKeyPath: string;
  appUrl: string;
}

type WalletAddressInfo = Awaited<ReturnType<AuthenticatedClient["walletAddress"]["get"]>>;

/**
 * Adaptador de Open Payments basado en @interledger/open-payments.
 *
 * - La aplicación es un cliente con UNA clave Ed25519 (no se genera una clave por usuario).
 * - Los fondos viven en la billetera del proveedor (wallet address existente del usuario).
 * - Los permisos del usuario se obtienen con un interactive grant y se guardan cifrados.
 * - Un pago solo se da por completado cuando el recurso outgoing-payment lo confirma.
 *
 * Limitación: la verificación del parámetro `hash` del callback de interacción aún no está
 * implementada; el token solo se emite tras `grant.continue` con `interact_ref` válido.
 */
export class OpenPaymentsProvider implements PaymentProvider {
  readonly name = "openpayments";
  private clientPromise?: Promise<AuthenticatedClient>;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly config: OpenPaymentsConfig,
  ) {}

  static fromEnv(prisma: PrismaClient, env: AppEnv = getEnv()): OpenPaymentsProvider {
    const values = requireEnv(
      env,
      ["OPENPAYMENTS_CLIENT_WALLET_ADDRESS", "OPENPAYMENTS_KEY_ID", "OPENPAYMENTS_PRIVATE_KEY_PATH"],
      "Open Payments",
    );
    return new OpenPaymentsProvider(prisma, {
      walletAddressUrl: values.OPENPAYMENTS_CLIENT_WALLET_ADDRESS,
      keyId: values.OPENPAYMENTS_KEY_ID,
      privateKeyPath: resolve(values.OPENPAYMENTS_PRIVATE_KEY_PATH),
      appUrl: env.APP_URL,
    });
  }

  private client(): Promise<AuthenticatedClient> {
    if (!this.clientPromise) {
      this.clientPromise = createAuthenticatedClient({
        walletAddressUrl: this.config.walletAddressUrl,
        keyId: this.config.keyId,
        privateKey: this.config.privateKeyPath,
        logLevel: "silent",
      });
    }
    return this.clientPromise;
  }

  async provisionWallet(input: ProvisionWalletInput, tx?: Prisma.TransactionClient): Promise<WalletRef> {
    if (!input.walletAddress) {
      throw new AppError(
        "VALIDATION_FAILED",
        "Open Payments requiere una wallet address existente del proveedor.",
      );
    }
    const client = await this.client();
    const info = await client.walletAddress.get({ url: input.walletAddress });
    const db = tx ?? this.prisma;
    const wallet = await db.wallet.create({
      data: {
        userId: input.userId,
        provider: "openpayments",
        walletAddress: info.id,
        currency: info.assetCode,
        assetScale: info.assetScale,
      },
    });
    return toWalletRef(wallet);
  }

  /** Open Payments no ofrece una API universal de saldo para una wallet address. */
  async getBalance(): Promise<BalanceOutcome> {
    return { success: false, code: "BALANCE_NOT_SUPPORTED" };
  }

  async transfer(request: TransferRequest): Promise<TransferOutcome> {
    try {
      const existing = await this.findGrantedAuthorization(request.sender);
      const accessToken = existing ? decryptSecret(existing.encryptedAccessToken ?? "") : undefined;
      return await this.runTransfer(request, accessToken);
    } catch (error) {
      return this.handleProviderError(error);
    }
  }

  /**
   * Continúa el interactive grant tras la aprobación del usuario y ejecuta el pago pendiente.
   */
  async resumeAuthorization(authorizationId: string, interactRef: string, request: TransferRequest): Promise<TransferOutcome> {
    try {
      const authorization = await this.prisma.paymentAuthorization.findUnique({ where: { id: authorizationId } });
      if (!authorization || authorization.status !== "REQUIRES_AUTHORIZATION" || !authorization.continueUri) {
        throw new AppError("AUTHORIZATION_REQUIRED", "La autorización no está pendiente.");
      }
      const client = await this.client();
      const continueToken = decryptSecret(authorization.encryptedContinueToken ?? "");
      const grant = await client.grant.continue(
        { url: authorization.continueUri, accessToken: continueToken },
        { interact_ref: interactRef },
      );
      if (!isGrantWithToken(grant)) {
        await this.prisma.paymentAuthorization.update({
          where: { id: authorization.id },
          data: { status: "REVOKED", encryptedContinueToken: null },
        });
        return { status: "FAILED", reason: "El usuario no concedió la autorización." };
      }
      await this.prisma.paymentAuthorization.update({
        where: { id: authorization.id },
        data: {
          status: "GRANTED",
          encryptedAccessToken: encryptSecret(grant.access_token.value),
          encryptedContinueToken: null,
          continueUri: null,
          interactRedirectUrl: null,
          expiresAt: grant.access_token.expires_in
            ? new Date(Date.now() + grant.access_token.expires_in * 1000)
            : null,
        },
      });
      return await this.runTransfer(request, grant.access_token.value);
    } catch (error) {
      return this.handleProviderError(error);
    }
  }

  private async findGrantedAuthorization(sender: WalletRef) {
    if (!sender.userId) {
      return null;
    }
    const authorization = await this.prisma.paymentAuthorization.findFirst({
      where: {
        userId: sender.userId,
        walletId: sender.walletId,
        provider: this.name,
        status: "GRANTED",
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      orderBy: { createdAt: "desc" },
    });
    return authorization?.encryptedAccessToken ? authorization : null;
  }

  private async runTransfer(
    request: TransferRequest,
    outgoingAccessToken: string | undefined,
  ): Promise<TransferOutcome> {
    const client = await this.client();
    const senderWallet = await client.walletAddress.get({ url: request.sender.walletAddress });
    const receiverWallet = await client.walletAddress.get({ url: request.receiver.walletAddress });

    const incomingToken = await this.requireNonInteractiveToken(client, receiverWallet, [
      { type: "incoming-payment", actions: ["create", "read", "complete"] },
    ]);
    const incoming = await client.incomingPayment.create(
      { url: receiverWallet.resourceServer, accessToken: incomingToken },
      { walletAddress: receiverWallet.id },
    );

    const quoteToken = await this.requireNonInteractiveToken(client, senderWallet, [
      { type: "quote", actions: ["create", "read"] },
    ]);
    const quote = await client.quote.create(
      { url: senderWallet.resourceServer, accessToken: quoteToken },
      {
        walletAddress: senderWallet.id,
        receiver: incoming.id,
        method: "ilp",
        debitAmount: {
          value: request.amount.toString(),
          assetCode: senderWallet.assetCode,
          assetScale: senderWallet.assetScale,
        },
      },
    );

    if (!outgoingAccessToken) {
      return this.requestOutgoingAuthorization(request, senderWallet.id, senderWallet.authServer, quote.debitAmount);
    }

    const outgoing = await client.outgoingPayment.create(
      { url: senderWallet.resourceServer, accessToken: outgoingAccessToken },
      { walletAddress: senderWallet.id, quoteId: quote.id, metadata: { reference: request.reference } },
    );
    const current = await client.outgoingPayment.get({
      url: outgoing.id,
      accessToken: outgoingAccessToken,
    });
    return toPaymentOutcome(current, outgoing.id);
  }

  private async requestOutgoingAuthorization(
    request: TransferRequest,
    senderWalletId: string,
    senderAuthServer: string,
    debitAmount: { value: string; assetCode: string; assetScale: number },
  ): Promise<TransferOutcome> {
    const client = await this.client();
    const authorizationId = randomUUID();
    const nonce = randomBytes(16).toString("base64url");
    const finishUri = `${this.config.appUrl}${OPEN_PAYMENTS_CALLBACK_PATH}/${authorizationId}/callback`;

    const grant = await client.grant.request(
      { url: senderAuthServer },
      {
        access_token: {
          access: [
            {
              type: "outgoing-payment",
              actions: ["create", "read"],
              identifier: senderWalletId,
              limits: { debitAmount },
            },
          ],
        },
        interact: {
          start: ["redirect"],
          finish: { method: "redirect", uri: finishUri, nonce },
        },
      },
    );

    const userId = requireUserId(request);
    if (!isPendingGrant(grant)) {
      if (!isGrantWithToken(grant)) {
        throw new AppError("PROVIDER_ERROR", "Respuesta de autorización inesperada.");
      }
      await this.prisma.paymentAuthorization.create({
        data: {
          id: authorizationId,
          userId,
          walletId: request.sender.walletId,
          transactionId: request.transactionId,
          provider: this.name,
          status: "GRANTED",
          encryptedAccessToken: encryptSecret(grant.access_token.value),
          permissionType: "outgoing-payment",
          currency: debitAmount.assetCode,
        },
      });
      return this.runTransfer(request, grant.access_token.value);
    }

    await this.prisma.paymentAuthorization.create({
      data: {
        id: authorizationId,
        userId,
        walletId: request.sender.walletId,
        transactionId: request.transactionId,
        provider: this.name,
        status: "REQUIRES_AUTHORIZATION",
        encryptedContinueToken: encryptSecret(grant.continue.access_token.value),
        continueUri: grant.continue.uri,
        interactRedirectUrl: grant.interact.redirect,
        permissionType: "outgoing-payment",
        amountLimit: BigInt(debitAmount.value),
        currency: debitAmount.assetCode,
      },
    });
    return { status: "REQUIRES_AUTHORIZATION", authorizationId, redirectUrl: grant.interact.redirect };
  }

  private async requireNonInteractiveToken(
    client: AuthenticatedClient,
    wallet: WalletAddressInfo,
    access: AccessItems,
  ): Promise<string> {
    const grant = await client.grant.request({ url: wallet.authServer }, { access_token: { access } });
    if (!isGrantWithToken(grant)) {
      throw new AppError("PROVIDER_ERROR", "El proveedor requiere una autorización interactiva no soportada para este paso.");
    }
    return grant.access_token.value;
  }

  private handleProviderError(error: unknown): TransferOutcome {
    if (error instanceof AppError) {
      return { status: "FAILED", reason: error.message };
    }
    console.error("[openpayments] error del proveedor", error instanceof Error ? error.message : "desconocido");
    return { status: "FAILED", reason: "Error del proveedor de pagos. Intenta de nuevo más tarde." };
  }
}

type AccessItems = NonNullable<GrantRequest["access_token"]>["access"];

/**
 * Estado real de un pago saliente: COMPLETED solo cuando el importe enviado iguala al debitado.
 * Nunca se marca como exitoso solo porque la petición HTTP fue aceptada.
 */
function toPaymentOutcome(payment: OutgoingPayment, providerTransactionId: string): TransferOutcome {
  if (payment.failed) {
    return { status: "FAILED", reason: "El pago saliente no se pudo completar." };
  }
  if (payment.sentAmount.value === payment.debitAmount.value) {
    return { status: "COMPLETED", providerTransactionId };
  }
  return { status: "PROCESSING", providerTransactionId };
}

function requireUserId(request: TransferRequest): string {
  if (!request.sender.userId) {
    throw new AppError("ACCOUNT_NOT_ACTIVE", "La billetera de origen no pertenece a un usuario.");
  }
  return request.sender.userId;
}

function isGrantWithToken(
  grant: unknown,
): grant is Grant & { access_token: NonNullable<Grant["access_token"]> } {
  return (
    typeof grant === "object" &&
    grant !== null &&
    "access_token" in grant &&
    !!(grant as Grant).access_token
  );
}
