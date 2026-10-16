import { readFileSync } from "node:fs";
import type { KeyLike } from "node:crypto";
import {
  AccessAction,
  AccessType,
  OpenPaymentsClientError,
  createAuthenticatedClient,
  isPendingGrant,
  type AuthenticatedClient,
  type OutgoingPayment as OpOutgoingPayment,
  type Quote as OpQuote,
  type WalletAddress,
} from "@interledger/open-payments";
import type { AppConfig } from "../config";
import type { Amount } from "../domain";
import { AppError } from "../errors";
import { compareAmounts, sameAsset } from "./amount";
import type {
  CreateOutgoingPaymentInput,
  GrantedAccess,
  IncomingPayment,
  OutgoingGrantRequest,
  OutgoingPayment,
  OutgoingPaymentStatus,
  PaymentProvider,
  PendingGrant,
  Quote,
  WalletMetadata,
} from "./types";

/**
 * Proveedor real basado en `@interledger/open-payments` (v7).
 *
 * Reglas que respeta este adaptador:
 * - Nunca declara COMPLETED porque se haya creado el recurso: el estado sale de
 *   `outgoingPayment.get` (sentAmount vs debitAmount / `failed`).
 * - Los grants no interactivos (incoming-payment y quote) se solicitan aquí
 *   mismo cuando el llamador no aporta un access token.
 * - `getGrantUsage` devuelve null: la interfaz congelada no expone la URL de
 *   gestión del grant, así que el presupuesto no es consultable por esta vía.
 * - Algunas operaciones de gestión (cancel/rotate/revoke) requieren URIs que la
 *   frontera congelada no transporta; se aceptan como parámetros opcionales
 *   extendidos y, si faltan, se lanza un error explícito en vez de fallar en
 *   silencio.
 */

export interface OpenPaymentsProviderOptions {
  /** Wallet address del cliente que firma las peticiones. */
  walletAddressUrl: string;
  /** Identificador de la clave privada de firma. */
  keyId: string;
  /** Contenido PEM de la clave privada o ruta a un fichero con la clave. */
  privateKey: string | KeyLike;
  /** Timeout HTTP en ms. */
  requestTimeoutMs?: number;
  /** Cliente ya construido (inyectable en pruebas sin red). */
  client?: AuthenticatedClient;
}

/** Parámetros de gestión ampliados con las URIs que la frontera no transporta. */
export interface CancelGrantInput {
  wallet: WalletMetadata;
  accessToken: string;
  /** URI de continuación del grant (lo que el AS usa para cancelarlo). */
  continueUri?: string;
}

export interface TokenManagementInput {
  wallet: WalletMetadata;
  accessToken: string;
  /** URI de gestión del access token (`access_token.manage`). */
  manageUri?: string;
}

const OP_REQUEST_TIMEOUT_MS = 10_000;

export class OpenPaymentsProvider implements PaymentProvider {
  readonly name = "openpayments";

  private readonly options: OpenPaymentsProviderOptions;
  private clientPromise: Promise<AuthenticatedClient> | null = null;

  constructor(options: OpenPaymentsProviderOptions) {
    if (!options.walletAddressUrl) {
      throw new AppError("INTERNAL", "Falta OP_CLIENT_WALLET_ADDRESS para el proveedor Open Payments.");
    }
    this.options = options;
  }

  /** Construye el proveedor leyendo las credenciales de la configuración. */
  static fromConfig(config: AppConfig, overrides: Partial<OpenPaymentsProviderOptions> = {}): OpenPaymentsProvider {
    const privateKey = loadPrivateKey(config);
    return new OpenPaymentsProvider({
      walletAddressUrl: config.OP_CLIENT_WALLET_ADDRESS,
      keyId: config.OP_KEY_ID,
      privateKey,
      ...overrides,
    });
  }

  private client(): Promise<AuthenticatedClient> {
    if (!this.clientPromise) {
      this.clientPromise = this.options.client
        ? Promise.resolve(this.options.client)
        : createAuthenticatedClient({
            walletAddressUrl: this.options.walletAddressUrl,
            keyId: this.options.keyId,
            privateKey: this.options.privateKey,
            requestTimeoutMs: this.options.requestTimeoutMs ?? OP_REQUEST_TIMEOUT_MS,
          });
    }
    return this.clientPromise;
  }

  // --- WalletDirectory -------------------------------------------------------

  async getWalletMetadata(walletAddress: string): Promise<WalletMetadata> {
    return this.withProviderErrors("getWalletMetadata", async () => {
      const wallet = await (await this.client()).walletAddress.get({ url: walletAddress });
      return mapWalletMetadata(wallet);
    });
  }

  // --- PaymentProvider -------------------------------------------------------

  async createIncomingPayment(input: { wallet: WalletMetadata; accessToken?: string }): Promise<IncomingPayment> {
    return this.withProviderErrors("createIncomingPayment", async () => {
      const client = await this.client();
      const accessToken =
        input.accessToken ??
        (await this.nonInteractiveGrant(input.wallet, {
          type: AccessType.IncomingPayment,
          actions: [AccessAction.Create, AccessAction.ReadAll],
          identifier: input.wallet.walletAddress,
        }));
      const created = await client.incomingPayment.create(
        { url: input.wallet.resourceServer, accessToken },
        { walletAddress: input.wallet.walletAddress },
      );
      return { id: created.id };
    });
  }

  async createQuote(input: {
    wallet: WalletMetadata;
    receiver: string;
    debitAmount?: Amount;
    receiveAmount?: Amount;
    accessToken?: string;
  }): Promise<Quote> {
    return this.withProviderErrors("createQuote", async () => {
      const client = await this.client();
      const accessToken =
        input.accessToken ??
        (await this.nonInteractiveGrant(input.wallet, {
          type: AccessType.Quote,
          actions: [AccessAction.Create],
          identifier: input.wallet.walletAddress,
        }));
      // The quote can be pinned to either side; the API takes exactly one amount.
      if (!input.debitAmount && !input.receiveAmount) {
        throw new AppError("VALIDATION_FAILED", "createQuote requiere debitAmount o receiveAmount.");
      }
      const target = { walletAddress: input.wallet.walletAddress, receiver: input.receiver, method: "ilp" as const };
      const args = { url: input.wallet.resourceServer, accessToken };
      const quote = input.debitAmount
        ? await client.quote.create(args, { ...target, debitAmount: toOpAmount(input.debitAmount) })
        : await client.quote.create(args, { ...target, receiveAmount: toOpAmount(input.receiveAmount!) });
      return mapQuote(quote);
    });
  }

  async requestOutgoingGrant(input: OutgoingGrantRequest): Promise<PendingGrant | GrantedAccess> {
    return this.withProviderErrors("requestOutgoingGrant", async () => {
      const client = await this.client();
      const grant = await client.grant.request(
        { url: input.wallet.authServer },
        {
          access_token: {
            access: [
              {
                type: AccessType.OutgoingPayment,
                actions: [AccessAction.Create, AccessAction.Read],
                identifier: input.wallet.walletAddress,
                limits: {
                  debitAmount: toOpAmount(input.limit),
                  ...(input.interval ? { interval: input.interval } : {}),
                },
              },
            ] as never,
          },
          interact: {
            start: ["redirect"],
            finish: { method: "redirect", uri: input.finishUri, nonce: input.nonce },
          },
        },
      );

      if (isPendingGrant(grant)) {
        return {
          kind: "pending",
          interactUrl: grant.interact.redirect,
          continueUri: grant.continue.uri,
          continueAccessToken: grant.continue.access_token.value,
        };
      }
      const granted = toGrantedAccess(grant.access_token);
      if (!granted) {
        throw new AppError("PROVIDER_ERROR", "El grant de outgoing-payment no devolvió access token.");
      }
      return granted;
    });
  }

  async continueGrant(input: {
    wallet: WalletMetadata;
    continueUri: string;
    continueAccessToken: string;
    interactRef: string;
  }): Promise<GrantedAccess | null> {
    return this.withProviderErrors("continueGrant", async () => {
      const client = await this.client();
      const grant = await client.grant.continue(
        { url: input.continueUri, accessToken: input.continueAccessToken },
        { interact_ref: input.interactRef },
      );
      // Un grant aún no finalizado no autoriza todavía: se trata como no concedido.
      return "access_token" in grant ? toGrantedAccess(grant.access_token) : null;
    });
  }

  async createOutgoingPayment(input: CreateOutgoingPaymentInput): Promise<OutgoingPayment> {
    return this.withProviderErrors("createOutgoingPayment", async () => {
      const client = await this.client();
      // The resource server (not the wallet address) hosts the outgoing-payments endpoint.
      const wallet = await this.getWalletMetadata(input.walletAddress);
      const outgoing = await client.outgoingPayment.create(
        { url: wallet.resourceServer, accessToken: input.accessToken },
        {
          walletAddress: wallet.walletAddress,
          quoteId: input.quoteId,
          metadata: { reference: input.reference },
        },
      );
      return mapOutgoingPayment(outgoing);
    });
  }

  async getOutgoingPayment(input: { url: string; accessToken: string }): Promise<OutgoingPayment> {
    return this.withProviderErrors("getOutgoingPayment", async () => {
      const client = await this.client();
      const outgoing = await client.outgoingPayment.get({ url: input.url, accessToken: input.accessToken });
      return mapOutgoingPayment(outgoing);
    });
  }

  async getGrantUsage(): Promise<null> {
    // No soportado por esta frontera: falta la URL de gestión del grant.
    return null;
  }

  async cancelGrant(input: CancelGrantInput): Promise<void> {
    const { continueUri } = input;
    if (!continueUri) {
      throw new AppError(
        "PROVIDER_ERROR",
        "cancelGrant requiere `continueUri`: la frontera congelada no transporta la URI de continuación del grant.",
      );
    }
    await this.withProviderErrors("cancelGrant", async () => {
      const client = await this.client();
      await client.grant.cancel({ url: continueUri, accessToken: input.accessToken });
    });
  }

  async rotateAccessToken(input: TokenManagementInput): Promise<GrantedAccess | null> {
    const { manageUri } = input;
    if (!manageUri) {
      throw new AppError(
        "PROVIDER_ERROR",
        "rotateAccessToken requiere `manageUri`: la frontera congelada no transporta la URI de gestión del token.",
      );
    }
    return this.withProviderErrors("rotateAccessToken", async () => {
      const client = await this.client();
      const rotated = await client.token.rotate({ url: manageUri, accessToken: input.accessToken });
      return toGrantedAccess(rotated.access_token);
    });
  }

  async revokeAccessToken(input: TokenManagementInput): Promise<void> {
    const { manageUri } = input;
    if (!manageUri) {
      throw new AppError(
        "PROVIDER_ERROR",
        "revokeAccessToken requiere `manageUri`: la frontera congelada no transporta la URI de gestión del token.",
      );
    }
    await this.withProviderErrors("revokeAccessToken", async () => {
      const client = await this.client();
      await client.token.revoke({ url: manageUri, accessToken: input.accessToken });
    });
  }

  // --- Utilidades internas ---------------------------------------------------

  /** Solicita un grant no interactivo (incoming-payment o quote) y devuelve su token. */
  private async nonInteractiveGrant(
    wallet: WalletMetadata,
    access: { type: AccessType; actions: string[]; identifier: string },
  ): Promise<string> {
    const client = await this.client();
    const grant = await client.grant.request(
      { url: wallet.authServer },
      {
        access_token: { access: [access as never] },
      },
    );
    if (isPendingGrant(grant)) {
      throw new AppError("PROVIDER_ERROR", "Se esperaba un grant no interactivo, pero el AS pidió interacción.");
    }
    if (!grant.access_token?.value) {
      throw new AppError("PROVIDER_ERROR", "El grant no interactivo no devolvió access token.");
    }
    return grant.access_token.value;
  }

  /** Envuelve los errores del cliente OP en errores de dominio estables. */
  private async withProviderErrors<T>(operation: string, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      if (error instanceof OpenPaymentsClientError) {
        throw mapClientError(operation, error);
      }
      throw new AppError("PROVIDER_ERROR", `Error de proveedor en ${operation}: ${errorMessage(error)}`);
    }
  }
}

// --- Mapeos ------------------------------------------------------------------

function mapWalletMetadata(wallet: WalletAddress): WalletMetadata {
  return {
    walletAddress: wallet.id,
    currency: wallet.assetCode,
    assetScale: wallet.assetScale,
    authServer: wallet.authServer,
    resourceServer: wallet.resourceServer,
  };
}

function toOpAmount(amount: Amount): { value: string; assetCode: string; assetScale: number } {
  return { value: amount.value, assetCode: amount.currency, assetScale: amount.assetScale };
}

function fromOpAmount(amount: { value: string; assetCode: string; assetScale: number }): Amount {
  return { value: amount.value, currency: amount.assetCode, assetScale: amount.assetScale };
}

function mapQuote(quote: OpQuote): Quote {
  return {
    id: quote.id,
    debitAmount: fromOpAmount(quote.debitAmount),
    receiveAmount: fromOpAmount(quote.receiveAmount),
    expiresAt: quote.expiresAt ?? null,
  };
}

/**
 * El recurso outgoing-payment no expone un campo `status`: se deriva.
 * COMPLETED exige que `sentAmount` cubra `debitAmount`; `failed` implica FAILED;
 * cualquier otro caso sigue en PROCESSING.
 */
function mapOutgoingPayment(outgoing: OpOutgoingPayment): OutgoingPayment {
  const debitAmount = fromOpAmount(outgoing.debitAmount);
  const sentAmount = fromOpAmount(outgoing.sentAmount);
  let status: OutgoingPaymentStatus = "PROCESSING";
  if (outgoing.failed) {
    status = "FAILED";
  } else if (sameAsset(sentAmount, debitAmount) && compareAmounts(sentAmount, debitAmount) >= 0) {
    status = "COMPLETED";
  }
  return {
    id: outgoing.id,
    status,
    sentAmount,
    debitAmount,
    error: outgoing.failed ? "El recurso marca el pago como fallido." : undefined,
  };
}

function toGrantedAccess(
  accessToken: { value: string; expires_in?: number; manage?: string } | undefined,
): GrantedAccess | null {
  if (!accessToken?.value) {
    return null;
  }
  return {
    kind: "granted",
    accessToken: accessToken.value,
    expiresAt: accessToken.expires_in
      ? new Date(Date.now() + accessToken.expires_in * 1000).toISOString()
      : null,
    manageUri: accessToken.manage ?? null,
  };
}

function mapClientError(operation: string, error: OpenPaymentsClientError): AppError {
  const haystack = `${error.code ?? ""} ${error.description ?? ""} ${error.message ?? ""}`.toLowerCase();
  if (haystack.includes("budget") || haystack.includes("limit") || haystack.includes("grant")) {
    if (haystack.includes("insufficient") || haystack.includes("exceed") || error.status === 403) {
      return new AppError("INSUFFICIENT_GRANT_BUDGET", `Presupuesto de grant insuficiente en ${operation}.`, {
        status: error.status,
        code: error.code,
      });
    }
  }
  if (haystack.includes("funds") || haystack.includes("balance")) {
    return new AppError("INSUFFICIENT_FUNDS", `Fondos insuficientes en ${operation}.`, {
      status: error.status,
      code: error.code,
    });
  }
  if (error.status === 401) {
    return new AppError("UNAUTHORIZED", `No autorizado en ${operation}.`, { code: error.code });
  }
  return new AppError("PROVIDER_ERROR", `Error de Open Payments en ${operation}: ${error.description}`, {
    status: error.status,
    code: error.code,
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Resolves the signing key: an inline PEM (containers) takes precedence over a file path.
 * Environment variables often carry the PEM with escaped newlines.
 */
function loadPrivateKey(config: AppConfig): string {
  if (config.OP_PRIVATE_KEY_PEM) {
    return config.OP_PRIVATE_KEY_PEM.replace(/\\n/g, "\n");
  }
  if (config.OP_PRIVATE_KEY_PATH) {
    return readFileSync(config.OP_PRIVATE_KEY_PATH, "utf8");
  }
  throw new AppError(
    "INTERNAL",
    "Falta OP_PRIVATE_KEY_PATH o OP_PRIVATE_KEY_PEM para el proveedor Open Payments.",
  );
}
