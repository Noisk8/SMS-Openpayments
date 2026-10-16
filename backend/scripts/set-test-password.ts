import { loadConfig } from "../src/config";
import { setTestPassword, testPasswordEnabled } from "../src/customer/auth";
import { createPoolDatabase } from "../src/db/connection";
import { migrate } from "../src/db/migrate";
import { normalizePhone } from "../src/onboarding/service";

const config = loadConfig();
if (!testPasswordEnabled(config)) throw new Error("Habilita TEST_PASSWORD_LOGIN_ENABLED=true solo en desarrollo con SMS_PROVIDER=mock.");
const phone = normalizePhone(process.env.CHASKY_TEST_PHONE ?? "");
const password = process.env.CHASKY_TEST_PASSWORD;
if (!password) throw new Error("Falta CHASKY_TEST_PASSWORD; no la pases como argumento ni la guardes en Git.");
const db = createPoolDatabase(config.DATABASE_URL);
try {
  const user = await db.get<{ id: string }>("SELECT id FROM users WHERE phone = ? AND status <> 'suspended'", [phone]);
  if (!user) throw new Error("La cuenta no existe o está suspendida.");
  // Aplicar solo el esquema web de esta función sobre una base ya preparada.
  const versions = new Set((await db.all<{ version: string }>("SELECT version FROM schema_migrations")).map(row => row.version));
  for (const version of ["001_init.sql", "002_phone_verifications.sql", "004_demo_wallet_pool.sql"]) {
    if (!versions.has(version)) throw new Error(`Revisa la base antes de continuar: falta ${version}`);
  }
  const ran = await migrate(db);
  await setTestPassword(db, user.id, password);
  console.log(JSON.stringify({ phone, passwordConfigured: true, migrations: ran, verificationChanged: false }));
} finally { await db.close(); }
