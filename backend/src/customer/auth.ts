import { createHash, randomBytes, randomInt, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import type { AppConfig } from "../config";
import type { Db } from "../db";
import { AppError } from "../errors";
import { normalizePhone } from "../onboarding/service";
import type { SmsProvider } from "../sms/types";

export const SESSION_SECONDS = 8 * 60 * 60;
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const denied = () => new AppError("UNAUTHORIZED", "Código inválido o vencido. Solicita uno nuevo.");
interface Challenge { id: string; user_id: string | null; code_hash: string; salt: string; attempts: number; consumed: boolean; expires_at: string }
export interface CustomerUser { id: string; phone: string; status: string; phone_verified_at?: string | null }

export async function requestLogin(db: Db, sms: SmsProvider, from: string, phoneInput: string, ip: string) {
  const phone = normalizePhone(phoneInput);
  const id = randomUUID();
  const code = randomInt(100000, 1000000).toString();
  const salt = randomBytes(16).toString("hex");
  const codeHash = scryptSync(code, salt, 32).toString("hex");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 300000).toISOString();
  const ipHash = digest(ip);
  const user = await db.transaction(async tx => {
    await tx.run("DELETE FROM web_login_challenges WHERE created_at < ?", [new Date(now.getTime() - 86400000).toISOString()]);
    await tx.run("DELETE FROM web_sessions WHERE expires_at < ?", [now.toISOString()]);
    // El límite sobre IP y teléfono es compartido entre instancias y atómico.
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended(?, 0))", [`login-ip:${ipHash}`]);
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended(?, 0))", [`login-phone:${phone}`]);
    const since = new Date(now.getTime() - 3600000).toISOString();
    const counts = await tx.get<{ phone_count: number; ip_count: number; recent: number }>(`SELECT
      COUNT(*) FILTER (WHERE phone = ?)::int AS phone_count,
      COUNT(*) FILTER (WHERE ip_hash = ?)::int AS ip_count,
      COUNT(*) FILTER (WHERE phone = ? AND created_at > ?)::int AS recent
      FROM web_login_challenges WHERE created_at > ? AND (phone = ? OR ip_hash = ?)`,
      [phone, ipHash, phone, new Date(now.getTime() - 60000).toISOString(), since, phone, ipHash]);
    if (counts && (counts.phone_count >= 5 || counts.ip_count >= 20 || counts.recent > 0)) return undefined;
    const found = await tx.get<CustomerUser>("SELECT id, phone, status FROM users WHERE phone = ? AND status = 'active' AND phone_verified_at IS NOT NULL", [phone]);
    await tx.run("UPDATE web_login_challenges SET consumed = TRUE WHERE phone = ?", [phone]);
    await tx.run(`INSERT INTO web_login_challenges (id, phone, ip_hash, user_id, code_hash, salt, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [id, phone, ipHash, found?.id ?? null, codeHash, salt, now.toISOString(), expiresAt]);
    return found;
  });
  if (user) {
    try {
      const result = await sms.sendMessage({ to: phone, from, text: `Chasky: tu código de acceso es ${code}. Vence en 5 minutos. No lo compartas. No confirma pagos.` });
      if (result.status === "failed") throw new Error("SMS no entregado");
    } catch {
      await db.run("UPDATE web_login_challenges SET consumed = TRUE WHERE id = ?", [id]);
      // Respuesta uniforme: no permite descubrir si el número está registrado.
    }
  }
  return { challengeId: id, expiresAt, message: "Si tienes una cuenta activa, recibirás un código por SMS." };
}

export async function verifyLogin(db: Db, id: string, code: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_SECONDS * 1000).toISOString();
  const accepted = await db.transaction(async tx => {
    const row = await tx.get<Challenge>("SELECT * FROM web_login_challenges WHERE id = ? FOR UPDATE", [id]);
    if (!row || row.consumed || row.attempts >= 5 || Date.parse(row.expires_at) <= Date.now()) return false;
    await tx.run("UPDATE web_login_challenges SET attempts = attempts + 1 WHERE id = ?", [id]);
    const actual = scryptSync(code, row.salt, 32);
    if (!timingSafeEqual(actual, Buffer.from(row.code_hash, "hex")) || !row.user_id) return false;
    const user = await tx.get("SELECT id FROM users WHERE id = ? AND status = 'active' AND phone_verified_at IS NOT NULL", [row.user_id]);
    if (!user) return false;
    await tx.run("UPDATE web_login_challenges SET consumed = TRUE WHERE id = ?", [id]);
    await tx.run("INSERT INTO web_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)", [digest(token), row.user_id, expiresAt]);
    return true;
  });
  // Se lanza fuera de la transacción para conservar los intentos fallidos.
  if (!accepted) throw denied();
  return { token, expiresAt, maxAge: SESSION_SECONDS };
}

export async function sessionUser(db: Db, token: string, allowTest = false): Promise<CustomerUser> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new AppError("UNAUTHORIZED", "Inicia sesión para continuar.");
  const user = await db.get<CustomerUser>(`SELECT u.id, u.phone, u.status, u.phone_verified_at FROM web_sessions s
    JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?
    AND ((s.is_test = FALSE AND u.status = 'active' AND u.phone_verified_at IS NOT NULL)
      OR (s.is_test = TRUE AND ? = TRUE AND u.status <> 'suspended'))`, [digest(token), new Date().toISOString(), allowTest]);
  if (!user) throw new AppError("UNAUTHORIZED", "Tu sesión venció. Ingresa de nuevo.");
  return user;
}

export async function logout(db: Db, token: string) {
  await db.run("DELETE FROM web_sessions WHERE token_hash = ?", [digest(token)]);
}


export function testPasswordEnabled(config: AppConfig) {
  return config.NODE_ENV !== "production" && config.SMS_PROVIDER === "mock" && config.TEST_PASSWORD_LOGIN_ENABLED === "true";
}

export async function setTestPassword(db: Db, userId: string, password: string) {
  if (password.length < 7 || password.length > 128) throw new AppError("VALIDATION_FAILED", "La contraseña de prueba requiere entre 7 y 128 caracteres.");
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 32).toString("hex");
  await db.run(`INSERT INTO web_test_credentials (user_id, password_hash, salt) VALUES (?, ?, ?)
    ON CONFLICT (user_id) DO UPDATE SET password_hash = EXCLUDED.password_hash, salt = EXCLUDED.salt`, [userId, hash, salt]);
  await db.run("DELETE FROM web_sessions WHERE user_id = ? AND is_test = TRUE", [userId]);
}

export async function passwordLogin(db: Db, config: AppConfig, phoneInput: string, password: string, ip: string) {
  if (!testPasswordEnabled(config)) throw new AppError("NOT_FOUND", "Acceso de prueba no disponible.");
  const phone = normalizePhone(phoneInput);
  const token = randomBytes(32).toString("base64url");
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + SESSION_SECONDS * 1000).toISOString();
  const ipHash = digest(ip);
  const accepted = await db.transaction(async tx => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended(?, 0))", [`login-ip:${ipHash}`]);
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended(?, 0))", [`login-phone:${phone}`]);
    const counts = await tx.get<{ phone_count: number; ip_count: number }>(`SELECT
      COUNT(*) FILTER (WHERE phone = ?)::int AS phone_count,
      COUNT(*) FILTER (WHERE ip_hash = ?)::int AS ip_count
      FROM web_login_challenges WHERE created_at > ? AND (phone = ? OR ip_hash = ?)`,
      [phone, ipHash, new Date(Date.now() - 3600000).toISOString(), phone, ipHash]);
    if (counts && (counts.phone_count >= 10 || counts.ip_count >= 40)) return false;
    await tx.run(`INSERT INTO web_login_challenges (id, phone, ip_hash, code_hash, salt, consumed, created_at, expires_at)
      VALUES (?, ?, ?, 'unused', 'unused', TRUE, ?, ?)`, [randomUUID(), phone, ipHash, now, now]);
    const row = await tx.get<{ id: string; password_hash: string; salt: string }>(`SELECT u.id, c.password_hash, c.salt FROM users u
      JOIN web_test_credentials c ON c.user_id = u.id WHERE u.phone = ? AND u.status <> 'suspended'`, [phone]);
    const hash = scryptSync(password, row?.salt ?? "chasky-invalid-password", 32);
    if (!row || !timingSafeEqual(hash, Buffer.from(row.password_hash, "hex"))) return false;
    await tx.run("INSERT INTO web_sessions (token_hash, user_id, expires_at, is_test) VALUES (?, ?, ?, TRUE)", [digest(token), row.id, expiresAt]);
    return true;
  });
  if (!accepted) throw new AppError("UNAUTHORIZED", "Número o contraseña incorrectos, o límite de intentos alcanzado.");
  return { token, expiresAt, maxAge: SESSION_SECONDS };
}
