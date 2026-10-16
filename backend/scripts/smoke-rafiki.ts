import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { loadConfig } from "../src/config";
import { createPoolDatabase } from "../src/db/connection";
import { createDatabase } from "../src/db";
import { RafikiAdminGateway } from "../src/managed/rafiki";
import { handleManagedCommand, fundTestAccount, reconcileManagedPayments } from "../src/managed/service";

const config = loadConfig();
if (config.PAYMENT_PROVIDER !== "rafiki") throw new Error("Configura PAYMENT_PROVIDER=rafiki primero.");
// Compose puede haber iniciado el contenedor sin que su API esté lista todavía.
for (let attempt = 0; attempt < 30; attempt++) {
  try {
    const health = await fetch(config.RAFIKI_ADMIN_URL.replace(/\/graphql$/, "/healthz"), { signal: AbortSignal.timeout(1000) });
    if (health.ok) break;
  } catch { /* Esperar el arranque local. */ }
  if (attempt === 29) throw new Error("Rafiki no está disponible; ejecuta npm run rafiki:up.");
  await delay(1000);
}
const admin = createPoolDatabase(config.DATABASE_URL);
const schema = `smoke_${randomUUID().replaceAll("-", "")}`;
await admin.run(`CREATE SCHEMA ${schema}`);
const isolated = new URL(config.DATABASE_URL);
isolated.searchParams.set("options", `-c search_path=${schema}`);
const db = await createDatabase(isolated.toString());
const deps = { config, db, gateway: new RafikiAdminGateway(config) };
let sequence = 0;
const sms = async (phone: string, text: string) => (await handleManagedCommand(deps, { provider: "smoke", messageId: `smoke-${++sequence}-${randomUUID()}`, from: phone, to: "+15550000000", text, receivedAt: new Date().toISOString() }));
try {
  for (const phone of ["+573000000001", "+573000000002"]) {
    const reply = await sms(phone, "CREAR CUENTA");
    const code = /VERIFICAR (\d{6})/.exec(reply)?.[1];
    if (!code) throw new Error("No se generó verificación");
    await sms(phone, `VERIFICAR ${code}`);
  }
  console.log("Dos cuentas COP creadas en Rafiki y verificadas por el flujo SMS.");
  (await fundTestAccount(deps, "+573000000001", 10000, randomUUID()));
  const proposal = await sms("+573000000001", "PAGAR 5000 A +573000000002");
  const command = /CONFIRMAR ([a-f0-9-]+) ([A-Z0-9]+)/.exec(proposal);
  if (!command) throw new Error("No se generó cotización");
  await sms("+573000000001", command[0]);
  let state = "";
  for (let attempt = 0; attempt < 30; attempt++) {
    await reconcileManagedPayments(deps);
    state = ((await db.get("SELECT state FROM managed_transfers WHERE id = ?", [command[1]])) as { state: string }).state;
    if (state === "COMPLETED" || state === "NEEDS_REVIEW") break;
    await delay(1000);
  }
  if (state !== "COMPLETED") throw new Error(`El pago no terminó: ${state}. Consultar Rafiki antes de otro intento.`);
  const balances = (await db.all("SELECT balance FROM managed_accounts ORDER BY user_id")) as Array<{ balance: number }>;
  if (balances.length !== 2 || balances.some(account => account.balance !== 5000)) throw new Error("Los saldos no coinciden");
  console.log("Transferencia real en Rafiki local COMPLETED: emisor 5000 COP, receptor 5000 COP (fondos ficticios).");
} finally {
  await db.close();
  try { await admin.run(`DROP SCHEMA ${schema} CASCADE`); } finally { await admin.close(); }
}
