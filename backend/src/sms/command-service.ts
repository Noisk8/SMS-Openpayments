import { createHash, randomBytes, randomInt, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import type { AppConfig } from "../config";
import type { Db } from "../db";
import { isUniqueViolation } from "../db/errors";
import type { Amount, PaymentState } from "../domain";
import { AppError } from "../errors";
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
import {
  getRecipientByAlias,
  getRecipientByDestination,
  listRecipients,
} from "../recipients/service";
import type { SecretBox } from "../security/encryption";
import { isPast, isoPlusSeconds, nowIso } from "../util/time";
import type { InboundSms, SmsProvider } from "./types";

/**
 * SMS command engine (spec §9, §12, §13).
 *
 * Authenticates the sender by phone and runs one of two command families:
 *
 * - the MVP short interface (`P <amount> <destination>`, a bare confirmation
 *   code, `0` cancel, `1` last payment, `2` destinations, `9` help), and
 * - the original long commands (`PAGAR`, `CONFIRMAR`, `CANCELAR`, `ESTADO`,
 *   `AYUDA`), kept as compatible alternatives.
 *
 * Both families share the same rules: one pending payment per user, a 4-digit
 * code that expires after {@link CONFIRMATION_TTL_SECONDS} and allows at most
 * {@link CONFIRMATION_MAX_ATTEMPTS} failed attempts, atomic confirmation and a
 * per-user registry that never reuses a code for another payment.
 *
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
/** MVP ceiling for a short-form amount, in major units of the wallet asset. */
export const MVP_MAX_AMOUNT_MAJOR = 1_000_000;

export const HELP_TEXT = [
  "Comandos disponibles:",
  "PAGAR <monto> [MONEDA] A <alias>",
  "CONFIRMAR <codigo>",
  "CANCELAR <codigo>",
  "ESTADO <referencia>",
  "AYUDA",
].join("\n");

export const SHORT_HELP_TEXT = [
  "P 1000 2: pagar",
  "Codigo recibido: confirmar",
  "0: cancelar",
  "1: ultimo pago",
  "2: destinos",
  "9: ayuda",
].join("\n");

export const UNKNOWN_COMMAND_REPLY = "Comando no reconocido. 9 para ayuda.";

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

// --- Short replies (MVP) ----------------------------------------------------

const FORMAT_REPLY = "Formato: P 1000 2. Envia 2 para ver destinos.";
const DESTINATION_NOT_FOUND_REPLY = "Destino no encontrado. Envia 2 para ver destinos.";
const ONE_PENDING_REPLY = "Ya tienes un pago pendiente. Usa su codigo o envia 0 para cancelar.";
const NO_PENDING_SHORT_REPLY = "No tienes un pago pendiente. 9 para ayuda.";
const EXPIRED_SHORT_REPLY = "El pago vencio. Crea otro con P monto destino.";
const CANCELLED_SHORT_REPLY = "Pago cancelado. No se envio dinero.";
const ATTEMPTS_EXHAUSTED_SHORT_REPLY = "Demasiados intentos. Envia 0 para cancelar.";
const UNCERTAIN_SHORT_REPLY = "Pago en revision. No repitas el envio. 1 para consultar.";
const NO_DESTINATIONS_REPLY = "No tienes destinos. 9 para ayuda.";
const NO_PAYMENTS_SHORT_REPLY = "No tienes pagos. 9 para ayuda.";

// --- Command parsing --------------------------------------------------------

export type ParsedCommand =
  | { kind: "help"; short: boolean }
  | { kind: "unknown" }
  | { kind: "pay"; amount: string; currency?: string; destination: string; short: boolean }
  | { kind: "confirm"; code: string; short: boolean }
  | { kind: "cancel"; code?: string; short: boolean }
  | { kind: "status"; reference?: string; short: boolean }
  | { kind: "recipients" };

/** Parses an inbound SMS into a command. Pure and dependency-free. */
export function parseCommand(text: string): ParsedCommand {
  const tokens = (text ?? "").trim().split(/\s+/).filter(Boolean);
  const first = tokens[0] ?? "";
  const verb = first.toUpperCase();

  // Single-token commands. Recipient numbers are only meaningful after `P`, so a
  // lone number is always a command: `0`/`1`/`2`/`9` or a confirmation code.
  if (tokens.length === 1 && /^\d+$/.test(first)) {
    switch (first) {
      case "0":
        return { kind: "cancel", short: true };
      case "1":
        return { kind: "status", short: true };
      case "2":
        return { kind: "recipients" };
      case "9":
        return { kind: "help", short: true };
    }
    // Exactly a code (4 digits, or longer if the per-user space ever grows).
    if (first.length >= 4) {
      return { kind: "confirm", code: first, short: true };
    }
    return { kind: "unknown" };
  }

  if (tokens.length === 1 && (verb === "AYUDA" || verb === "HELP")) {
    return { kind: "help", short: false };
  }

  switch (verb) {
    case "AYUDA":
    case "HELP":
      return { kind: "help", short: false };
    case "P":
      return parseShortPay(tokens);
    case "PAGAR":
      return parsePay(tokens);
    case "CONFIRMAR": {
      const code = tokens[1];
      return code ? { kind: "confirm", code, short: false } : { kind: "unknown" };
    }
    case "CANCELAR": {
      const code = tokens[1];
      return code ? { kind: "cancel", code, short: false } : { kind: "unknown" };
    }
    case "ESTADO": {
      const reference = tokens[1];
      return reference ? { kind: "status", reference, short: false } : { kind: "unknown" };
    }
    default:
      return { kind: "unknown" };
  }
}

/** `P <amount> <destination>` → the amount and a number or alias destination. */
function parseShortPay(tokens: string[]): ParsedCommand {
  const amount = tokens[1] ?? "";
  const destination = tokens.slice(2).join(" ");
  return { kind: "pay", amount, destination, short: true };
}

/** `PAGAR <amount> [CURRENCY] A <alias>` → the amount, optional currency and alias. */
function parsePay(tokens: string[]): ParsedCommand {
  const separator = tokens.findIndex((token, index) => index > 0 && token.toUpperCase() === "A");
  if (separator < 2) {
    return { kind: "unknown" };
  }
  const destination = tokens[separator + 1];
  const amount = tokens[1];
  if (!destination || !amount) {
    return { kind: "unknown" };
  }
  const currency = tokens.length > separator && separator === 3 ? tokens[2] : undefined;
  return currency
    ? { kind: "pay", amount, currency, destination, short: false }
    : { kind: "pay", amount, destination, short: false };
}

// --- Engine -----------------------------------------------------------------

/** Runs a single inbound command and returns the reply to deliver. */
export async function runCommand(deps: CommandServiceDeps, sms: InboundSms): Promise<CommandOutcome> {
  const parsed = parseCommand(sms.text);
  if (parsed.kind === "help") {
    return { reply: parsed.short ? SHORT_HELP_TEXT : HELP_TEXT };
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
      return handleConfirm(deps, user, parsed);
    case "cancel":
      return parsed.short ? handleShortCancel(deps, user) : handleLongCancel(deps, user, parsed.code as string);
    case "status":
      return parsed.short ? handleShortStatus(deps, user) : handleLongStatus(deps, user, parsed.reference as string);
    case "recipients":
      return handleRecipients(deps, user);
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

// --- P (short) and PAGAR (long) ---------------------------------------------

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
    // The SMS always works in the wallet currency, so replies never name it.
    return { reply: "La moneda indicada no coincide con la de tu wallet." };
  }

  // The short MVP form only accepts positive integers in major units; the long
  // form keeps accepting decimals according to the asset scale.
  const value = command.short
    ? parseMvpAmount(command.amount, wallet.asset_scale)
    : parseMajorUnits(command.amount, wallet.asset_scale);
  if (value === null) {
    return {
      reply: command.short ? FORMAT_REPLY : createInvalidAmountReply(command.amount, wallet.asset_scale),
    };
  }
  if (command.short && isOverMvpLimit(command.amount)) {
    return { reply: FORMAT_REPLY };
  }
  if (command.short && command.destination.trim().length === 0) {
    return { reply: FORMAT_REPLY };
  }
  const debitAmount: Amount = { value, currency: wallet.currency, assetScale: wallet.asset_scale };

  const recipient = command.short
    ? await getRecipientByDestination(deps.db, user.id, command.destination)
    : await getRecipientByAlias(deps.db, user.id, command.destination);
  if (!recipient) {
    return {
      reply: command.short
        ? DESTINATION_NOT_FOUND_REPLY
        : `No existe un destinatario con el alias "${command.destination}".`,
    };
  }

  // One pending payment per user. A stale one is expired first so the user can
  // always start a new payment after the code lapses.
  const pending = await pendingPayment(deps.db, user.id);
  if (pending) {
    if (!(await expireIfStale(deps.db, pending))) {
      return { reply: ONE_PENDING_REPLY, paymentId: pending.id, state: pending.state };
    }
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

  const code = await issueConfirmationCode(deps, user.id, payment.id);

  return {
    reply: command.short
      ? shortPayPrompt(recipient.alias, payment.debitAmount, payment.receiveAmount, code)
      : confirmationPrompt(recipient.alias, recipient.wallet_address, payment.debitAmount, payment.receiveAmount, code),
    paymentId: payment.id,
    state: "AWAITING_CONFIRMATION",
  };
}

/** MVP reply shown after `P <amount> <destination>`. */
function shortPayPrompt(alias: string, debit: Amount | null, receive: Amount | null, code: string): string {
  return [
    `Envias: ${debit ? formatAmount(debit) : "n/d"}`,
    `Destino: ${alias}`,
    `Recibe: ${receive ? formatAmount(receive) : "n/d"}`,
    `Responde ${code} para pagar.`,
    "0 cancela. Vence en 5 min.",
  ].join("\n");
}

/**
 * Amount in major units without the currency: the SMS always works in the
 * wallet's currency (COP), so repeating it on every reply is redundant.
 */
function formatAmount(amount: Amount): string {
  return formatForDisplay(amount).replace(/\s.*$/, "");
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
    `Envías: ${debit ? formatAmount(debit) : "n/d"}`,
    `Recibe: ${receive ? formatAmount(receive) : "n/d"}`,
    `Responde CONFIRMAR ${code} para ejecutar (vence en 5 minutos).`,
  ];
  return lines.join("\n");
}

// --- Confirmation (bare code and CONFIRMAR) ---------------------------------

async function handleConfirm(
  deps: CommandServiceDeps,
  user: UserRow,
  command: Extract<ParsedCommand, { kind: "confirm" }>,
): Promise<CommandOutcome> {
  const payment = await pendingPayment(deps.db, user.id);
  if (!payment) {
    return { reply: command.short ? NO_PENDING_SHORT_REPLY : NOTHING_PENDING_REPLY };
  }

  if (await expireIfStale(deps.db, payment)) {
    return {
      reply: command.short ? EXPIRED_SHORT_REPLY : "El código venció. Crea un nuevo pago.",
      paymentId: payment.id,
      state: "EXPIRED",
    };
  }

  if (!payment.confirmation_hash || !payment.confirmation_expires_at) {
    return {
      reply: command.short
        ? NO_PENDING_SHORT_REPLY
        : "Ese pago no tiene un código de confirmación pendiente.",
      paymentId: payment.id,
      state: payment.state,
    };
  }
  if (payment.confirmation_attempts >= CONFIRMATION_MAX_ATTEMPTS) {
    return {
      reply: command.short
        ? ATTEMPTS_EXHAUSTED_SHORT_REPLY
        : "Demasiados intentos fallidos. Cancela el pago y crea uno nuevo.",
      paymentId: payment.id,
      state: payment.state,
    };
  }
  if (!verifyConfirmationCode(command.code, payment.confirmation_hash)) {
    await deps.db.run(
      `UPDATE payments SET confirmation_attempts = confirmation_attempts + 1, updated_at = ? WHERE id = ?`,
      [nowIso(), payment.id],
    );
    const remaining = CONFIRMATION_MAX_ATTEMPTS - (payment.confirmation_attempts + 1);
    return {
      reply: command.short
        ? `Codigo incorrecto. Quedan ${remaining} intentos.`
        : `Código incorrecto. Intentos restantes: ${remaining}.`,
      paymentId: payment.id,
    };
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

  // `executePayment` claims the payment atomically, so repeating the code (or a
  // concurrent duplicate) never debits twice.
  const result = await executePayment(paymentDeps(deps), {
    paymentId: payment.id,
    accessToken: access.accessToken,
  });
  const alias = payment.recipient_alias ?? payment.recipient_wallet_address;
  const debit = result.debitAmount ?? debitFromRow(payment);
  return {
    reply: command.short
      ? shortOutcomeReply(result.state, debit, alias, result.lastError)
      : outcomeReply(result.state, result.lastError),
    paymentId: result.id,
    state: result.state,
  };
}

/** MVP confirmation reply, adapted to the confirmed state. */
function shortOutcomeReply(
  state: PaymentState,
  debit: Amount | null,
  alias: string,
  lastError: string | null,
): string {
  const amount = debit ? formatAmount(debit) : "el monto";
  switch (state) {
    case "COMPLETED":
      return `Pago confirmado: ${amount} a ${alias}.`;
    case "PROCESSING":
      return `Pago en proceso: ${amount} a ${alias}.\nTe avisaremos al confirmar.\n1 para consultar.`;
    case "NEEDS_REVIEW":
      return UNCERTAIN_SHORT_REPLY;
    case "FAILED":
      return `El pago fallo${lastError ? `: ${lastError}` : "."} 1 para consultar.`;
    case "CANCELLED":
      return CANCELLED_SHORT_REPLY;
    case "EXPIRED":
      return EXPIRED_SHORT_REPLY;
    default:
      return `El pago quedo en estado ${state}. 1 para consultar.`;
  }
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

// --- Cancel (0 and CANCELAR) ------------------------------------------------

/** `0` cancels the single payment still awaiting confirmation. */
async function handleShortCancel(deps: CommandServiceDeps, user: UserRow): Promise<CommandOutcome> {
  const payment = await pendingPayment(deps.db, user.id);
  if (!payment) {
    return { reply: NO_PENDING_SHORT_REPLY };
  }
  if (await expireIfStale(deps.db, payment)) {
    return { reply: EXPIRED_SHORT_REPLY, paymentId: payment.id, state: "EXPIRED" };
  }
  const cancelled = await cancelPendingPayment(deps, payment.id);
  if (!cancelled) {
    return { reply: NO_PENDING_SHORT_REPLY, paymentId: payment.id, state: payment.state };
  }
  return { reply: CANCELLED_SHORT_REPLY, paymentId: payment.id, state: "CANCELLED" };
}

async function handleLongCancel(
  deps: CommandServiceDeps,
  user: UserRow,
  code: string,
): Promise<CommandOutcome> {
  const payment = await pendingPayment(deps.db, user.id);
  if (!payment) {
    return { reply: "No tienes pagos pendientes de cancelación." };
  }
  if (await expireIfStale(deps.db, payment)) {
    return { reply: "El pago venció. Crea uno nuevo.", paymentId: payment.id, state: "EXPIRED" };
  }
  if (!payment.confirmation_hash || !verifyConfirmationCode(code, payment.confirmation_hash)) {
    return { reply: "Código incorrecto o pago no cancelable.", paymentId: payment.id, state: payment.state };
  }
  const cancelled = await cancelPendingPayment(deps, payment.id);
  if (!cancelled) {
    return { reply: "El pago ya no se puede cancelar.", paymentId: payment.id };
  }
  return { reply: "Pago cancelado. No se realizó ningún envío.", paymentId: payment.id, state: "CANCELLED" };
}

/** Atomically cancels a still-pending payment. Returns false when it already moved. */
async function cancelPendingPayment(deps: CommandServiceDeps, paymentId: string): Promise<boolean> {
  const result = await deps.db.run(
    `UPDATE payments
        SET state = 'CANCELLED', confirmation_hash = NULL, confirmation_expires_at = NULL, updated_at = ?
      WHERE id = ? AND state = 'AWAITING_CONFIRMATION'`,
    [nowIso(), paymentId],
  );
  return result.changes > 0;
}

// --- Status (1 and ESTADO) --------------------------------------------------

/** `1` shows the last payment the user created, including the pending one. */
async function handleShortStatus(deps: CommandServiceDeps, user: UserRow): Promise<CommandOutcome> {
  const row = await latestPayment(deps.db, user.id);
  if (!row) {
    return { reply: NO_PAYMENTS_SHORT_REPLY };
  }
  let state = row.state;
  if (state === "AWAITING_CONFIRMATION" && (await expireIfStale(deps.db, row))) {
    state = "EXPIRED";
  }
  const alias = row.recipient_alias ?? row.recipient_wallet_address;
  const amount = debitFromRow(row);
  const lines = [
    `Ultimo pago: ${amount ? formatAmount(amount) : "n/d"} a ${alias}.`,
    `Estado: ${shortStateLabel(state)}.`,
  ];
  const action = shortStateAction(state, row);
  if (action) {
    lines.push(action);
  }
  return { reply: lines.join("\n"), paymentId: row.id, state };
}

function shortStateLabel(state: PaymentState): string {
  switch (state) {
    case "AWAITING_CONFIRMATION":
      return "pendiente";
    case "PROCESSING":
      return "en proceso";
    case "COMPLETED":
      return "completado";
    case "CANCELLED":
      return "cancelado";
    case "EXPIRED":
      return "vencido";
    case "FAILED":
      return "fallido";
    case "NEEDS_REVIEW":
      return "en revision";
    default:
      return state;
  }
}

/**
 * Follow-up line for `1`. The code is never repeated: only its hash is stored,
 * so a pending payment tells the user to reuse the original SMS instead.
 */
function shortStateAction(state: PaymentState, row: PaymentRow): string | null {
  switch (state) {
    case "AWAITING_CONFIRMATION": {
      if (row.confirmation_attempts >= CONFIRMATION_MAX_ATTEMPTS) {
        return "Demasiados intentos. Envia 0 para cancelar.";
      }
      return "Usa el codigo de tu SMS original o envia 0 para cancelar.";
    }
    case "PROCESSING":
      return "Te avisaremos al confirmar.";
    case "COMPLETED":
      return "Pago confirmado.";
    case "CANCELLED":
      return "No se envio dinero.";
    case "EXPIRED":
      return "Crea otro con P monto destino.";
    case "FAILED":
      return "El pago fallo.";
    case "NEEDS_REVIEW":
      return "No repitas el envio.";
    default:
      return null;
  }
}

async function handleLongStatus(
  deps: CommandServiceDeps,
  user: UserRow,
  reference: string,
): Promise<CommandOutcome> {
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

// --- Destinations (2) -------------------------------------------------------

async function handleRecipients(deps: CommandServiceDeps, user: UserRow): Promise<CommandOutcome> {
  const recipients = await listRecipients(deps.db, user.id);
  if (recipients.length === 0) {
    return { reply: NO_DESTINATIONS_REPLY };
  }
  const lines = [
    "Destinos:",
    ...recipients.map((recipient) => `${recipient.number} ${recipient.alias}`),
    "Para pagar: P 1000 2",
  ];
  return { reply: lines.join("\n") };
}

// --- Confirmation codes -----------------------------------------------------

/**
 * Issues a fresh confirmation code for a payment.
 *
 * A per-user registry guarantees the code was never handed out before: even when
 * an old SMS arrives late, it can only ever match the payment it was created for.
 * Only a salted hash (for verification) and a deterministic fingerprint (for
 * uniqueness) are stored; the plaintext goes back to the caller to deliver it.
 */
async function issueConfirmationCode(
  deps: CommandServiceDeps,
  userId: string,
  paymentId: string,
): Promise<string> {
  const used = await deps.db.get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM sms_confirmation_codes WHERE user_id = ?`,
    [userId],
  );
  const length = confirmationCodeLength(used?.n ?? 0);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const code = randomCode(length);
    const hash = hashConfirmationCode(code);
    const fingerprint = codeFingerprint(code);
    try {
      await deps.db.transaction(async (tx) => {
        await tx.run(
          `INSERT INTO sms_confirmation_codes (user_id, payment_id, code_hash, code_fingerprint)
           VALUES (?, ?, ?, ?)`,
          [userId, paymentId, hash, fingerprint],
        );
        await tx.run(
          `UPDATE payments
              SET confirmation_hash = ?, confirmation_expires_at = ?, confirmation_attempts = 0, updated_at = ?
            WHERE id = ?`,
          [hash, isoPlusSeconds(CONFIRMATION_TTL_SECONDS), nowIso(), paymentId],
        );
      });
      return code;
    } catch (error) {
      if (isUniqueViolation(error)) {
        continue; // The code already belongs to this user: draw another one.
      }
      throw error;
    }
  }
  // TODO: every code of this length is already used by the user. Grow the code
  // length further before real usage approaches the limit; never reuse a code.
  throw new AppError("INTERNAL", "No se pudo generar un código de confirmación único.");
}

/** Grows the code length once the shorter space is exhausted (MVP: 4 digits). */
function confirmationCodeLength(usedCount: number): number {
  let length = 4;
  while (usedCount >= 10 ** length) {
    length += 1;
  }
  return length;
}

function randomCode(length: number): string {
  return String(randomInt(0, 10 ** length)).padStart(length, "0");
}

function codeFingerprint(code: string): string {
  return createHash("sha256").update(code).digest("base64");
}

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
  recipient_wallet_address: string;
  recipient_alias: string | null;
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
  last_error: string | null;
}

const PAYMENT_WITH_ALIAS = `SELECT p.*, r.alias AS recipient_alias
   FROM payments p
   LEFT JOIN recipients r ON r.id = p.recipient_id`;

/** The user's single payment awaiting confirmation, if any. */
async function pendingPayment(db: Db, userId: string): Promise<PaymentRow | undefined> {
  return db.get<PaymentRow>(
    `${PAYMENT_WITH_ALIAS}
      WHERE p.sender_user_id = ? AND p.state = 'AWAITING_CONFIRMATION'
      ORDER BY p.created_at DESC, p.seq DESC LIMIT 1`,
    [userId],
  );
}

/** The user's most recently created payment, in any state. */
async function latestPayment(db: Db, userId: string): Promise<PaymentRow | undefined> {
  return db.get<PaymentRow>(
    `${PAYMENT_WITH_ALIAS}
      WHERE p.sender_user_id = ?
      ORDER BY p.created_at DESC, p.seq DESC LIMIT 1`,
    [userId],
  );
}

/**
 * Expires a pending payment whose code lapsed, so the user can create another.
 * Returns true when this call performed the transition.
 */
async function expireIfStale(db: Db, payment: PaymentRow): Promise<boolean> {
  if (payment.state !== "AWAITING_CONFIRMATION" || !payment.confirmation_expires_at) {
    return false;
  }
  if (!isPast(payment.confirmation_expires_at)) {
    return false;
  }
  const result = await db.run(
    `UPDATE payments
        SET state = 'EXPIRED', confirmation_hash = NULL, confirmation_expires_at = NULL, updated_at = ?
      WHERE id = ? AND state = 'AWAITING_CONFIRMATION'`,
    [nowIso(), payment.id],
  );
  return result.changes > 0;
}

async function latestWallet(db: Db, userId: string): Promise<WalletRow | undefined> {
  return db.get<WalletRow>(
    `SELECT * FROM wallets WHERE user_id = ? ORDER BY created_at DESC, seq DESC LIMIT 1`,
    [userId],
  );
}

function debitFromRow(row: PaymentRow): Amount | null {
  if (row.debit_value === null || row.debit_currency === null || row.debit_scale === null) {
    return null;
  }
  return { value: row.debit_value, currency: row.debit_currency, assetScale: row.debit_scale };
}

/** Wraps the payment provider for the payment service boundary. */
function paymentDeps(deps: CommandServiceDeps): PaymentServiceDeps {
  return { db: deps.db, provider: deps.provider, config: deps.config };
}

// --- Amount parsing ---------------------------------------------------------

/**
 * MVP amount: a positive integer in major units (e.g. `1000` = 1000 COP).
 * Dots, commas, signs and spaces are rejected. Returns the scaled integer string.
 */
export function parseMvpAmount(raw: string, assetScale: number): string | null {
  const trimmed = (raw ?? "").trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }
  const major = BigInt(trimmed);
  if (major <= 0n) {
    return null;
  }
  return (major * 10n ** BigInt(assetScale)).toString();
}

/** True when a raw MVP amount in major units exceeds the MVP ceiling. */
function isOverMvpLimit(raw: string): boolean {
  return BigInt((raw ?? "").trim()) > BigInt(MVP_MAX_AMOUNT_MAJOR);
}

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

function createInvalidAmountReply(raw: string, assetScale: number): string {
  const unit = assetScale === 0 ? "un entero" : `con hasta ${assetScale} decimales`;
  return `Monto inválido: "${raw}". Indica ${unit}.`;
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
