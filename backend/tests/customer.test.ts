import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { passwordLogin, sessionUser, setTestPassword } from "../src/customer/auth";
import { buildApp } from "../src/app";
import { SecretBox, generateEncryptionKey } from "../src/security/encryption";
import type { Db } from "../src/db";
import { createUser } from "../src/onboarding/service";
import { testConfig, testDb, testPaymentProvider, testProvider } from "./helpers";
import type { MockSmsProvider } from "../src/sms/providers/mock";

describe("Acceso y dashboard Chasky", () => {
  let db: Db;
  let app: FastifyInstance;
  let sms: MockSmsProvider;
  let userId: string;
  const alice = "+573001234567";
  async function post(url: string, payload: Record<string, unknown>) { return app.inject({ method: "POST", url: `/customer/${url}`, payload }); }
  async function request(phone = alice) { return (await post("login/request", { phone })).json(); }
  function lastCode() { return /código de acceso es (\d{6})/.exec(sms.outbox.at(-1)!.text)![1]; }
  async function login() {
    const challenge = await request();
    const response = await post("login/verify", { challengeId: challenge.challengeId, code: lastCode() });
    expect(response.statusCode).toBe(200);
    return { ...response.json(), challengeId: challenge.challengeId };
  }
  const dashboard = (token: string) => app.inject({ method: "GET", url: "/customer/dashboard", headers: { authorization: `Bearer ${token}` } });
  beforeEach(async () => {
    db = await testDb();
    const config = testConfig();
    sms = testProvider(config);
    const user = await createUser({ db }, { phone: alice }); userId = user.id;
    await db.run("UPDATE users SET status = 'active', phone_verified_at = ? WHERE id = ?", [new Date().toISOString(), userId]);
    app = buildApp({ db, config, provider: sms, paymentProvider: testPaymentProvider(), secretBox: null });
  });
  afterEach(async () => { await app.close(); await db.close(); });

  it("envía el OTP solo por SMS, guarda hashes, consume el código una vez y revoca la sesión", async () => {
    const result = await login();
    expect(result.token).toHaveLength(43);
    const stored = await db.get<{ token_hash: string }>("SELECT token_hash FROM web_sessions");
    expect(stored?.token_hash).not.toBe(result.token);
    const response = await dashboard(result.token);
    expect(response.statusCode).toBe(200);
    expect(response.json().user.phone).toBe(alice);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(JSON.stringify(response.json())).not.toContain("access_token");
    expect((await post("login/verify", { challengeId: result.challengeId, code: lastCode() })).statusCode).toBe(401);
    await app.inject({ method: "POST", url: "/customer/logout", headers: { authorization: `Bearer ${result.token}` } });
    expect((await dashboard(result.token)).statusCode).toBe(401);
  });

  it("no revela números desconocidos ni acepta cuentas sin verificar o suspendidas", async () => {
    const unknown = await request("+573009999999");
    expect(unknown).toHaveProperty("challengeId"); expect(unknown).not.toHaveProperty("code");
    expect(sms.outbox).toHaveLength(0);
    expect((await post("login/verify", { challengeId: unknown.challengeId, code: "123456" })).statusCode).toBe(401);
    await db.run("UPDATE users SET phone_verified_at = NULL WHERE id = ?", [userId]);
    expect((await request()).message).toBe(unknown.message);
    expect(sms.outbox).toHaveLength(0);
  });

  it("persiste intentos fallidos y bloquea el sexto aunque el código sea correcto", async () => {
    const challenge = await request(); const valid = lastCode();
    const invalid = valid === "111111" ? "222222" : "111111";
    for (let i = 0; i < 5; i++) expect((await post("login/verify", { challengeId: challenge.challengeId, code: invalid })).statusCode).toBe(401);
    expect((await db.get<{ attempts: number }>("SELECT attempts FROM web_login_challenges WHERE id = ?", [challenge.challengeId]))?.attempts).toBe(5);
    expect((await post("login/verify", { challengeId: challenge.challengeId, code: valid })).statusCode).toBe(401);
  });

  it("rechaza códigos y sesiones vencidos, y sesiones de un usuario suspendido", async () => {
    const result = await login();
    await db.run("UPDATE users SET status = 'suspended' WHERE id = ?", [userId]);
    expect((await dashboard(result.token)).statusCode).toBe(401);
    await db.run("UPDATE users SET status = 'active' WHERE id = ?", [userId]);
    await db.run("UPDATE web_sessions SET expires_at = '2000-01-01'");
    expect((await dashboard(result.token)).statusCode).toBe(401);
    await db.run("UPDATE web_login_challenges SET consumed = FALSE, expires_at = '2000-01-01' WHERE id = ?", [result.challengeId]);
    expect((await post("login/verify", { challengeId: result.challengeId, code: lastCode() })).statusCode).toBe(401);
  });

  it("solo permite una verificación concurrente y limita solicitudes repetidas", async () => {
    const challenge = await request(); const code = lastCode();
    await request(); expect(sms.outbox).toHaveLength(1);
    const results = await Promise.all([post("login/verify", { challengeId: challenge.challengeId, code }), post("login/verify", { challengeId: challenge.challengeId, code })]);
    expect(results.map(r => r.statusCode).sort()).toEqual([200, 401]);
  });

  it("invalida el OTP si falla el envío, sin revelar si existe el usuario", async () => {
    vi.spyOn(sms, "sendMessage").mockResolvedValueOnce({ status: "failed" });
    const result = await request();
    expect(result).not.toHaveProperty("code");
    expect((await db.get<{ consumed: boolean }>("SELECT consumed FROM web_login_challenges WHERE id = ?", [result.challengeId]))?.consumed).toBe(true);
  });

  it("aísla los datos de otro cliente y no presenta saldo inventado", async () => {
    const other = await createUser({ db }, { phone: "+573008888888" });
    await db.run(`INSERT INTO wallets (id, user_id, wallet_address, currency, asset_scale) VALUES ('other-wallet', ?, 'https://wallet.example/private', 'COP', 0)`, [other.id]);
    const result = await login();
    const response = await dashboard(result.token);
    expect(response.json().wallets).toEqual([]);
    expect(response.json().balance).toBeNull();
    expect(response.json().transactions).toEqual([]);
    expect(response.body).not.toContain("wallet.example/private");
    expect((await app.inject({ method: "GET", url: `/customer/dashboard?userId=${other.id}` })).statusCode).toBe(401);
  });
  it("muestra el presupuesto real del proveedor sin exponer sus credenciales", async () => {
    await app.close();
    const provider = testPaymentProvider();
    const box = new SecretBox(generateEncryptionKey());
    const usage = vi.spyOn(provider, "getGrantUsage").mockResolvedValue({ remaining: { value: "25000", currency: "COP", assetScale: 0 } });
    app = buildApp({ db, config: testConfig(), provider: sms, paymentProvider: provider, secretBox: box });
    await db.run("INSERT INTO wallets (id, user_id, wallet_address, currency, asset_scale) VALUES ('alice-wallet', ?, 'https://wallet.example/alice', 'COP', 0)", [userId]);
    await db.run("INSERT INTO grants (id, wallet_id, status, access_token_enc) VALUES ('alice-grant', 'alice-wallet', 'GRANTED', ?)", [box.encrypt("private-provider-token")]);
    const result = await login();
    const response = await dashboard(result.token);
    expect(response.json().balance).toEqual({ value: "25000", currency: "COP", assetScale: 0, kind: "budget" });
    expect(usage).toHaveBeenCalledOnce();
    expect(response.body).not.toContain("private-provider-token");
    usage.mockRejectedValueOnce(new Error("timeout"));
    const unavailable = await dashboard(result.token);
    expect(unavailable.statusCode).toBe(200);
    expect(unavailable.json().balance).toBeNull();
    expect(unavailable.json().balanceMessage).toContain("No pudimos consultar");
  });

  it("permite la contraseña de prueba sin marcar el teléfono verificado y la bloquea en producción", async () => {
    await db.run("UPDATE users SET status = 'pending', phone_verified_at = NULL WHERE id = ?", [userId]);
    await setTestPassword(db, userId, "test-password");
    const config = testConfig({ TEST_PASSWORD_LOGIN_ENABLED: "true" });
    const login = await passwordLogin(db, config, alice, "test-password", "127.0.0.1");
    expect((await sessionUser(db, login.token, true)).status).toBe("pending");
    await expect(sessionUser(db, login.token)).rejects.toThrow();
    const user = await db.get<{ phone_verified_at: string | null }>("SELECT phone_verified_at FROM users WHERE id = ?", [userId]);
    expect(user?.phone_verified_at).toBeNull();
    await expect(passwordLogin(db, testConfig(), alice, "test-password", "127.0.0.1")).rejects.toThrow("no disponible");
    await expect(passwordLogin(db, { ...config, NODE_ENV: "production" }, alice, "test-password", "127.0.0.1")).rejects.toThrow("no disponible");
    await expect(passwordLogin(db, config, alice, "wrong-password", "127.0.0.1")).rejects.toThrow("incorrectos");
    const row = await db.get<{ password_hash: string }>("SELECT password_hash FROM web_test_credentials WHERE user_id = ?", [userId]);
    expect(row?.password_hash).not.toBe("test-password");
    await setTestPassword(db, userId, "new-test-password");
    await expect(sessionUser(db, login.token, true)).rejects.toThrow();
  });

  it("limita los intentos de contraseña y rechaza cuentas suspendidas", async () => {
    const config = testConfig({ TEST_PASSWORD_LOGIN_ENABLED: "true" });
    await setTestPassword(db, userId, "test-password");
    for (let i = 0; i < 10; i++) await expect(passwordLogin(db, config, alice, "bad-test-password", "127.0.0.1")).rejects.toThrow();
    await expect(passwordLogin(db, config, alice, "test-password", "127.0.0.1")).rejects.toThrow();
    await db.run("DELETE FROM web_login_challenges");
    await db.run("UPDATE users SET status = 'suspended' WHERE id = ?", [userId]);
    await expect(passwordLogin(db, config, alice, "test-password", "127.0.0.1")).rejects.toThrow();
  });

  it("no registra rutas administrativas de las integraciones retiradas", async () => {
    expect((await app.inject({ method: "POST", url: "/webhooks/rafiki", payload: {} })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/internal/rafiki/rates" })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: "/admin/test/accounts/fund", payload: {} })).statusCode).toBe(404);
  });

  it("no confunde ingresos registrados con el saldo disponible del proveedor", async () => {
    const bob = await createUser({db}, {phone:"+573008888888"});
    await db.run("INSERT INTO wallets(id,user_id,wallet_address,currency,asset_scale) VALUES ('my-wallet',?,'https://wallet.example/me','COP',2),('bob-wallet',?,'https://wallet.example/bob','COP',2)",[userId,bob.id]);
    await db.run(`INSERT INTO payments(id,reference,sender_user_id,sender_wallet_id,recipient_wallet_address,state,debit_value,debit_currency,debit_scale,receive_value,receive_currency,receive_scale)
      VALUES ('external-credit','credit-ref',?,'bob-wallet','https://wallet.example/me','COMPLETED','100000','COP',2,'100000','COP',2)`,[bob.id]);
    const session = await login(); const response = await dashboard(session.token);
    expect(response.json().transactions[0]).toMatchObject({direction:"received",value:"100000"});
    expect(response.json().balance).toBeNull();
    expect(response.json().balanceMessage).toContain("API de saldo autenticada");
  });

});
