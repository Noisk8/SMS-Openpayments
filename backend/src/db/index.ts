import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { openDatabase, type Db } from "./connection";
import { migrate } from "./migrate";

export type { Db } from "./connection";

/** Abre (o crea) la base y aplica migraciones. `:memory:` para pruebas. */
export function createDatabase(path: string, options: { migrate?: boolean } = {}): Db {
  const shouldMigrate = options.migrate ?? true;
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = openDatabase(path);
  if (shouldMigrate) {
    migrate(db);
  }
  return db;
}
