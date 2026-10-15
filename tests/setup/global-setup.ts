import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";

/**
 * Arranca un PostgreSQL real temporal para las pruebas de integración,
 * aplica las migraciones de Prisma y lo detiene al final.
 */
export default async function setup() {
  const dataDir = mkdtempSync(path.join(tmpdir(), "sms-test-pg-"));
  const port = 55432 + Math.floor(Math.random() * 500);
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "test",
    password: "test",
    port,
    persistent: false,
    onLog: () => {},
    onError: () => {},
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("sms_test");
  const databaseUrl = `postgresql://test:test@localhost:${port}/sms_test`;
  execSync("npx prisma migrate deploy", {
    stdio: "ignore",
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
  process.env.DATABASE_URL = databaseUrl;

  return async () => {
    await pg.stop();
    rmSync(dataDir, { recursive: true, force: true });
  };
}
