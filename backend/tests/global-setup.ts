import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import EmbeddedPostgres from "embedded-postgres";

/**
 * Vitest global setup: starts a real, disposable PostgreSQL instance with
 * `embedded-postgres` (no Docker, no external credentials), applies migrations
 * lazily from `createDatabase`, and exposes the base URL to the tests through
 * `TEST_DATABASE_URL`.
 *
 * When `TEST_DATABASE_URL` is already set, that database is used as-is so CI or
 * local development can point the suite at another Postgres.
 */

const TEST_DB_NAME = "sms_openpayments_test";
const TEST_DB_USER = "postgres";
const TEST_DB_PASSWORD = "postgres";

let embedded: EmbeddedPostgres | undefined;
let dataDir: string | undefined;

export async function setup(): Promise<void> {
  if (process.env.TEST_DATABASE_URL) {
    return;
  }

  const port = await findFreePort();
  dataDir = await mkdtemp(join(tmpdir(), "sms-openpayments-pg-"));
  embedded = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: TEST_DB_USER,
    password: TEST_DB_PASSWORD,
    port,
    persistent: false,
    onLog: () => {},
    onError: (message) => {
      process.stderr.write(`[embedded-postgres] ${String(message)}\n`);
    },
  });

  await embedded.initialise();
  await embedded.start();
  await embedded.createDatabase(TEST_DB_NAME);

  const url = `postgresql://${TEST_DB_USER}:${TEST_DB_PASSWORD}@localhost:${port}/${TEST_DB_NAME}`;
  process.env.TEST_DATABASE_URL = url;
  process.env.DATABASE_URL = url;
}

export async function teardown(): Promise<void> {
  if (embedded) {
    await embedded.stop();
    embedded = undefined;
  }
  if (dataDir) {
    await rm(dataDir, { recursive: true, force: true });
    dataDir = undefined;
  }
}

/** Reserves an ephemeral port so parallel checkouts do not collide. */
function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address === "object" && address !== null) {
        const { port } = address;
        server.close(() => resolve(port));
        return;
      }
      server.close(() => reject(new Error("Could not determine a free port.")));
    });
  });
}
