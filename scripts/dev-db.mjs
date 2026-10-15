// Arranca un PostgreSQL local para desarrollo cuando no hay Docker disponible.
// Con Docker usa `docker compose up db` en su lugar.
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import EmbeddedPostgres from "embedded-postgres";

const port = Number(process.env.LOCAL_PG_PORT ?? 5432);
const dataDir = resolve(process.env.LOCAL_PG_DATA ?? ".local-db");
const user = "sms";
const password = "sms_dev_password";
const database = "sms_interledger";

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user,
  password,
  port,
  persistent: true,
  onLog: () => {},
  onError: (error) => console.error(error),
});

if (!existsSync(resolve(dataDir, "PG_VERSION"))) {
  await pg.initialise();
}
await pg.start();
try {
  await pg.createDatabase(database);
} catch {
  // La base ya existe.
}
console.log(`PostgreSQL local escuchando en postgresql://${user}:${password}@localhost:${port}/${database}`);

const shutdown = async () => {
  await pg.stop();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
