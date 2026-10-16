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

## Chasky: frontend y backend

El frontend vive en `frontend/`. Ejecuta `npm ci --prefix frontend` y
`npm run dev:frontend`; abre http://localhost:3005. El backend usa el puerto 3000.
Consulta [frontend/README.md](frontend/README.md) para el login, dashboard y simulador.

El backend usa PostgreSQL y Open Payments. `PAYMENT_PROVIDER=openpayments` conecta
con las billeteras de Interledger Test Wallet; `fake` permite pruebas locales sin red.
Configura las credenciales del cliente y el activo de las billeteras en `backend/.env`.
Consulta [backend/docs/test-wallet.md](backend/docs/test-wallet.md) para la conexión.

El transporte SMS disponible es `SMS_PROVIDER=mock`: los mensajes se consultan en el
buzón de desarrollo y no se envían a celulares reales. El webhook genérico
`/webhooks/sms` y el simulador siguen disponibles para pruebas.
Las credenciales privadas de `backend/.env` no se incluyen en Git.
