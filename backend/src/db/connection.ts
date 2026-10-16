import Database from "better-sqlite3";

export type Db = Database.Database;

/**
 * Abre la base SQLite con los PRAGMAs que exige la spec:
 * foreign_keys ON, WAL, busy_timeout y transacciones cortas.
 */
export function openDatabase(path: string): Db {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.pragma("synchronous = NORMAL");
  return db;
}
