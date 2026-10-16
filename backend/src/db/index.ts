import { createPoolDatabase, type Db } from "./connection";
import { migrate } from "./migrate";

export type { Db, Queryable, RunResult } from "./connection";
export { rewritePlaceholders } from "./connection";

/**
 * Opens a pooled Postgres connection and (by default) applies pending
 * migrations. Every operation is asynchronous.
 */
export async function createDatabase(
  databaseUrl: string,
  options: { migrate?: boolean } = {},
): Promise<Db> {
  const shouldMigrate = options.migrate ?? true;
  const db = createPoolDatabase(databaseUrl);
  if (shouldMigrate) {
    try {
      await migrate(db);
    } catch (error) {
      await db.close();
      throw error;
    }
  }
  return db;
}
