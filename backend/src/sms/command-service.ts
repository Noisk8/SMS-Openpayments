import { randomBytes, randomInt, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import type { AppConfig } from "../config";
import type { Db } from "../db";
import type { Amount, PaymentState } from "../domain";
import { formatForDisplay } from "../payments/amount";
import { scheduleGrantTokenRotation } from "../jobs/rotation";
import {
  executePayment,
  preparePayment,
  requestOutgoingAccess,
  type PaymentServiceDeps,
} from "../payments/service";
import type { PaymentProvider } from "../payments/types";
import {
  getWalletRow,
  normalizePhone,
  recordAudit,
  rowToWalletMetadata,
  type UserRow,
  type WalletRow,
} from "../onboarding/service";
import { getRecipientByAlias } from "../recipients/service";
import type { SecretBox } from "../security/encryption";
import { isPast, isoPlusSeconds, nowIso } from "../util/time";
import type { InboundSms, SmsProvider } from "./types";

/**
 * SMS command engine (spec §9, §12, §13).
 *
 * Authenticates the sender by phone, turns `PAGAR` into a prepared payment with a
 * one-time confirmation code, applies `CONFIRMAR`/`CANCELAR`, and answers `ESTADO`.
 * The reply is returned to the caller; delivery goes through `sendOutboundSms`
 * (see the `process_inbound_sms` job handler), which keeps this module free of
 * transport concerns.
 */

export interface CommandServiceDeps {
  config: AppConfig;
  db: Db;
  provider: PaymentProvider;
  sms: SmsProvider;
  secretBox: SecretBox | null;
}

export interface CommandOutcome {
  reply: string;
  /** Payment id when the command produced or referenced a payment. */
  paymentId?: string;
  /** Persisted payment state after the command, when applicable. */
  state?: PaymentState;
}

export const CONFIRMATION_TTL_SECONDS = 300;
export const CONFIRMATION_MAX_ATTEMPTS = 5;

export const HELP_TEXT = [
  "Comandos disponibles:",
  "PAGAR <monto> [MONEDA] A <alias>",
  "CONFIRMAR <codigo>",
  "CANCELAR <codigo>",
  "ESTADO <referencia>",
  "AYUDA",
].join("\n");

export const UNKNOWN_COMMAND_REPLY = "Comando no reconocido. Escribe AYUDA.";

const NOT_REGISTERED_REPLY =
  "No encontramos una cuenta asociada a este número. Regístrate o contacta a soporte.";
const NOT_VERIFIED_REPLY =
  "Tu número aún no está verificado. Completa la verificación para enviar pagos.";
const SUSPENDED_REPLY = "Tu cuenta está suspendida. Contacta a soporte para reactivarla.";
const NO_WALLET_REPLY =
  "No tienes una wallet vinculada. Completa la vinculación de tu wallet para enviar pagos.";
const NOTHING_PENDING_REPLY = "No tienes pagos pendientes de confirmación.";
const MULTIPLE_PENDING_REPLY =
  "Tienes varios pagos pendientes de confirmación. Cancela el que no quieras con CANCELAR <codigo>.";
const AUTHORIZATION_REQUIRED_REPLY =
  "Necesitas autorizar este pago. Abre el enlace y completa la autorización; luego reintenta CONFIRMAR.";

// --- Command parsing --------------------------------------------------------

export type ParsedCommand =
  | { kind: "help" }
  | { kind: "unknown" }
  | { kind: "pay"; amount: string; currency?: string; alias: string }
  | { kind: "confirm"; code: string }
  | { kind: "cancel"; code: string }
  | { kind: "status"; reference: string };

/** Parses an inbound SMS into a command. Pure and dependency-free. */
export function parseCommand(text: string): ParsedCommand {
  const tokens = (text ?? "").trim().split(/\s+/).filter(Boolean);
  const verb = (tokens[0] ?? "").toUpperCase();
  switch (verb) {
    case "AYUDA":
    case "HELP":
      return { kind: "help" };
    case "PAGAR":
      return parsePay(tokens);
    case "CONFIRMAR": {
      const code = tokens[1];
      return code ? { kind: "confirm", code } : { kind: "unknown" };
    }
    case "CANCELAR": {
      const code = tokens[1];
      return code ? { kind: "cancel", code } : { kind: "unknown" };
    }
    case "ESTADO": {
      const reference = tokens[1];
      return reference ? { kind: "status", reference } : { kind: "unknown" };
    }
    default:
      return { kind: "unknown" };
  }
}

/** `PAGAR <amount> [CURRENCY] A <alias>` → the amount, optional currency and alias. */
function parsePay(tokens: string[]): ParsedCommand {
  const separator = tokens.findIndex((token, index) => index > 0 && token.toUpperCase() === "A");
  if (separator < 2) {
    return { kind: "unknown" };
  }
  const alias = tokens[separator + 1];
  const amount = tokens[1];
  if (!alias || !amount) {
    return { kind: "unknown" };
  }
  const currency = tokens.length > separator && separator === 3 ? tokens[2] : undefined;
  return currency ? { kind: "pay", amount, currency, alias } : { kind: "pay", amount, alias };
}

// --- Engine -----------------------------------------------------------------

/** Runs a single inbound command and returns the reply to deliver. */
export async function runCommand(deps: CommandServiceDeps, sms: InboundSms): Promise<CommandOutcome> {
  const parsed = parseCommand(sms.text);
  if (parsed.kind === "help") {
    return { reply: HELP_TEXT };
  }
  if (parsed.kind === "unknown") {
    return { reply: UNKNOWN_COMMAND_REPLY };
  }

  const auth = await authenticate(deps.db, sms.from);
  if ("reply" in auth) {
    return auth;
  }
  const user = auth.user;

  switch (parsed.kind) {
    case "pay":
      return handlePay(deps, user, parsed);
    case "confirm":
      return handleConfirm(deps, user, parsed.code);
    case "cancel":
      return handleCancel(deps, user, parsed.code);
    case "status":
      return handleStatus(deps, user, parsed.reference);
  }
}

// --- Authentication ---------------------------------------------------------

type AuthResult = { user: UserRow } | { reply: string };

/** Resolves an active, verified user by the sender phone (spec §6). */
async function authenticate(db: Db, from: string): Promise<AuthResult> {
  let phone: string;
  try {
    phone = normalizePhone(from);
  } catch {
    return { reply: NOT_REGISTERED_REPLY };
  }
  const row = await db.get<UserRow>(`SELECT * FROM users WHERE phone = ?`, [phone]);
  if (!row) {
    return { reply: NOT_REGISTERED_REPLY };
  }
  if (row.status === "suspended") {
    return { reply: SUSPENDED_REPLY };
  }
  if (!row.phone_verified_at || row.status !== "active") {
    return { reply: NOT_VERIFIED_REPLY };
  }
  return { user: row };
}

// --- PAGAR ------------------------------------------------------------------

async function handlePay(
  deps: CommandServiceDeps,
  user: UserRow,
  command: Extract<ParsedCommand, { kind: "pay" }>,
): Promise<CommandOutcome> {
  const wallet = await latestWallet(deps.db, user.id);
  if (!wallet) {
    return { reply: NO_WALLET_REPLY };
  }

  if (command.currency && command.currency.toUpperCase() !== wallet.currency.toUpperCase()) {
    return {
      reply: `La moneda ${command.currency.toUpperCase()} no coincide con la de tu wallet (${wallet.currency}).`,
    };
  }

  const value = parseMajorUnits(command.amount, wallet.asset_scale);
  if (value === null) {
    return { reply: createInvalidAmountReply(command.amount, wallet.currency, wallet.asset_scale) };
  }
  const debitAmount: Amount = { value, currency: wallet.currency, assetScale: wallet.asset_scale };

  const recipient = await getRecipientByAlias(deps.db, user.id, command.alias);
  if (!recipient) {
    return { reply: `No existe un destinatario con el alias "${command.alias}".` };
  }

  let payment;
  try {
    payment = await preparePayment(paymentDeps(deps), {
      senderUserId: user.id,
      senderWalletId: wallet.id,
      senderWalletAddress: wallet.wallet_address,
      recipientWalletAddress: recipient.wallet_address,
      debitAmount,
      recipientId: recipient.id,
    });
  } catch (error) {
    return { reply: prepareFailureReply(error) };
  }

  const code = String(randomInt(0, 10_000)).padStart(4, "0");
  await deps.db.run(
    `UPDATE payments
        SET confirmation_hash = ?, confirmation_expires_at = ?, confirmation_attempts = 0, updated_at = ?
      WHERE id = ?`,
    [hashConfirmationCode(code), isoPlusSeconds(CONFIRMATION_TTL_SECONDS), nowIso(), payment.id],
  );

  return {
    reply: confirmationPrompt(command.alias, recipient.wallet_address, payment.debitAmount, payment.receiveAmount, code),
    paymentId: payment.id,
    state: "AWAITING_CONFIRMATION",
  };
}

function confirmationPrompt(
  alias: string,
  walletAddress: string,
  debit: Amount | null,
  receive: Amount | null,
  code: string,
): string {
  const lines = [
    "Pago pendiente de confirmación.",
    `Destino: ${alias} (${walletAddress})`,
    `Envías: ${debit ? formatForDisplay(debit) : "n/d"}`,
    `Recibe: ${receive ? formatForDisplay(receive) : "n/d"}`,
    `Responde CONFIRMAR ${code} para ejecutar (vence en 5 minutos).`,
  ];
  return lines.join("\n");
}

// --- CONFIRMAR --------------------------------------------------------------

async function handleConfirm(deps: CommandServiceDeps, user: UserRow, code: string): Promise<CommandOutcome> {
  const candidates = await pendingPayments(deps.db, user.id);
  if (candidates.length === 0) {
    return { reply: NOTHING_PENDING_REPLY };
  }
  if (candidates.length > 1) {
    return { reply: MULTIPLE_PENDING_REPLY };
  }
  const payment = candidates[0] as PaymentRow;

  if (!payment.confirmation_hash || !payment.confirmation_expires_at) {
    return { reply: "Ese pago no tiene un código de confirmación pendiente.", paymentId: payment.id };
  }
  if (isPast(payment.confirmation_expires_at)) {
    return {
      reply: "El código venció. Cancela con CANCELAR <codigo> y crea un nuevo pago.",
      paymentId: payment.id,
      state: payment.state,
    };
  }
  if (payment.confirmation_attempts >= CONFIRMATION_MAX_ATTEMPTS) {
    return {
      reply: "Demasiados intentos fallidos. Cancela el pago y crea uno nuevo.",
      paymentId: payment.id,
      state: payment.state,
    };
  }
  if (!verifyConfirmationCode(code, payment.confirmation_hash)) {
    await deps.db.run(
      `UPDATE payments SET confirmation_attempts = confirmation_attempts + 1, updated_at = ? WHERE id = ?`,
      [nowIso(), payment.id],
    );
    const remaining = CONFIRMATION_MAX_ATTEMPTS - (payment.confirmation_attempts + 1);
    return { reply: `Código incorrecto. Intentos restantes: ${remaining}.`, paymentId: payment.id };
  }

  const access = await resolveOutgoingAccess(deps, payment);
  if (access.kind === "pending") {
    return {
      reply: `${AUTHORIZATION_REQUIRED_REPLY}\n${access.interactUrl}`,
      paymentId: payment.id,
      state: payment.state,
    };
  }
  if (access.kind === "unavailable") {
    return { reply: access.reply, paymentId: payment.id, state: payment.state };
  }

  const result = await executePayment(paymentDeps(deps), {
    paymentId: payment.id,
    accessToken: access.accessToken,
  });
  return { reply: outcomeReply(result.state, result.lastError), paymentId: result.id, state: result.state };
}

/** Human-readable reply straight from the verified state (never guesses COMPLETED). */
function outcomeReply(state: PaymentState, lastError: string | null): string {
  switch (state) {
    case "COMPLETED":
      return "Pago completado y confirmado por la red.";
    case "PROCESSING":
      return "Pago enviado y en proceso. Te avisaremos cuando la red lo confirme.";
    case "NEEDS_REVIEW":
      return "No pudimos confirmar el resultado del pago. Un operador lo revisará; no lo reenvíes.";
    case "FAILED":
      return `El pago falló${lastError ? `: ${lastError}` : "."}`;
    case "CANCELLED":
      return "El pago fue cancelado.";
    case "EXPIRED":
      return "El pago expiró.";
    default:
      return `El pago quedó en estado ${state}.`;
  }
}

// --- CANCELAR ---------------------------------------------------------------

async function handleCancel(deps: CommandServiceDeps, user: UserRow, code: string): Promise<CommandOutcome> {
  const candidates = await pendingPayments(deps.db, user.id);
  if (candidates.length === 0) {
    return { reply: "No tienes pagos pendientes de cancelación." };
  }
  if (candidates.length > 1) {
    return { reply: MULTIPLE_PENDING_REPLY };
  }
  const payment = candidates[0] as PaymentRow;
  if (!payment.confirmation_hash || !verifyConfirmationCode(code, payment.confirmation_hash)) {
    return { reply: "Código incorrecto o pago no cancelable.", paymentId: payment.id, state: payment.state };
  }

  const result = await deps.db.run(
    `UPDATE payments
        SET state = 'CANCELLED', confirmation_hash = NULL, confirmation_expires_at = NULL, updated_at = ?
      WHERE id = ? AND state = 'AWAITING_CONFIRMATION'`,
    [nowIso(), payment.id],
  );
  if (result.changes === 0) {
    return { reply: "El pago ya no se puede cancelar.", paymentId: payment.id };
  }
  return { reply: "Pago cancelado. No se realizó ningún envío.", paymentId: payment.id, state: "CANCELLED" };
}

// --- ESTADO -----------------------------------------------------------------

async function handleStatus(deps: CommandServiceDeps, user: UserRow, reference: string): Promise<CommandOutcome> {
  const row = await deps.db.get<PaymentRow>(
    `SELECT * FROM payments WHERE reference = ? AND sender_user_id = ?`,
    [reference, user.id],
  );
  if (!row) {
    return { reply: "No encontramos un pago con esa referencia en tu cuenta." };
  }
  return { reply: `Pago ${row.reference}: ${describeState(row.state)}`, paymentId: row.id, state: row.state };
}

function describeState(state: PaymentState): string {
  switch (state) {
    case "AWAITING_CONFIRMATION":
      return "pendiente de confirmación.";
    case "PROCESSING":
      return "en proceso.";
    case "COMPLETED":
      return "completado.";
    case "CANCELLED":
      return "cancelado.";
    case "EXPIRED":
      return "expirado.";
    case "FAILED":
      return "fallido.";
    case "NEEDS_REVIEW":
      return "en revisión.";
    default:
      return state;
  }
}

// --- Outgoing access --------------------------------------------------------

type AccessResolution =
  | { kind: "granted"; accessToken: string }
  | { kind: "pending"; interactUrl: string }
  | { kind: "unavailable"; reply: string };

/**
 * Returns a usable outgoing access token. Prefers a stored `GRANTED` grant whose
 * encrypted token is still valid; otherwise starts an interactive grant and
 * returns the interact URL instead of executing the payment (spec §9, §13).
 */
async function resolveOutgoingAccess(deps: CommandServiceDeps, payment: PaymentRow): Promise<AccessResolution> {
  const walletRow = await getWalletRow(deps.db, payment.sender_wallet_id);
  if (!walletRow) {
    return { kind: "unavailable", reply: "No se encontró la wallet emisora del pago." };
  }
  const stored = await findValidGrant(deps, payment.sender_wallet_id);
  if (stored) {
    return { kind: "granted", accessToken: stored };
  }
  if (!deps.secretBox) {
    return {
      kind: "unavailable",
      reply: "La autorización de pagos no está configurada (falta ENCRYPTION_KEY).",
    };
  }

  const wallet = rowToWalletMetadata(walletRow);
  const limit: Amount = {
    value: payment.debit_value ?? "0",
    currency: payment.debit_currency ?? wallet.currency,
    assetScale: payment.debit_scale ?? wallet.assetScale,
  };
  const grantId = randomUUID();
  const finishUri = `${deps.config.PUBLIC_BASE_URL.replace(/\/$/, "")}/auth/callback?grant_id=${grantId}`;
  const requested = await requestOutgoingAccess(paymentDeps(deps), {
    wallet,
    limit,
    finishUri,
    nonce: randomUUID(),
  });

  if (requested.kind === "granted") {
    await storeGrant(deps, {
      id: grantId,
      walletId: payment.sender_wallet_id,
      status: "GRANTED",
      limit,
      accessTokenEnc: deps.secretBox.encrypt(requested.accessToken),
      manageUri: requested.manageUri ?? null,
      expiresAt: requested.expiresAt,
    });
    await scheduleGrantTokenRotation(deps.db, { grantId, expiresAt: requested.expiresAt });
    return { kind: "granted", accessToken: requested.accessToken };
  }

  await storeGrant(deps, {
    id: grantId,
    walletId: payment.sender_wallet_id,
    status: "PENDING_INTERACTION",
    limit,
    continueUri: requested.continueUri,
    continueTokenEnc: deps.secretBox.encrypt(requested.continueAccessToken),
    interactUrl: requested.interactUrl,
  });
  return { kind: "pending", interactUrl: requested.interactUrl };
}

/** Decrypts the newest non-expired stored grant token, or null when none is usable. */
async function findValidGrant(deps: CommandServiceDeps, walletId: string): Promise<string | null> {
  if (!deps.secretBox) {
    return null;
  }
  const rows = await deps.db.all<{ access_token_enc: string; expires_at: string | null }>(
    `SELECT access_token_enc, expires_at FROM grants
      WHERE wallet_id = ? AND status = 'GRANTED' AND access_token_enc IS NOT NULL
        AND requires_reconsent = 0
      ORDER BY created_at DESC, seq DESC`,
    [walletId],
  );
  for (const row of rows) {
    if (row.expires_at && isPast(row.expires_at)) {
      continue;
    }
    try {
      return deps.secretBox.decrypt(row.access_token_enc);
    } catch {
      continue; // Un secreto corrupto no debe bloquear un nuevo intento de autorización.
    }
  }
  return null;
}

interface StoreGrantInput {
  id: string;
  walletId: string;
  status: "GRANTED" | "PENDING_INTERACTION";
  limit: Amount;
  accessTokenEnc?: string;
  manageUri?: string | null;
  continueUri?: string;
  continueTokenEnc?: string;
  interactUrl?: string;
  expiresAt?: string | null;
}

async function storeGrant(deps: CommandServiceDeps, input: StoreGrantInput): Promise<void> {
  const now = nowIso();
  await deps.db.run(
    `INSERT INTO grants
       (id, wallet_id, status, scopes, limit_value, limit_currency, limit_scale,
        access_token_enc, access_token_manage_uri, continue_uri, continue_token_enc, interact_url,
        expires_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.id,
      input.walletId,
      input.status,
      JSON.stringify(["outgoing-payment"]),
      input.limit.value,
      input.limit.currency,
      input.limit.assetScale,
      input.accessTokenEnc ?? null,
      input.manageUri ?? null,
      input.continueUri ?? null,
      input.continueTokenEnc ?? null,
      input.interactUrl ?? null,
      input.expiresAt ?? null,
      now,
      now,
    ],
  );
  await recordAudit(deps.db, input.status === "GRANTED" ? "grant.granted" : "grant.requested", "grant", input.id, {
    via: "sms",
  });
}

// --- Persistence helpers ----------------------------------------------------

interface PaymentRow {
  id: string;
  reference: string;
  sender_user_id: string;
  sender_wallet_id: string;
  state: PaymentState;
  debit_value: string | null;
  debit_currency: string | null;
  debit_scale: number | null;
  receive_value: string | null;
  receive_currency: string | null;
  receive_scale: number | null;
  confirmation_hash: string | null;
  confirmation_expires_at: string | null;
  confirmation_attempts: number;
}

async function pendingPayments(db: Db, userId: string): Promise<PaymentRow[]> {
  return db.all<PaymentRow>(
    `SELECT * FROM payments
      WHERE sender_user_id = ? AND state = 'AWAITING_CONFIRMATION'
      ORDER BY created_at DESC, seq DESC`,
    [userId],
  );
}

async function latestWallet(db: Db, userId: string): Promise<WalletRow | undefined> {
  return db.get<WalletRow>(
    `SELECT * FROM wallets WHERE user_id = ? ORDER BY created_at DESC, seq DESC LIMIT 1`,
    [userId],
  );
}

/** Wraps the payment provider for the payment service boundary. */
function paymentDeps(deps: CommandServiceDeps): PaymentServiceDeps {
  return { db: deps.db, provider: deps.provider, config: deps.config };
}

// --- Amount parsing ---------------------------------------------------------

/**
 * Converts a user-typed amount in major units (e.g. "12.50") to the integer
 * string in minor units for the given asset scale. Returns null when invalid.
 */
export function parseMajorUnits(raw: string, assetScale: number): string | null {
  const trimmed = (raw ?? "").trim().replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    return null;
  }
  const [whole, fraction = ""] = trimmed.split(".");
  if (fraction.length > assetScale) {
    return null;
  }
  const padded = fraction.padEnd(assetScale, "0");
  const combined = `${whole}${padded}`.replace(/^0+(?=\d)/, "");
  return combined.length > 0 ? combined : "0";
}

function createInvalidAmountReply(raw: string, currency: string, assetScale: number): string {
  const unit = assetScale === 0 ? "un entero" : `con hasta ${assetScale} decimales`;
  return `Monto inválido: "${raw}". Indica ${unit} en ${currency}.`;
}

// --- Confirmation code hashing ---------------------------------------------

/** Salted scrypt hash; the plaintext code never reaches the database or logs. */
function hashConfirmationCode(code: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(code, salt, 32);
  return `${salt.toString("base64")}.${hash.toString("base64")}`;
}

function verifyConfirmationCode(code: string, stored: string): boolean {
  const [saltB64, hashB64] = stored.split(".");
  if (!saltB64 || !hashB64) {
    return false;
  }
  const expected = Buffer.from(hashB64, "base64");
  const actual = scryptSync(code, Buffer.from(saltB64, "base64"), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// --- Error translation ------------------------------------------------------

function prepareFailureReply(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code: string }).code;
    if (code === "VALIDATION_FAILED") {
      return "No se pudo preparar el pago: revisa el monto y la moneda.";
    }
    if (code === "NOT_FOUND") {
      return "No se pudo preparar el pago: no se encontró la wallet destino.";
    }
  }
  return "No se pudo preparar el pago. Intenta de nuevo más tarde.";
}
