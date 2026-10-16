import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Db } from "./connection";

const DEFAULT_DIR = join(dirname(fileURLToPath(import.meta.url)), "migrations");

/** ISO-8601 UTC text default, matching `new Date().toISOString()` in JS. */
const ISO_NOW = `to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

/**
 * Applies the pending `.sql` migrations in order and records them in
 * `schema_migrations`. Each migration runs in its own transaction. Returns the
 * files that were applied.
 */
export async function migrate(db: Db, dir: string = DEFAULT_DIR): Promise<string[]> {
  await db.run(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       version    TEXT PRIMARY KEY,
       applied_at TEXT NOT NULL DEFAULT (${ISO_NOW})
     )`,
  );
  const appliedRows = await db.all<{ version: string }>("SELECT version FROM schema_migrations");
  const applied = new Set(appliedRows.map((row) => row.version));
  const files = readdirSync(dir)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  const ran: string[] = [];
  for (const file of files) {
    if (applied.has(file)) {
      continue;
    }
    const sql = readFileSync(join(dir, file), "utf8");
    await db.transaction(async (tx) => {
      await tx.query(sql);
      await tx.run("INSERT INTO schema_migrations (version) VALUES (?)", [file]);
    });
    ran.push(file);
  }
  return ran;
}

/** Runs the migrations from the CLI: `npm run db:migrate`. */
async function main(): Promise<void> {
  const { loadConfig } = await import("../config");
  const { createDatabase } = await import("./index");
  const config = loadConfig();
  const db = await createDatabase(config.DATABASE_URL, { migrate: false });
  try {
    const ran = await migrate(db);
    console.log(
      ran.length > 0 ? `Applied migrations: ${ran.join(", ")}` : "No pending migrations.",
    );
  } finally {
    await db.close();
  }
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
