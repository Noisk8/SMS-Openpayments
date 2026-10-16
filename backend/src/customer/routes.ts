import { WalletHistory, mergeHistory, type HistoryTransaction } from "./history";
import { OpenPaymentsHistoryGateway } from "./history-gateway";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../app";
import { getGrantUsage } from "../grants/service";
import { logout, passwordLogin, requestLogin, sessionUser, testPasswordEnabled, verifyLogin } from "./auth";

export function registerCustomerRoutes(app: FastifyInstance, deps: AppDeps) {
  const history = new WalletHistory(deps.db, deps.secretBox, deps.historyGateway ?? new OpenPaymentsHistoryGateway(deps.config));
  app.addHook("onSend", async (request, reply) => {
    if (request.url.startsWith("/customer/")) reply.header("Cache-Control", "no-store");
  });
  app.get("/customer/login/options", async () => ({ testPassword: testPasswordEnabled(deps.config) }));
  app.post("/customer/login/password", async request => {
    const { phone, password } = z.object({ phone: z.string().min(8).max(25), password: z.string().min(7).max(128) }).parse(request.body);
    return passwordLogin(deps.db, deps.config, phone, password, request.ip);
  });
  app.post("/customer/login/request", async request => {
    const { phone } = z.object({ phone: z.string().min(8).max(25) }).parse(request.body);
    return requestLogin(deps.db, deps.provider, deps.config.SMS_FROM, phone, request.ip);
  });
  app.post("/customer/login/verify", async request => {
    const { challengeId, code } = z.object({ challengeId: z.string().uuid(), code: z.string().regex(/^\d{6}$/) }).parse(request.body);
    return verifyLogin(deps.db, challengeId, code);
  });
  const token = (header?: string) => /^Bearer ([A-Za-z0-9_-]+)$/.exec(header ?? "")?.[1] ?? "";
  app.post("/customer/logout", async request => {
    await logout(deps.db, token(request.headers.authorization));
    return { ok: true };
  });
  app.post("/customer/history/connect", async request => {
    const user = await sessionUser(deps.db, token(request.headers.authorization), testPasswordEnabled(deps.config));
    return history.connect(user.id);
  });
  app.get("/customer/dashboard", async request => {
    const user = await sessionUser(deps.db, token(request.headers.authorization), testPasswordEnabled(deps.config));
    const wallets = await deps.db.all<{ id: string; wallet_address: string; currency: string; asset_scale: number }>("SELECT id, wallet_address, currency, asset_scale FROM wallets WHERE user_id = ? ORDER BY created_at DESC", [user.id]);
    const grants = await deps.db.all<{ id: string; status: string; expires_at: string | null }>(`SELECT g.id, g.status, g.expires_at FROM grants g
      JOIN wallets w ON w.id = g.wallet_id WHERE w.user_id = ? ORDER BY g.created_at DESC`, [user.id]);
    let balance: { value: string; currency: string; assetScale: number; kind: "budget" } | null = null;
    let balanceMessage = "Open Payments no devuelve el saldo real de tu wallet. Para mostrarlo aquí se necesita una API de saldo autenticada del proveedor.";
    const activeGrant = grants.find(g => g.status === "GRANTED" && (!g.expires_at || Date.parse(g.expires_at) > Date.now()));
    if (!balance && activeGrant && deps.paymentProvider) {
      try {
        const result = await getGrantUsage({ config: deps.config, db: deps.db, provider: deps.paymentProvider, secretBox: deps.secretBox }, activeGrant.id);
        if (result.usage?.remaining) balance = { ...result.usage.remaining, kind: "budget" };
        else balanceMessage = "El proveedor no expone saldo ni presupuesto disponible mediante esta conexión. Puedes consultar el saldo en Test Wallet.";
      } catch { balanceMessage = "No pudimos consultar el proveedor. Vuelve a actualizar en unos instantes."; }
    }
    const transactions = await deps.db.all<HistoryTransaction>(`SELECT p.id, p.incoming_payment_id,
          CASE WHEN p.sender_user_id = ? THEN p.debit_value ELSE p.receive_value END AS value,
          CASE WHEN p.sender_user_id = ? THEN p.debit_currency ELSE p.receive_currency END AS currency,
          CASE WHEN p.sender_user_id = ? THEN p.debit_scale ELSE p.receive_scale END AS asset_scale,
          p.state, p.created_at, CASE WHEN p.sender_user_id = ? THEN 'sent' ELSE 'received' END AS direction,
          CASE WHEN p.sender_user_id = ? THEN p.recipient_wallet_address ELSE sender.phone END AS counterparty
          FROM payments p JOIN users sender ON sender.id = p.sender_user_id
          WHERE p.sender_user_id = ? OR EXISTS (SELECT 1 FROM wallets w WHERE w.user_id = ? AND w.wallet_address = p.recipient_wallet_address)
          ORDER BY p.created_at DESC LIMIT 25`, Array(7).fill(user.id));
    const externalHistory = await history.read(user.id);
    const movements = mergeHistory(transactions, externalHistory.payments);
    const demo = await deps.db.get<{ funding_status: string; authorization_status: string }>("SELECT funding_status, authorization_status FROM demo_assignments WHERE user_id = ?", [user.id]);
    return { user: { phone: user.phone, status: user.status, phoneVerified: Boolean(user.phone_verified_at) }, provider: deps.paymentProvider?.name ?? "Sin proveedor",
      testMode: deps.config.PAYMENT_PROVIDER !== "openpayments" || deps.config.DEMO_WALLET_ASSIGNMENT_ENABLED === "true",
      balance, balanceMessage: balance ? null : balanceMessage,
      wallets: wallets.map(({ id: _, ...wallet }) => wallet),
      grants: grants.map(({ id: _, ...grant }) => grant), transactions: movements, history: { status: externalHistory.status, message: externalHistory.message, authorizeUrl: externalHistory.authorizeUrl }, demo: demo ?? null, updatedAt: new Date().toISOString() };
  });
}
