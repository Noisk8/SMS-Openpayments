import { randomUUID } from "node:crypto";
import type { Db } from "../db";
import { AppError } from "../errors";
import type { SecretBox } from "../security/encryption";
import type { HistoryGateway, HistoryWallet } from "./history-gateway";

interface Row { id: string; status: string; interact_url: string | null; continue_uri: string | null; continue_token_enc: string | null; access_token_enc: string | null; expires_at: string; next_poll_at: string }
export interface HistoryTransaction { id: string; value: string | null; currency: string | null; asset_scale: number | null; state: string; created_at: string; direction: string; counterparty: string; incoming_payment_id?: string | null }
const after = (seconds: number) => new Date(Date.now() + seconds * 1000).toISOString();

export class WalletHistory {
  constructor(private db: Db, private box: SecretBox | null, private gateway: HistoryGateway) {}
  private async wallet(userId: string) {
    return this.db.get<HistoryWallet>("SELECT id, wallet_address, resource_server, auth_server FROM wallets WHERE user_id = ? ORDER BY created_at DESC, seq DESC LIMIT 1", [userId]);
  }
  async connect(userId: string) {
    const wallet = await this.wallet(userId);
    if (!wallet || !this.box || !this.gateway.supports(wallet)) throw new AppError("CONFLICT", "El equipo debe configurar la lectura de esta wallet.");
    const id = randomUUID();
    const existing = await this.db.transaction(async tx => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended(?, 0))", [`history:${wallet.id}`]);
      const row = await tx.get<Row>("SELECT * FROM wallet_history_grants WHERE wallet_id = ?", [wallet.id]);
      if (row && row.status !== "ERROR" && Date.parse(row.expires_at) > Date.now()) return row;
      await tx.run("DELETE FROM wallet_history_grants WHERE wallet_id = ?", [wallet.id]);
      await tx.run("INSERT INTO wallet_history_grants (wallet_id, id, status, expires_at, next_poll_at) VALUES (?, ?, 'REQUESTING', ?, ?)", [wallet.id, id, after(600), after(5)]);
      return null;
    });
    if (existing) return { connected: existing.status === "GRANTED", authorizeUrl: existing.interact_url };
    try {
      const grant = await this.gateway.request(wallet);
      if (grant.status === "PENDING") {
        await this.db.run("UPDATE wallet_history_grants SET status = 'PENDING', interact_url = ?, continue_uri = ?, continue_token_enc = ?, next_poll_at = ? WHERE id = ?", [grant.redirect, grant.uri, this.box.encrypt(grant.token), after(Math.max(5, grant.wait)), id]);
        return { connected: false, authorizeUrl: grant.redirect };
      }
      await this.saveAccess(id, grant.token, grant.expiresIn);
      return { connected: true, authorizeUrl: null };
    } catch {
      await this.db.run("UPDATE wallet_history_grants SET status = 'ERROR' WHERE id = ?", [id]);
      throw new AppError("PROVIDER_ERROR", "No pudimos solicitar el historial de la wallet. Intenta de nuevo.");
    }
  }
  private async saveAccess(id: string, token: string, seconds: number) {
    await this.db.run("UPDATE wallet_history_grants SET status = 'GRANTED', access_token_enc = ?, continue_token_enc = NULL, interact_url = NULL, expires_at = ? WHERE id = ?", [this.box!.encrypt(token), after(seconds), id]);
  }
  async read(userId: string) {
    const wallet = await this.wallet(userId);
    const base = { payments: [] as HistoryTransaction[], status: "not_connected", authorizeUrl: null as string | null, message: "Mostramos los movimientos del backend. Conecta el historial para incluir pagos recibidos directamente en tu wallet.", more: false };
    if (!wallet || !this.box || !this.gateway.supports(wallet)) return { ...base, status: "not_configured" };
    let row = await this.db.get<Row>("SELECT * FROM wallet_history_grants WHERE wallet_id = ?", [wallet.id]);
    if (!row || row.status === "ERROR" || Date.parse(row.expires_at) <= Date.now()) return base;
    if (row.status === "POLLING" && Date.parse(row.next_poll_at) < Date.now() - 30000) {
      await this.db.run("UPDATE wallet_history_grants SET status = 'PENDING' WHERE id = ? AND status = 'POLLING'", [row.id]);
      row.status = "PENDING";
    }
    if (row.status === "PENDING" && row.continue_uri && row.continue_token_enc && Date.parse(row.next_poll_at) <= Date.now()) {
      const claimed = await this.db.run("UPDATE wallet_history_grants SET status = 'POLLING', next_poll_at = ? WHERE id = ? AND status = 'PENDING' AND next_poll_at <= ?", [after(10), row.id, new Date().toISOString()]);
      if (claimed.changes) {
        try {
          const grant = await this.gateway.poll(row.continue_uri, this.box.decrypt(row.continue_token_enc));
          if ("expiresIn" in grant) await this.saveAccess(row.id, grant.token, grant.expiresIn);
          else await this.db.run("UPDATE wallet_history_grants SET status = 'PENDING', continue_uri = ?, continue_token_enc = ?, next_poll_at = ? WHERE id = ?", [grant.uri, this.box.encrypt(grant.token), after(Math.max(5, grant.wait)), row.id]);
        } catch { await this.db.run("UPDATE wallet_history_grants SET status = 'PENDING' WHERE id = ?", [row.id]); }
        row = (await this.db.get<Row>("SELECT * FROM wallet_history_grants WHERE id = ?", [row.id]))!;
      }
    }
    if (row.status !== "GRANTED" || !row.access_token_enc) return { ...base, status: "pending", authorizeUrl: row.interact_url, message: "Autoriza la lectura de ingresos en tu wallet y vuelve aquí para actualizar." };
    try {
      const result = await this.gateway.list(wallet, this.box.decrypt(row.access_token_enc));
      const payments = result.payments.filter(p => /^\d+$/.test(p.receivedAmount.value) && BigInt(p.receivedAmount.value) > 0n).map(p => ({ id: p.id, value: p.receivedAmount.value, currency: p.receivedAmount.assetCode, asset_scale: p.receivedAmount.assetScale, state: p.completed ? "COMPLETED" : "RECEIVING", created_at: p.createdAt, direction: "received", counterparty: "Ingreso directo a tu wallet" }));
      return { payments, status: "connected", authorizeUrl: null, message: result.more ? "Se consultó una página de hasta 100 ingresos; puede haber más historial." : "Incluye los ingresos consultados en Open Payments.", more: result.more };
    } catch { return { ...base, status: "unavailable", message: "No pudimos consultar los ingresos externos. Los movimientos del backend siguen disponibles." }; }
  }
}

export function mergeHistory(local: HistoryTransaction[], remote: HistoryTransaction[]) {
  const localIncoming = new Set(local.map(t => t.incoming_payment_id).filter(Boolean));
  const byId = new Map(local.map(t => [t.id, t]));
  for (const payment of remote) if (!localIncoming.has(payment.id) && !byId.has(payment.id)) byId.set(payment.id, payment);
  return [...byId.values()].sort((a,b) => Date.parse(b.created_at) - Date.parse(a.created_at)).slice(0,25).map(({ incoming_payment_id: _, ...payment }) => payment);
}
