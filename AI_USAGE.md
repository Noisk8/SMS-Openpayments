# AI Usage Disclosure

This file satisfies the **AI Policy** of the 2026 Open Payments Hackathon: it declares which AI
tools were used, for what, and where in the project. The real prompts are stored in
[`prompts/`](prompts/).

## Tools used

- **OpenCode** (AI agent; model **DeepSeek V4.1 Flash**) — used in this session to reset the
  repository, write the AI disclosure, install the local agent workflow, and build the backend.
- **OpenCode** (AI agent; model **claude-haiku-5-5**) — used to review the local Rafiki test node,
  compare it with `origin/main` and prepare this documentation-only branch. No application code was
  generated in this step.
- **Previous AI assistants** — the original prototype (Next.js + Prisma + SMS providers + mock mode)
  was generated with AI assistance before the reset. That code was removed from the working tree and
  is preserved only in git history.

## Where and how AI was used

### 1. Repository reset to a clean skeleton

- The agent researched the official Open Payments SDKs and removed the previous application code.
- The team decided the scope (what to delete and what to keep); the agent executed the cleanup.

### 2. AI disclosure and agent documentation

- `AI_USAGE.md`, `prompts/` and `AGENTS.md`: drafted with the agent and reviewed by the team.

### 3. Agent workflow (local only)

- Installed the *Agent Workflow Kit* (`Another-DevX/agent-workflow-kit`) with its official CLI. The
  paths it generates are in `.gitignore` and are not published.

### 4. Backend implementation (`backend/`)

- The agent scaffolded the backend foundation and the first feature verticals: environment config,
  SQLite schema and migrations, the SMS gateway (webhook, persistence, deduplication, dev simulator),
  the persistent job queue, secret encryption, the payments domain and the accounts domain.
- Files to review by hand: the Open Payments adapter (`backend/src/payments/open-payments.ts`) and
  the payment service (`backend/src/payments/service.ts`) — the team will read, correct and test the
  Open Payments flow itself as the lowest-AI part of the codebase.

### 5. Rafiki test-node review (analysis only)

- The agent checked the local Rafiki v2.4.5 test node (`docker`, signed read-only admin query,
  secrets handling and the Docker compose file) and compared the team's Open Payments design with
  an alternative platform-managed account model.
- The alternative model was not adopted. Its prompts are kept as history
  (`prompts/2026-10-16-cuentas-sms-rafiki-propio.md`). No code from that branch is in `main`.
- Files with AI-generated text in this step: `AI_USAGE.md` and `prompts/` (the index and the prompt
  logs). No application code changed.

### 6. Test Wallet configuration and Twilio adapter (AI-generated code, human-reviewed)

- `backend/src/payments/test-wallet-check.ts`, `backend/scripts/check-test-wallet.ts` and
  `backend/tests/test-wallet-check.test.ts`: read-only preflight for a Test Wallet client key and
  wallets. Generated with the agent; the team must review it before relying on it.
- `backend/src/sms/providers/twilio.ts` and `backend/tests/twilio.test.ts`: Twilio adapter for the
  `SmsProvider` interface, with signed-webhook tests. Ported from an earlier branch and adapted to the
  current PostgreSQL code.
- Edited to support them: `backend/src/config.ts`, `backend/src/app.ts` (form parsing),
  `backend/src/sms/provider-factory.ts`, `backend/src/sms/routes.ts` (TwiML content type),
  `backend/tsconfig.json`, `backend/package.json` and `backend/.env.example`.
- Documentation written with the agent: `backend/docs/test-wallet.md`.
- Not AI-generated: the Open Payments adapter (`backend/src/payments/open-payments.ts`), the payment
  service and the database layer. These are the files the team reviews by hand.

## What we did ourselves

- Chose the account model: the team's model (users' own wallets and grants), not a platform-managed
  account model.
- Pending: create the Test Wallet accounts and generate the client keys (manual, in the browser).

- Defined the scope, the stack and the cuts.
- Owned the Open Payments design decisions (grant budgets, confirmation model).
- (Ongoing) Reviewing and testing every AI change before accepting it.

## Prompt log

See [`prompts/`](prompts/):

- [`prompts/2026-10-16-reinicio-y-sdk.md`](prompts/2026-10-16-reinicio-y-sdk.md)
- [`prompts/2026-10-16-divulgacion-ia.md`](prompts/2026-10-16-divulgacion-ia.md)
- [`prompts/2026-10-16-workflow-agentes.md`](prompts/2026-10-16-workflow-agentes.md)
- [`prompts/2026-10-16-cierre-bootstrap.md`](prompts/2026-10-16-cierre-bootstrap.md)
- [`prompts/2026-10-16-specs-backend.md`](prompts/2026-10-16-specs-backend.md)
- [`prompts/2026-10-16-english-convention.md`](prompts/2026-10-16-english-convention.md)
- [`prompts/2026-10-16-alcance-cop.md`](prompts/2026-10-16-alcance-cop.md)
- [`prompts/2026-10-16-testwallet-open-payments.md`](prompts/2026-10-16-testwallet-open-payments.md)
- [`prompts/2026-10-16-cuentas-sms-rafiki-propio.md`](prompts/2026-10-16-cuentas-sms-rafiki-propio.md)
- [`prompts/2026-10-16-entorno-testnet.md`](prompts/2026-10-16-entorno-testnet.md)
- [`prompts/2026-10-16-integracion-rafiki.md`](prompts/2026-10-16-integracion-rafiki.md)
- [`prompts/2026-10-16-webhook-twilio.md`](prompts/2026-10-16-webhook-twilio.md)
- [`prompts/2026-10-16-demo-wallet-pool.md`](prompts/2026-10-16-demo-wallet-pool.md)

> Note: update this file whenever AI touches new code.

## Integración de frontend y Rafiki sobre main (2026-10-16)

Se usó OpenAI Codex para recuperar y adaptar `frontend/`, integrar `backend/src/managed/`,
la migración aditiva `003_rafiki_accounts.sql`, configuración, rutas, arranque, scripts,
pruebas, Compose y documentación. Se conservan las implementaciones PostgreSQL y Open
Payments de main; no se incluye el importador SQLite ni la migración local de base de datos.
El frontend parte del diseño previo del equipo, con adaptaciones de IA para SMS y simulador.
No se atribuyen archivos nuevos de esta integración como libres de IA; los módulos de
base de datos existentes en main no se modificaron en esta intervención.
Prompt real: [registro](prompts/2026-10-16-publicar-frontend-rafiki.md).

### Corrección del check GitGuardian del PR #3

Codex revisó el hallazgo de Generic Password y simplificó la referencia obligatoria a
`RAFIKI_DB_PASSWORD` en `infra/rafiki/compose.yaml`. El valor sigue procediendo del
entorno privado; el texto señalado era el mensaje de error de Compose, no una contraseña.
Los demás archivos de aplicación no se modificaron en esta corrección.

## Demo wallet pool (2026-10-16)

Delegated implementation worker. All AI-built files for this feature are listed in the prompt log
[`prompts/2026-10-16-demo-wallet-pool.md`](prompts/2026-10-16-demo-wallet-pool.md).

- AI-generated: `backend/src/demo/**` (pool repository, service and routes),
  `backend/src/db/migrations/004_demo_wallet_pool.sql`, the demo additions to
  `backend/src/config.ts`, `backend/src/errors.ts`, `backend/src/payments/**`,
  `backend/src/onboarding/routes.ts`, `backend/src/onboarding/service.ts`,
  `backend/src/jobs/**` and `backend/src/app.ts`, plus `backend/tests/demo-wallet-pool.test.ts`,
  `backend/tests/config.test.ts`, `backend/docs/demo-wallet-pool.md` and `backend/.env.example`.
- Little or no AI: the money-moving Open Payments adapter (`backend/src/payments/open-payments.ts`)
  and the payment/reconciliation state machine only received additive, small changes (receive-side
  quotes, a `purpose` label); they still need a human read-through before real use.
- The team must review the treasury-grant handling and the reconciliation rules by hand.

