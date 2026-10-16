import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { AppConfig } from "../config";
import type { Db, Queryable } from "../db";
import { AppError } from "../errors";
import { createUser, getUserRow, normalizePhone, requestPhoneVerification, verifyPhone, type UserRow } from "../onboarding/service";
import type { InboundSms } from "../sms/types";
import type { ManagedGateway } from "./rafiki";

export interface ManagedDeps { config: AppConfig; db: Db; gateway: ManagedGateway }
type LedgerDeps = Omit<ManagedDeps, "db"> & { db: Queryable };
interface Account { user_id: string; wallet_id: string; wallet_address: string; balance: number }
interface Transfer {
  id: string; request_key: string; sender_id: string; recipient_id: string; amount: number;
  state: string; quote_id: string | null; incoming_id: string | null; outgoing_id: string | null;
  expires_at: string | null; attempts: number; reserved: number;
}
const HELP = "CREAR CUENTA | VERIFICAR <codigo> | SALDO | PAGAR <pesos> A <telefono> | CONFIRMAR <referencia> <codigo> | CANCELAR <referencia> | ESTADO <referencia>. COP de prueba, sin dinero real.";

async function account(deps: LedgerDeps, userId: string): Promise<Account> {
  const row = (await deps.db.get("SELECT * FROM managed_accounts WHERE user_id = ?", [userId])) as Account | undefined;
  if (!row) throw new AppError("FORBIDDEN", "Primero crea tu cuenta: CREAR CUENTA.");
  return row;
}
async function getTransfer(deps: LedgerDeps, id: string, lock = false): Promise<Transfer> {
  const row = (await deps.db.get(`SELECT * FROM managed_transfers WHERE id = ?${lock ? " FOR UPDATE" : ""}`, [id])) as Transfer | undefined;
  if (!row) throw new AppError("NOT_FOUND", "Pago no encontrado.");
  return row;
}
function code(deps: ManagedDeps, id: string) {
  return createHmac("sha256", deps.config.ENCRYPTION_KEY).update(`managed:${id}`).digest("hex").slice(0, 10).toUpperCase();
}

// Called only inside a PostgreSQL transaction. Every journal is balanced and immutable.
async function journal(deps: LedgerDeps, id: string, kind: string, debit: string, credit: string, amount: number): Promise<boolean> {
  await deps.db.query("SELECT pg_advisory_xact_lock(hashtextextended(?, 0))", [id]);
  const existing = (await deps.db.get("SELECT id FROM managed_journals WHERE id = ?", [id]));
  if (existing) return false;
  (await deps.db.run("INSERT INTO managed_journals (id, kind) VALUES (?, ?)", [id, kind]));
  await deps.db.run("INSERT INTO managed_entries (journal_id, account, amount) VALUES (?, ?, ?)", [id, debit, -amount]);
  await deps.db.run("INSERT INTO managed_entries (journal_id, account, amount) VALUES (?, ?, ?)", [id, credit, amount]);
  return true;
}

export async function fundTestAccount(deps: ManagedDeps, phone: string, amount: number, key: string): Promise<void> {
  const user = (await deps.db.get("SELECT * FROM users WHERE phone = ? AND status = 'active'", [normalizePhone(phone)])) as UserRow | undefined;
  if (!user) throw new AppError("NOT_FOUND", "Cuenta activa no encontrada.");
  (await account(deps, user.id));
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 1_000_000_000) throw new AppError("VALIDATION_FAILED", "Recarga de prueba inválida.");
  (await deps.db.transaction(async (tx) => {
    const scoped = { ...deps, db: tx };
    const id = `fund:${key}`;
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended(?, 0))", [id]);
    const entries = (await tx.all("SELECT account, amount FROM managed_entries WHERE journal_id = ? ORDER BY account", [id])) as Array<{ account: string; amount: number }>;
    if (entries.length) {
      if (!entries.some(entry => entry.account === `user:${user.id}` && entry.amount === amount)) throw new AppError("CONFLICT", "La clave de recarga ya fue utilizada con otros datos.");
      return;
    }
    (await journal(scoped, id, "TEST_FUNDING", "system:test-funds", `user:${user.id}`, amount));
    (await tx.run("UPDATE managed_accounts SET balance = balance + ? WHERE user_id = ?", [amount, user.id]));
  }));
}

async function provision(deps: ManagedDeps, user: UserRow): Promise<string> {
  if (user.status !== "active" || !user.phone_verified_at) throw new AppError("FORBIDDEN", "Verifica el teléfono primero.");
  const existing = (await deps.db.get("SELECT * FROM managed_accounts WHERE user_id = ?", [user.id]));
  if (!existing) {
    const wallet = await deps.gateway.createWallet(user.id);
    (await deps.db.run("INSERT INTO managed_accounts (user_id, wallet_id, wallet_address) VALUES (?, ?, ?) ON CONFLICT (user_id) DO NOTHING", [user.id, wallet.id, wallet.address]));
  }
  return "Tu cuenta COP de prueba está lista. Escribe SALDO o PAGAR <pesos> A <telefono>. Saldo inicial: 0 COP; el equipo puede asignar fondos de prueba.";
}

export async function reconcileTransfer(deps: ManagedDeps, id: string): Promise<Transfer> {
  let transfer = (await getTransfer(deps, id));
  if (transfer.state !== "PROCESSING" || !transfer.outgoing_id) return transfer;
  const remote = await deps.gateway.getOutgoing(transfer.outgoing_id);
  if (remote.state === "FUNDING") {
    // The stable idempotency key makes a retry safe even after a lost response.
    await deps.gateway.fund(transfer.id, transfer.outgoing_id);
    return transfer;
  }
  if (remote.state === "COMPLETED") {
    if (remote.id !== transfer.outgoing_id || remote.sentAmount.value !== String(transfer.amount) || remote.debitAmount.value !== String(transfer.amount) || remote.receiveAmount.value !== String(transfer.amount)) {
      (await deps.db.run("UPDATE managed_transfers SET state = 'NEEDS_REVIEW' WHERE id = ? AND state = 'PROCESSING'", [id]));
      return (await getTransfer(deps, id));
    }
    // Only credit after liquidity withdrawal has been acknowledged by Rafiki.
    await deps.gateway.withdrawIncoming(id, transfer.incoming_id!);
    (await deps.db.transaction(async (tx) => {
    const scoped = { ...deps, db: tx };
      transfer = (await getTransfer(scoped, id, true));
      if (transfer.state !== "PROCESSING" || !transfer.reserved) return;
      if ((await journal(scoped, `settle:${id}`, "PAYMENT_SETTLED", `escrow:${id}`, `user:${transfer.recipient_id}`, transfer.amount))) {
        (await tx.run("UPDATE managed_accounts SET balance = balance + ? WHERE user_id = ?", [transfer.amount, transfer.recipient_id]));
      }
      (await tx.run("UPDATE managed_transfers SET state = 'COMPLETED', reserved = 0 WHERE id = ?", [id]));
    }));
  } else if (remote.state === "FAILED" || remote.state === "CANCELLED") {
    // Partial payments or residual liquidity require operator reconciliation, never a guessed refund.
    (await deps.db.run("UPDATE managed_transfers SET state = 'NEEDS_REVIEW' WHERE id = ? AND state = 'PROCESSING'", [id]));
  }
  return (await getTransfer(deps, id));
}

export async function reconcileManagedPayments(deps: ManagedDeps): Promise<void> {
  const rows = (await deps.db.all("SELECT id FROM managed_transfers WHERE state = 'PROCESSING' AND outgoing_id IS NOT NULL ORDER BY created_at LIMIT 10")) as Array<{ id: string }>;
  for (const row of rows) {
    try { await reconcileTransfer(deps, row.id); } catch { /* Keep the hold; retry later with the same remote IDs. */ }
  }
}

async function prepare(deps: ManagedDeps, user: UserRow, sms: InboundSms, amount: number, recipientPhone: string): Promise<string> {
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 1_000_000_000) throw new AppError("VALIDATION_FAILED", "Usa un monto positivo en pesos enteros, máximo 1000000000 COP.");
  const sender = (await account(deps, user.id));
  const recipient = (await deps.db.get("SELECT * FROM users WHERE phone = ? AND status = 'active' AND phone_verified_at IS NOT NULL", [normalizePhone(recipientPhone)])) as UserRow | undefined;
  if (!recipient) throw new AppError("NOT_FOUND", "El destinatario debe crear y verificar su cuenta primero.");
  if (recipient.id === user.id) throw new AppError("VALIDATION_FAILED", "Elige otro destinatario.");
  const receiver = (await account(deps, recipient.id));
  if (sender.balance < amount) throw new AppError("INSUFFICIENT_FUNDS", "Saldo insuficiente.");
  const key = `${sms.provider}:${sms.messageId}`;
  let transfer = (await deps.db.get("SELECT * FROM managed_transfers WHERE request_key = ?", [key])) as Transfer | undefined;
  if (!transfer) {
    const id = randomUUID();
    (await deps.db.run("INSERT INTO managed_transfers (id, request_key, sender_id, recipient_id, amount, state) VALUES (?, ?, ?, ?, ?, 'PREPARING')", [id, key, user.id, recipient.id, amount]));
    transfer = (await getTransfer(deps, id));
  }
  if (transfer.state === "PREPARING") {
    const quote = await deps.gateway.prepare(transfer.id, sender.wallet_id, receiver.wallet_id, amount);
    const expires = Math.min(Date.now() + 300_000, Date.parse(quote.expiresAt));
    if (!Number.isFinite(expires) || expires <= Date.now()) throw new AppError("QUOTE_EXPIRED", "La cotización expiró; solicita otro pago.");
    (await deps.db.run("UPDATE managed_transfers SET state = 'AWAITING_CONFIRMATION', quote_id = ?, incoming_id = ?, expires_at = ? WHERE id = ? AND state = 'PREPARING'", [quote.quoteId, quote.incomingId, new Date(expires).toISOString(), transfer.id]));
    transfer = (await getTransfer(deps, transfer.id));
  }
  if (transfer.state !== "AWAITING_CONFIRMATION") return `Pago ${transfer.id}: ${transfer.state}.`;
  return `Enviar ${amount} COP de prueba a ${recipient.phone}. CONFIRMAR ${transfer.id} ${code(deps, transfer.id)}. Vence en máximo 5 minutos.`;
}

async function confirm(deps: ManagedDeps, transfer: Transfer, supplied: string): Promise<string> {
  if (transfer.state !== "AWAITING_CONFIRMATION") return `Pago ${transfer.id}: ${transfer.state}.`;
  if (!transfer.expires_at || Date.parse(transfer.expires_at) <= Date.now()) {
    (await deps.db.run("UPDATE managed_transfers SET state = 'EXPIRED' WHERE id = ? AND state = 'AWAITING_CONFIRMATION'", [transfer.id]));
    throw new AppError("CONFIRMATION_EXPIRED", "El pago expiró. Solicita otro pago.");
  }
  if (transfer.attempts >= 5) throw new AppError("FORBIDDEN", "Demasiados códigos incorrectos. Solicita otro pago.");
  const hash = (value: string) => createHash("sha256").update(value).digest();
  if (!timingSafeEqual(hash(code(deps, transfer.id)), hash(supplied.toUpperCase()))) {
    (await deps.db.run("UPDATE managed_transfers SET attempts = attempts + 1 WHERE id = ?", [transfer.id]));
    throw new AppError("CONFIRMATION_INVALID", "Código de confirmación inválido.");
  }
  const reserved = (await deps.db.transaction(async (tx) => {
    const scoped = { ...deps, db: tx };
    const claimed = (await tx.run("UPDATE managed_transfers SET state = 'PROCESSING', reserved = 1 WHERE id = ? AND state = 'AWAITING_CONFIRMATION'", [transfer.id]));
    if (!claimed.changes) return false;
    const debited = (await tx.run("UPDATE managed_accounts SET balance = balance - ? WHERE user_id = ? AND balance >= ?", [transfer.amount, transfer.sender_id, transfer.amount]));
    if (!debited.changes) throw new AppError("INSUFFICIENT_FUNDS", "Saldo insuficiente.");
    (await journal(scoped, `reserve:${transfer.id}`, "PAYMENT_RESERVED", `user:${transfer.sender_id}`, `escrow:${transfer.id}`, transfer.amount));
    return true;
  }));
  if (!reserved) return `Pago ${transfer.id}: ${(await getTransfer(deps, transfer.id)).state}.`;
  try {
    const sender = (await account(deps, transfer.sender_id));
    const outgoingId = await deps.gateway.createOutgoing(transfer.id, sender.wallet_id, transfer.quote_id!);
    (await deps.db.run("UPDATE managed_transfers SET outgoing_id = ? WHERE id = ?", [outgoingId, transfer.id]));
    await deps.gateway.fund(transfer.id, outgoingId);
    await reconcileTransfer(deps, transfer.id);
  } catch {
    // With a saved remote ID reconciliation can resume. Without it, an operator must inspect Rafiki.
    (await deps.db.run("UPDATE managed_transfers SET state = 'NEEDS_REVIEW' WHERE id = ? AND outgoing_id IS NULL", [transfer.id]));
  }
  return `Pago ${transfer.id}: ${(await getTransfer(deps, transfer.id)).state}.`;
}

export async function handleManagedCommand(deps: ManagedDeps, sms: InboundSms): Promise<string> {
  const text = sms.text.trim();
  const phone = normalizePhone(sms.from);
  if (/^AYUDA$/i.test(text)) return HELP;
  let user = (await deps.db.get("SELECT * FROM users WHERE phone = ?", [phone])) as UserRow | undefined;
  if (/^CREAR\s+CUENTA$/i.test(text)) {
    if (!user) user = (await createUser(deps, { phone }));
    if (user.status === "suspended") throw new AppError("FORBIDDEN", "La cuenta está suspendida.");
    if (user.phone_verified_at) return (await provision(deps, user));
    const verification = (await requestPhoneVerification(deps, user.id));
    return `Verifica tu teléfono: VERIFICAR ${verification.code}. Vence en 5 minutos. Cuenta COP de prueba.`;
  }
  const verify = /^VERIFICAR\s+(\d{6})$/i.exec(text);
  if (verify && user) {
    if (user.status === "suspended") throw new AppError("FORBIDDEN", "La cuenta está suspendida.");
    if (!user.phone_verified_at) user = (await verifyPhone(deps, user.id, verify[1]!));
    return (await provision(deps, (await getUserRow(deps.db, user.id))!));
  }
  if (!user || user.status !== "active" || !user.phone_verified_at) throw new AppError("FORBIDDEN", "Primero escribe CREAR CUENTA y verifica tu teléfono por SMS.");
  const own = (await account(deps, user.id));
  if (/^SALDO$/i.test(text)) {
    const pending = (await deps.db.all("SELECT id FROM managed_transfers WHERE (sender_id = ? OR recipient_id = ?) AND state = 'PROCESSING' LIMIT 10", [user.id, user.id])) as Array<{ id: string }>;
    for (const transfer of pending) { try { await reconcileTransfer(deps, transfer.id); } catch { /* Return confirmed ledger balances only. */ } }
    const held = (await deps.db.get("SELECT COALESCE(SUM(amount), 0)::bigint AS value FROM managed_transfers WHERE sender_id = ? AND reserved = 1", [user.id])) as { value: number };
    return `Saldo disponible: ${(await account(deps, user.id)).balance} COP de prueba. Reservado: ${held.value} COP.`;
  }
  const pay = /^PAGAR\s+(\d+)\s+(?:COP\s+)?A\s+(\+?\d+)$/i.exec(text);
  if (pay) return (await prepare(deps, user, sms, Number(pay[1]), pay[2]!));
  const action = /^(CONFIRMAR|CANCELAR|ESTADO)\s+([a-f0-9-]{36})(?:\s+(\S+))?$/i.exec(text);
  if (action) {
    const transfer = (await getTransfer(deps, action[2]!.toLowerCase()));
    if (transfer.sender_id !== own.user_id) throw new AppError("NOT_FOUND", "Pago no encontrado.");
    if (action[1]!.toUpperCase() === "CONFIRMAR") return (await confirm(deps, transfer, action[3] ?? ""));
    if (action[1]!.toUpperCase() === "CANCELAR") {
      if (transfer.state !== "AWAITING_CONFIRMATION" && transfer.state !== "CANCELLED") throw new AppError("PAYMENT_NOT_CANCELLABLE", "El pago ya no se puede cancelar.");
      (await deps.db.run("UPDATE managed_transfers SET state = 'CANCELLED' WHERE id = ? AND state = 'AWAITING_CONFIRMATION'", [transfer.id]));
    } else await reconcileTransfer(deps, transfer.id);
    return `Pago ${transfer.id}: ${(await getTransfer(deps, transfer.id)).state}.`;
  }
  return HELP;
}
