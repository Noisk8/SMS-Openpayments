import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Db } from "./connection";

const DEFAULT_DIR = join(dirname(fileURLToPath(import.meta.url)), "migrations");

/**
 * Aplica las migraciones .sql pendientes en orden y las registra en schema_migrations.
 * Cada migración corre en su propia transacción. Devuelve los ficheros aplicados.
 */
export function migrate(db: Db, dir: string = DEFAULT_DIR): string[] {
  db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       version    TEXT PRIMARY KEY,
       applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     )`,
  );
  const appliedRows = db.prepare("SELECT version FROM schema_migrations").all() as Array<{
    version: string;
  }>;
  const applied = new Set(appliedRows.map((r) => r.version));
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const ran: string[] = [];
  for (const file of files) {
    if (applied.has(file)) {
      continue;
    }
    const sql = readFileSync(join(dir, file), "utf8");
    const run = db.transaction(() => {
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations (version) VALUES (?)").run(file);
    });
    run();
    ran.push(file);
  }
  return ran;
}

/** Ejecuta las migraciones desde la CLI: `npm run db:migrate`. */
async function main(): Promise<void> {
  const { loadConfig } = await import("../config");
  const { createDatabase } = await import("./index");
  const config = loadConfig();
  const db = createDatabase(config.SQLITE_PATH, { migrate: false });
  const ran = migrate(db);
  console.log(ran.length > 0 ? `Migraciones aplicadas: ${ran.join(", ")}` : "Sin migraciones pendientes.");
  db.close();
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
