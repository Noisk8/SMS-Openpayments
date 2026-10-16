# SMS-Openpayments

SMS payments in Colombia powered by **Interledger / Open Payments**. The idea: a person sends a text
message to pay someone, check a payment status, or create their account — no apps, no internet
connection required.

## Repository layout

```
backend/     Node.js + TypeScript backend (Fastify, better-sqlite3, Zod, Vitest, @interledger/open-payments)
prompts/     AI prompt log (hackathon AI policy)
AI_USAGE.md  AI usage disclosure
```

## Run the backend

```sh
cd backend
npm install
npm run dev            # http://localhost:3000
npm run verify         # typecheck + tests
```

See [`backend/README.md`](backend/README.md) for details.

## AI disclosure

This project uses AI during the hackathon. See [`AI_USAGE.md`](AI_USAGE.md) and [`prompts/`](prompts/).

## Agent workflow

The repository uses the *Agent Workflow Kit* **locally** (`.opencode/`, `.agent-workflow/`,
`scripts/harness/`, `docs/agent-workflow/`), all listed in `.gitignore`: each contributor installs
their own.

## Frontend y Rafiki local

El frontend recuperado está en `frontend/`. Ejecuta `npm ci --prefix frontend` y
`npm run dev:frontend`; abre http://localhost:3005. El backend usa el puerto 3000.
Consulta [frontend/README.md](frontend/README.md) para el simulador de SMS.

El modo opcional `PAYMENT_PROVIDER=rafiki` permite crear cuentas, consultar saldo y
transferir COP por SMS con fondos ficticios. Utiliza la base PostgreSQL que ya configura
`main`: conserva `DATABASE_URL` en `backend/.env`, ejecuta `npm run setup:rafiki`,
`npm run rafiki:up`, `npm run db:migrate` y `npm run dev`.
La migración `003_rafiki_accounts.sql` añade únicamente tablas de cuentas y movimientos
Rafiki y la respuesta persistida de SMS. No incluye migración desde SQLite.

El Compose ejecuta Rafiki con su PostgreSQL y Redis propios. No proporciona un servidor
GNAP para billeteras de terceros: este modo administra cuentas de la misma instancia
mediante su API administrativa. Los modos anteriores `fake` y `openpayments` se conservan.
`npm run smoke:rafiki` comprueba una transferencia local con fondos ficticios, usando
un esquema temporal en la base existente y creando billeteras de prueba en Rafiki.

Twilio debe enviar POST a
`https://sms-openpayments-production.up.railway.app/webhooks/sms`.
Configura `TWILIO_WEBHOOK_URL` con esa misma URL y las credenciales de Twilio en Railway.
Los eventos firmados de Rafiki se reciben por separado en `/webhooks/rafiki`.
Los secretos de `backend/.env` no se incluyen en Git.
