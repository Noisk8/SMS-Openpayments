import pg from "pg";

const { Pool, types } = pg;

/**
 * PostgreSQL type parsing.
 *
 * `COUNT(*)`, `BIGINT` identity columns and other int8 results are returned as
 * strings by node-postgres by default. The domain never stores amounts as
 * int8 (they live in TEXT columns as scaled integers), so it is safe to parse
 * every int8 as a JS number. This keeps counts and identity values usable
 * directly in TypeScript.
 */
types.setTypeParser(20, (value: string) => Number.parseInt(value, 10));

/** Result of a write statement. Mirrors the `changes` field call sites used. */
export interface RunResult {
  /** Rows affected by the statement (`rowCount`). */
  changes: number;
}

/**
 * A small SQL surface shared by the pool and by a single transaction client.
 * All methods are asynchronous and every statement is parameterized.
 */
export interface Queryable {
  /** Executes the query and returns every row. */
  query<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<T[]>;
  /** Executes the query and returns every row (alias of `query`). */
  all<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<T[]>;
  /** Executes the query and returns the first row, or `undefined`. */
  get<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<T | undefined>;
  /** Executes the query and returns how many rows were affected. */
  run(sql: string, params?: readonly unknown[]): Promise<RunResult>;
}

export interface Db extends Queryable {
  /** Runs `fn` inside a transaction, committing on success and rolling back on error. */
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  /** Closes the underlying connection pool. */
  close(): Promise<void>;
}

export type { Pool };

/**
 * Rewrites `?` placeholders into PostgreSQL's positional `$1, $2, ...` form.
 *
 * This is the only place where placeholders are translated, so every call site
 * can keep writing readable SQL while all values stay parameterized (never
 * interpolated). Question marks inside single-quoted string literals are left
 * untouched.
 */
export function rewritePlaceholders(sql: string): string {
  let index = 0;
  let out = "";
  let inSingleQuote = false;
  for (let i = 0; i < sql.length; i += 1) {
    const char = sql[i];
    if (char === "'") {
      // A doubled '' inside a literal is an escaped quote.
      if (inSingleQuote && sql[i + 1] === "'") {
        out += "''";
        i += 1;
        continue;
      }
      inSingleQuote = !inSingleQuote;
      out += char;
      continue;
    }
    if (char === "?" && !inSingleQuote) {
      index += 1;
      out += `$${index}`;
      continue;
    }
    out += char;
  }
  return out;
}

type Executor = {
  query(text: string, values?: unknown[]): Promise<pg.QueryResult>;
};

/** Binds the `Queryable` surface to a pool or a checked-out transaction client. */
function bind(executor: Executor): Queryable {
  const execute = async (sql: string, params?: readonly unknown[]): Promise<pg.QueryResult> => {
    const text = rewritePlaceholders(sql);
    if (!params || params.length === 0) {
      return executor.query(text);
    }
    return executor.query(text, [...params]);
  };

  return {
    query: async (sql, params) => (await execute(sql, params)).rows,
    all: async (sql, params) => (await execute(sql, params)).rows,
    get: async (sql, params) => (await execute(sql, params)).rows[0],
    run: async (sql, params) => ({ changes: (await execute(sql, params)).rowCount ?? 0 }),
  };
}

/** Creates a `Db` backed by a node-postgres connection pool. */
export function createPoolDatabase(databaseUrl: string): Db {
  const pool = new Pool({ connectionString: databaseUrl });
  const base = bind(pool as unknown as Executor);

  return {
    ...base,
    async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn(bind(client as unknown as Executor));
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
    async close(): Promise<void> {
      await pool.end();
    },
  };
}
