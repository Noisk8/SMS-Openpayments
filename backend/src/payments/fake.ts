import type { Amount } from "../domain";
import { AppError } from "../errors";
import { addAmounts, compareAmounts, subtractAmounts, toBigInt } from "./amount";
import type {
  CreateOutgoingPaymentInput,
  GrantedAccess,
  GrantBudgetUsage,
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
 * Proveedor de pagos falso, en memoria y determinista (modo local y pruebas).
 *
 * Reproduce el ciclo de vida del proveedor real (wallets, incoming-payment,
 * quote con expiración, grants interactivos, outgoing-payment con transición de
 * estado) y permite simular de forma explícita los fallos del dominio:
 * quote expirado, presupuesto de grant insuficiente, fondos insuficientes y
 * resultado incierto. No se marca COMPLETED un pago hasta que el recurso lo
 * confirma (lo decide el test mediante `setOutgoingPaymentStatus`).
 */

export interface FakeProviderOptions {
  /** Reloj inyectable para pruebas deterministas. */
  now?: () => Date;
  /** TTL por defecto de un quote, en ms. */
  quoteTtlMs?: number;
  /** Saldo por defecto de una wallet registrada. */
  defaultWalletBalance?: Amount;
  /** Límite por defecto del grant de outgoing-payment. */
  defaultGrantLimit?: Amount;
  /** Si es true, `requestOutgoingGrant` concede sin interacción. */
  nonInteractiveGrant?: boolean;
  /** Estado inicial de un outgoing-payment recién creado. */
  initialOutgoingStatus?: OutgoingPaymentStatus;
  /** TTL del access token emitido, en ms (0 = sin expiración). */
  accessTokenTtlMs?: number;
  /** Retardo artificial de la rotación, para probar la exclusión mutua. */
  rotationDelayMs?: number;
}

export interface RegisterWalletOptions {
  balance?: Amount;
  grantLimit?: Amount;
  grantSpent?: Amount;
}

interface FakeWallet {
  metadata: WalletMetadata;
  balance: Amount | null;
  grantLimit: Amount | null;
  grantSpent: Amount | null;
  insufficientFunds: boolean;
}

interface FakePendingGrant {
  walletAddress: string;
  limit: Amount;
  nonce: string;
  finishUri: string;
  continueUri: string;
  continueAccessToken: string;
  expectedInteractRef: string;
}

interface FakeGrantedToken {
  walletAddress: string;
  limit: Amount | null;
  spent: Amount | null;
  status: "active" | "rotated" | "cancelled" | "revoked";
  /** Management URI issued for this token (`access_token.manage`). */
  manageUri: string;
  /** Token expiry as ISO-8601 UTC, or null when the token does not expire. */
  expiresAt: string | null;
}

interface FakeQuote {
  id: string;
  walletAddress: string;
  receiver: string;
  debitAmount: Amount;
  receiveAmount: Amount;
  expiresAt: string | null;
}

interface FakeOutgoingPayment {
  id: string;
  walletAddress: string;
  quoteId: string;
  reference: string;
  accessToken: string;
  debitAmount: Amount;
  status: OutgoingPaymentStatus;
  sentAmount?: Amount;
  error?: string;
  failNextGet?: boolean;
}

export class FakePaymentProvider implements PaymentProvider {
  readonly name = "fake";

  private readonly now: () => Date;
  private readonly quoteTtlMs: number;
  private readonly defaultWalletBalance: Amount;
  private readonly defaultGrantLimit: Amount;
  private readonly nonInteractiveGrant: boolean;
  private readonly initialOutgoingStatus: OutgoingPaymentStatus;
  private readonly accessTokenTtlMs: number;
  private readonly rotationDelayMs: number;

  private seq = 0;
  private readonly wallets = new Map<string, FakeWallet>();
  private readonly quotes = new Map<string, FakeQuote>();
  private readonly incomingPayments = new Map<string, { id: string; walletAddress: string }>();
  private readonly pendingGrants = new Map<string, FakePendingGrant>();
  private readonly grantedTokens = new Map<string, FakeGrantedToken>();
  private readonly outgoingPayments = new Map<string, FakeOutgoingPayment>();
  private readonly failNextGetWallets = new Set<string>();
  private failNextCreate: AppError | null = null;
  private failNextRotationError: AppError | null = null;
  private lastGrantRequest: OutgoingGrantRequest | null = null;

  constructor(options: FakeProviderOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.quoteTtlMs = options.quoteTtlMs ?? 60_000;
    this.defaultWalletBalance = options.defaultWalletBalance ?? { value: "1000000", currency: "COP", assetScale: 0 };
    this.defaultGrantLimit = options.defaultGrantLimit ?? { value: "1000000", currency: "COP", assetScale: 0 };
    this.nonInteractiveGrant = options.nonInteractiveGrant ?? false;
    this.initialOutgoingStatus = options.initialOutgoingStatus ?? "PROCESSING";
    this.accessTokenTtlMs = options.accessTokenTtlMs ?? 600_000;
    this.rotationDelayMs = options.rotationDelayMs ?? 0;
  }

  // --- Controles de simulación (no forman parte de la frontera) --------------

  /** Registra (o reemplaza) una wallet con saldo y presupuesto de grant. */
  registerWallet(metadata: WalletMetadata, options: RegisterWalletOptions = {}): WalletMetadata {
    this.wallets.set(metadata.walletAddress, {
      metadata,
      balance: options.balance ?? this.defaultWalletBalance,
      grantLimit: options.grantLimit ?? this.defaultGrantLimit,
      grantSpent: options.grantSpent ?? null,
      insufficientFunds: false,
    });
    return metadata;
  }

  setWalletBalance(walletAddress: string, balance: Amount | null): void {
    this.requireWallet(walletAddress).balance = balance;
  }

  /** Marca la wallet como sin fondos: `createOutgoingPayment` fallará por fondos. */
  setInsufficientFunds(walletAddress: string, flag = true): void {
    this.requireWallet(walletAddress).insufficientFunds = flag;
  }

  setGrantLimit(walletAddress: string, limit: Amount | null): void {
    this.requireWallet(walletAddress).grantLimit = limit;
  }

  setGrantSpent(walletAddress: string, spent: Amount | null): void {
    this.requireWallet(walletAddress).grantSpent = spent;
  }

  /** Fuerza la expiración de un quote (equivalente a que haya vencido). */
  expireQuote(quoteId: string): void {
    const quote = this.quotes.get(quoteId);
    if (!quote) {
      throw new AppError("NOT_FOUND", `Quote desconocido: ${quoteId}`);
    }
    quote.expiresAt = new Date(this.now().getTime() - 1000).toISOString();
  }

  /** Fija el estado con el que se resolverá el recurso de un outgoing-payment. */
  setOutgoingPaymentStatus(id: string, status: OutgoingPaymentStatus, error?: string): void {
    const outgoing = this.requireOutgoing(id);
    this.applyOutgoingStatus(outgoing, status, error);
  }

  /** Hace que la siguiente consulta del recurso falle (resultado incierto). */
  failNextGetPayment(id: string): void {
    this.requireOutgoing(id).failNextGet = true;
  }

  /**
   * Hace que la próxima consulta de CUALQUIER outgoing-payment de la wallet
   * falle (útil cuando el recurso aún no existe en el momento de configurar).
   */
  failNextGetForWallet(walletAddress: string): void {
    this.failNextGetWallets.add(walletAddress);
  }

  /** Hace que la siguiente creación de outgoing-payment falle de forma incierta. */
  failNextCreatePayment(error?: AppError): void {
    this.failNextCreate =
      error ?? new AppError("PROVIDER_ERROR", "Timeout simulado al crear el outgoing-payment (resultado incierto).");
  }

  /** Expira un token emitido de inmediato (simula que venció el TTL del AS). */
  expireAccessToken(accessToken: string): void {
    const grant = this.grantedTokens.get(accessToken);
    if (!grant) {
      throw new AppError("NOT_FOUND", `Access token desconocido: ${accessToken}`);
    }
    grant.expiresAt = new Date(this.now().getTime() - 1000).toISOString();
  }

  /** Hace fallar la siguiente rotación (por defecto, error transitorio). */
  failNextRotation(error?: AppError): void {
    this.failNextRotationError =
      error ?? new AppError("PROVIDER_ERROR", "Fallo simulado al rotar el access token.");
  }

  /** Última petición de grant de outgoing recibida (para aserciones de `limits`). */
  lastOutgoingGrantRequest(): OutgoingGrantRequest | null {
    return this.lastGrantRequest;
  }

  /** URI de gestión emitida para un token (introspección para pruebas). */
  accessTokenManageUri(accessToken: string): string | null {
    return this.grantedTokens.get(accessToken)?.manageUri ?? null;
  }

  /** Expiración emitida para un token (introspección para pruebas). */
  accessTokenExpiry(accessToken: string): string | null {
    return this.grantedTokens.get(accessToken)?.expiresAt ?? null;
  }

  // --- WalletDirectory -------------------------------------------------------

  async getWalletMetadata(walletAddress: string): Promise<WalletMetadata> {
    return this.requireWallet(walletAddress).metadata;
  }

  // --- PaymentProvider -------------------------------------------------------

  async createIncomingPayment(input: {
    wallet: WalletMetadata;
    accessToken?: string;
    incomingAmount?: Amount;
  }): Promise<IncomingPayment> {
    const wallet = this.requireWallet(input.wallet.walletAddress);
    const id = `${wallet.metadata.walletAddress}/incoming-payments/${this.nextId("ip")}`;
    this.incomingPayments.set(id, { id, walletAddress: wallet.metadata.walletAddress });
    return { id };
  }

  async createQuote(input: {
    wallet: WalletMetadata;
    receiver: string;
    debitAmount?: Amount;
    receiveAmount?: Amount;
    accessToken?: string;
  }): Promise<Quote> {
    const wallet = this.requireWallet(input.wallet.walletAddress);
    const id = `${wallet.metadata.walletAddress}/quotes/${this.nextId("quote")}`;
    // El proveedor falso no aplica conversión cruzada: el importe indicado
    // (débito o recepción) se refleja igual en ambos lados.
    const amount = input.debitAmount ?? input.receiveAmount;
    if (!amount) {
      throw new AppError("VALIDATION_FAILED", "createQuote requiere debitAmount o receiveAmount.");
    }
    const quote: FakeQuote = {
      id,
      walletAddress: wallet.metadata.walletAddress,
      receiver: input.receiver,
      debitAmount: { ...amount },
      receiveAmount: { ...amount },
      expiresAt: new Date(this.now().getTime() + this.quoteTtlMs).toISOString(),
    };
    this.quotes.set(id, quote);
    return {
      id: quote.id,
      debitAmount: quote.debitAmount,
      receiveAmount: quote.receiveAmount,
      expiresAt: quote.expiresAt,
    };
  }

  async requestOutgoingGrant(input: OutgoingGrantRequest): Promise<PendingGrant | GrantedAccess> {
    this.requireWallet(input.wallet.walletAddress);
    this.lastGrantRequest = input;
    const limit = input.limit;
    if (this.nonInteractiveGrant) {
      return this.issueToken(input.wallet.walletAddress, limit);
    }
    const continueAccessToken = this.nextId("continue-token");
    const pending: FakePendingGrant = {
      walletAddress: input.wallet.walletAddress,
      limit,
      nonce: input.nonce,
      finishUri: input.finishUri,
      continueUri: `${input.wallet.authServer}/continue/${this.nextId("grant")}`,
      continueAccessToken,
      expectedInteractRef: `grant-${input.nonce}`,
    };
    this.pendingGrants.set(pending.continueUri, pending);
    return {
      kind: "pending",
      interactUrl: `${input.wallet.authServer}/interact/${input.nonce}`,
      continueUri: pending.continueUri,
      continueAccessToken,
    };
  }

  async continueGrant(input: {
    wallet: WalletMetadata;
    continueUri: string;
    continueAccessToken: string;
    interactRef: string;
  }): Promise<GrantedAccess | null> {
    const pending = this.pendingGrants.get(input.continueUri);
    if (!pending) {
      throw new AppError("NOT_FOUND", `No hay un grant pendiente en ${input.continueUri}`);
    }
    if (pending.continueAccessToken !== input.continueAccessToken) {
      throw new AppError("UNAUTHORIZED", "Token de continuación inválido.");
    }
    // `interactRef` distinto del esperado simula que el usuario denegó o no completó.
    if (input.interactRef !== pending.expectedInteractRef) {
      return null;
    }
    this.pendingGrants.delete(input.continueUri);
    return this.issueToken(pending.walletAddress, pending.limit);
  }

  async createOutgoingPayment(input: CreateOutgoingPaymentInput): Promise<OutgoingPayment> {
    const wallet = this.requireWallet(input.walletAddress);
    const quote = this.quotes.get(input.quoteId);
    if (!quote) {
      throw new AppError("NOT_FOUND", `Quote desconocido: ${input.quoteId}`);
    }

    if (this.failNextCreate) {
      const error = this.failNextCreate;
      this.failNextCreate = null;
      throw error;
    }

    const grant = this.grantedTokens.get(input.accessToken);

    // Presupuesto de autorización (grant) frente a fondos del origen: son errores distintos.
    if (grant?.limit && grant.spent) {
      const remaining = subtractAmounts(grant.limit, grant.spent);
      if (compareAmounts(quote.debitAmount, remaining) > 0) {
        throw new AppError(
          "INSUFFICIENT_GRANT_BUDGET",
          "El importe supera el presupuesto autorizado del grant.",
          { limit: grant.limit.value, spent: grant.spent.value, requested: quote.debitAmount.value },
        );
      }
    }
    if (wallet.insufficientFunds || (wallet.balance && compareAmounts(quote.debitAmount, wallet.balance) > 0)) {
      throw new AppError("INSUFFICIENT_FUNDS", "Fondos insuficientes en la wallet de origen.", {
        balance: wallet.balance?.value ?? null,
        requested: quote.debitAmount.value,
      });
    }

    const id = `${wallet.metadata.walletAddress}/outgoing-payments/${this.nextId("op")}`;
    const outgoing: FakeOutgoingPayment = {
      id,
      walletAddress: wallet.metadata.walletAddress,
      quoteId: quote.id,
      reference: input.reference,
      accessToken: input.accessToken,
      debitAmount: quote.debitAmount,
      status: this.initialOutgoingStatus,
    };
    this.applyOutgoingStatus(outgoing, this.initialOutgoingStatus);
    this.outgoingPayments.set(id, outgoing);
    return this.snapshot(outgoing);
  }

  async getOutgoingPayment(input: { url: string; accessToken: string }): Promise<OutgoingPayment> {
    const outgoing = this.requireOutgoing(input.url);
    const walletFail = this.failNextGetWallets.delete(outgoing.walletAddress);
    if (outgoing.failNextGet || walletFail) {
      outgoing.failNextGet = false;
      throw new AppError("PROVIDER_ERROR", "Timeout simulado al consultar el outgoing-payment.");
    }
    return this.snapshot(outgoing);
  }

  async getGrantUsage(input: { wallet: WalletMetadata; accessToken: string }): Promise<GrantBudgetUsage | null> {
    const grant = this.grantedTokens.get(input.accessToken);
    if (!grant || !grant.limit) {
      return null;
    }
    const spent = grant.spent ?? { ...grant.limit, value: "0" };
    return {
      limit: grant.limit,
      spent,
      remaining: subtractAmounts(grant.limit, spent),
    };
  }

  async cancelGrant(input: { wallet: WalletMetadata; accessToken: string }): Promise<void> {
    const grant = this.grantedTokens.get(input.accessToken);
    if (grant) {
      grant.status = "cancelled";
    }
  }

  async rotateAccessToken(input: {
    wallet: WalletMetadata;
    accessToken: string;
    manageUri?: string;
  }): Promise<GrantedAccess | null> {
    const grant = this.grantedTokens.get(input.accessToken);
    if (!grant || grant.status !== "active") {
      return null;
    }
    // Rotation only works while the current token is still valid.
    if (grant.expiresAt && Date.parse(grant.expiresAt) <= this.now().getTime()) {
      return null;
    }
    // The management URI must match the one issued with the token.
    if (input.manageUri !== undefined && input.manageUri !== grant.manageUri) {
      return null;
    }
    if (this.failNextRotationError) {
      const error = this.failNextRotationError;
      this.failNextRotationError = null;
      throw error;
    }
    if (this.rotationDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.rotationDelayMs));
    }
    grant.status = "rotated";
    return this.issueToken(grant.walletAddress, grant.limit ?? undefined, grant.spent ?? undefined);
  }

  async revokeAccessToken(input: { wallet: WalletMetadata; accessToken: string }): Promise<void> {
    const grant = this.grantedTokens.get(input.accessToken);
    if (grant) {
      grant.status = "revoked";
    }
  }

  // --- Utilidades internas ---------------------------------------------------

  private nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${this.seq}`;
  }

  private requireWallet(walletAddress: string): FakeWallet {
    const wallet = this.wallets.get(walletAddress);
    if (!wallet) {
      throw new AppError("NOT_FOUND", `Wallet no registrada en el proveedor falso: ${walletAddress}`);
    }
    return wallet;
  }

  private requireOutgoing(id: string): FakeOutgoingPayment {
    const outgoing = this.outgoingPayments.get(id);
    if (!outgoing) {
      throw new AppError("NOT_FOUND", `Outgoing-payment desconocido: ${id}`);
    }
    return outgoing;
  }

  private issueToken(walletAddress: string, limit?: Amount, spent?: Amount): GrantedAccess {
    const wallet = this.requireWallet(walletAddress);
    const token = this.nextId("access-token");
    const expiresAt =
      this.accessTokenTtlMs > 0
        ? new Date(this.now().getTime() + this.accessTokenTtlMs).toISOString()
        : null;
    const manageUri = `${wallet.metadata.authServer.replace(/\/$/, "")}/token/${token}`;
    this.grantedTokens.set(token, {
      walletAddress,
      limit: limit ?? null,
      spent: spent ?? (limit ? { ...limit, value: "0" } : null),
      status: "active",
      manageUri,
      expiresAt,
    });
    return { kind: "granted", accessToken: token, expiresAt, manageUri };
  }

  /** Aplica una transición de estado y contabiliza el consumo del grant. */
  private applyOutgoingStatus(outgoing: FakeOutgoingPayment, status: OutgoingPaymentStatus, error?: string): void {
    if (outgoing.status === "COMPLETED" && status !== "COMPLETED") {
      throw new AppError("CONFLICT", "Un outgoing-payment completado no puede cambiar de estado.");
    }
    outgoing.status = status;
    if (status === "COMPLETED") {
      const grant = this.grantedTokens.get(outgoing.accessToken);
      if (grant) {
        const spent = grant.spent ?? { ...outgoing.debitAmount, value: "0" };
        grant.spent = addAmounts(spent, outgoing.debitAmount);
      }
      outgoing.sentAmount = { ...outgoing.debitAmount };
      outgoing.error = undefined;
      return;
    }
    outgoing.sentAmount = undefined;
    outgoing.error = error;
  }

  private snapshot(outgoing: FakeOutgoingPayment): OutgoingPayment {
    return {
      id: outgoing.id,
      status: outgoing.status,
      sentAmount: outgoing.sentAmount ? { ...outgoing.sentAmount } : undefined,
      debitAmount: { ...outgoing.debitAmount },
      error: outgoing.error,
    };
  }

  /** Expone si un quote sigue vigente según el reloj del proveedor. */
  isQuoteExpired(quoteId: string): boolean {
    const quote = this.quotes.get(quoteId);
    if (!quote || !quote.expiresAt) {
      return false;
    }
    return Date.parse(quote.expiresAt) <= this.now().getTime();
  }

  /** Saldo consumido acumulado del grant (introspección para pruebas). */
  grantSpentValue(accessToken: string): bigint | null {
    const grant = this.grantedTokens.get(accessToken);
    if (!grant || !grant.spent) {
      return null;
    }
    return toBigInt(grant.spent);
  }
}
