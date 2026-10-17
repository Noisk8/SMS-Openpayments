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
- [`prompts/2026-10-16-demo-external-recipient.md`](prompts/2026-10-16-demo-external-recipient.md)
- [`prompts/2026-10-16-relayion-provider.md`](prompts/2026-10-16-relayion-provider.md)
- [`prompts/2026-10-16-mvp-comandos-sms.md`](prompts/2026-10-16-mvp-comandos-sms.md)

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

## Grant access-token rotation + interval limits (2026-10-16)

OpenCode (agent; model **DeepSeek V4.1 Flash**) implemented, on branch
`task/T-grant-rotation`, access-token rotation for Open Payments grants and
interval-based grant limits. New/changed backend files, all AI-generated and
pending human review: the migration `backend/src/db/migrations/005_grant_token_manage.sql`,
`backend/src/jobs/rotation.ts`, and edits to `backend/src/payments/types.ts`,
`backend/src/payments/open-payments.ts`, `backend/src/payments/service.ts`,
`backend/src/payments/fake.ts`, `backend/src/grants/service.ts`,
`backend/src/jobs/handlers.ts`, `backend/src/onboarding/service.ts`,
`backend/src/sms/command-service.ts`, `backend/src/config.ts` and
`backend/.env.example`. Tests: `backend/tests/grant-rotation.test.ts` (new) and
`backend/tests/config.test.ts` (extended). No `frontend/**` file was touched and
migrations 001/002 were left unchanged. Prompt recorded verbatim in
[`prompts/2026-10-16-rotacion-grant.md`](prompts/2026-10-16-rotacion-grant.md).

## Demo external recipient (2026-10-16)

OpenCode (agent; model **DeepSeek V4.1 Flash**), delegated implementation worker on branch
`task/T-demo-recipient`, added the optional external payment destination to the demo wallet pool:
a new `EXTERNAL_RECIPIENT` pool role that is never assignable, an optional `externalRecipient` on
pool import, and the pre-registration of that destination as a customer recipient (under
`DEMO_EXTERNAL_ALIAS`) so demo customers can pay it with the existing SMS `PAGAR` command. It reuses
the pool repository, the recipients service and the payments/jobs flow; no parallel system was added.

- AI-generated, pending human review: `backend/src/db/migrations/006_demo_external_recipient.sql`,
  `backend/src/demo/repository.ts` and `backend/src/demo/service.ts` (role type, single-external
  import validation, `ensureDemoExternalRecipient`), `backend/src/demo/routes.ts` (import schema),
  `backend/src/onboarding/routes.ts` (exposes `externalAlias`), the `DEMO_EXTERNAL_ALIAS` addition in
  `backend/src/config.ts`, and `backend/.env.example` / `backend/docs/demo-wallet-pool.md`.
- Tests: `backend/tests/demo-wallet-pool.test.ts` extended with import/idempotency/role-conflict,
  never-allocated and end-to-end `PAGAR … A EXTERNAL` cases.
- Little or no AI: the money-moving Open Payments adapter and the existing pool/reservation logic
  were not modified beyond the additive role handling.
- No `frontend/**` file was touched and migrations `001`–`005` were left unchanged. Prompt recorded
  verbatim in
  [`prompts/2026-10-16-demo-external-recipient.md`](prompts/2026-10-16-demo-external-recipient.md).
## Chasky: identidad, acceso por celular y dashboard

OpenAI Codex implementó el cambio de nombre visible a Chasky y el dashboard en
`frontend/src/app/{login,dashboard,api/customer}/`, los componentes `phone-login.tsx`
y `customer-dashboard.tsx`, los estilos, navegación y configuración de ejemplo.
En el backend añadió `backend/src/customer/`, `005_customer_login.sql`, registro
de rutas y pruebas `customer.test.ts`, con actualización del helper de pruebas.
Se documentó el funcionamiento en `frontend/README.md`. Estos archivos tienen
asistencia de IA. Las implementaciones existentes de proveedores de pagos y SMS,
las migraciones anteriores y el motor PostgreSQL no se modificaron en esta tarea.
Prompt real: `prompts/2026-10-16-chasky-dashboard.md`.

### Registro de usuario de prueba

Codex registró el teléfono solicitado en el PostgreSQL indicado por el usuario usando
`registerWithDemoWallet`. La función en `backend/src/demo/service.ts` restringe ahora
su tipo de dependencias a `config` y `db`, los únicos que usa para registrar y encolar
el abono. Se mantuvieron intactos los estados de verificación, autorización y abono.
No se guardaron credenciales suministradas en archivos versionados.

### Contraseña de prueba solicitada

Codex añadió el acceso con contraseña restringido a desarrollo con SMS mock,
`006_test_password_login.sql`, el comando `backend/scripts/set-test-password.ts`,
pruebas y documentación. No se modifica el estado de verificación del usuario.
Las contraseñas se guardan con scrypt y sal aleatoria; el acceso normal por OTP se conserva.

### Limpieza de ramas Rafiki y Twilio

Codex revisó las ramas y PR de GitHub, respaldó las ramas relacionadas en un bundle
local y eliminó sus referencias locales y remotas. Se conservaron main, los cambios
locales de Chasky y el stash previo. Esta operación no retira código ya fusionado en main.
No hubo modificaciones de código de aplicación por esta limpieza; solo este registro
y `prompts/2026-10-16-eliminar-ramas-rafiki-twilio.md` tienen cambios documentales de IA.

## Retiro de integraciones de proveedores

Por solicitud del usuario, Codex eliminó el adaptador y dependencia Twilio, el código
administrado Rafiki, sus webhooks, scripts, Compose, variables, pruebas específicas y
la migración de cuentas administradas de las instalaciones nuevas. Actualizó el dashboard
para consultar exclusivamente las billeteras, grants y pagos Open Payments. Se conserva
el simulador SMS mock, PostgreSQL, el pool de billeteras, el login y el frontend Chasky.
Las tablas de instalaciones existentes no se borran ni se toca la base compartida.
El registro histórico de prompts y uso de IA se conserva como evidencia del hackatón.

### Asociación de wallet Chasky

Codex comprobó los metadatos y la correspondencia de la clave privada aportada con
la clave pública de la wallet solicitada. Añadió la asociación de la cuenta indicada
en una transacción, conservando su wallet anterior y sus estados de verificación.
La clave privada se utilizó únicamente en memoria y no se guardó en el repositorio
ni en la base de datos. No se generaron grants ni se movieron fondos.
Esta intervención cambia datos de prueba y este registro documental; no altera código.

### Acceso directo por contraseña en el entorno local

Codex configuró el entorno local privado para usar la base compartida y habilitar el
acceso de prueba; seleccionó la contraseña por defecto en el formulario. El servidor
permite desactivar trabajos mediante JOB_WORKER_ENABLED y carga la clave de Open Payments
cuando se usa el proveedor. Se verificó en navegador el acceso del usuario solicitado y
su wallet en el dashboard. Se añadieron pruebas y documentación; no se guardaron secretos
en archivos versionados.

### Movimientos recibidos fuera del backend

Codex implementó el gateway y servicio de historial en backend/src/customer/history*,
la migración 007_wallet_history.sql, rutas de lectura y consentimiento, configuración,
pruebas y conexión en el dashboard. Consultó la guía oficial y los tipos del SDK.
El usuario autorizó expresamente list-all para su propia wallet después de que la
revisión automática rechazara ampliar el permiso sin esa aclaración. Se pide
consentimiento al proveedor; no se crean permisos de envío ni se mueven fondos.
La clave aportada previamente se guarda solo en un archivo local ignorado con permisos
600 para que el cliente de lectura sobreviva reinicios; los tokens se cifran en base.
No se incluyen secretos en este registro ni en los prompts versionados.

Validación final del historial: 90 pruebas aprobadas y compilación del frontend correcta.
Desde la sesión autenticada del usuario, la API confirmó historial conectado y dos
recursos de ingresos completados tras el consentimiento del titular. No se registraron
claves, tokens ni enlaces de autorización en archivos versionados.

### Consulta de saldo solicitada

Codex revisó las APIs oficiales de Open Payments y el código público de Test Wallet.
El saldo se consulta en su backend privado con sesión de titular; el permiso de historial
no lo proporciona. Se corrigieron los mensajes en backend/src/customer/routes.ts y la
tarjeta del dashboard, añadiendo un enlace a Test Wallet y una prueba que evita presentar
un ingreso como saldo disponible. Falta la API autenticada de saldo del proveedor para
mostrar su saldo real dentro de Chasky. No se inventaron importes ni se amplió ningún grant.

## Publicación de Chasky

Codex revisó el conjunto de cambios de Chasky, el login, el historial y el retiro de
integraciones, verificó los archivos privados ignorados y preparó la integración con
los cambios recientes de main antes de subir. Se conserva el historial de prompts
por las reglas del hackatón; sus referencias antiguas a proveedores no son integraciones
activas. Los archivos de entorno y las claves permanecen fuera de Git.

## Relayion SMS provider (2026-10-16)

OpenCode (agent; model **DeepSeek V4.1 Flash**), delegated implementation worker on branch
`task/T-relayion`, added a real SMS provider adapter for Relayion, matching the existing
`SmsProvider` contract. It verifies inbound webhooks by HMAC-SHA256 over the raw request body,
fetches the message body through `GET /api/v1/inbound/:id` when the webhook omits it, and sends
outbound replies through `POST /api/v1/outbound`.

- AI-generated, pending human review: `backend/src/sms/providers/relayion.ts` (new),
  `backend/src/sms/types.ts` (`rawBody` + async-capable `parseIncoming`), `backend/src/sms/service.ts`
  (awaits `parseIncoming`), `backend/src/app.ts` (JSON parser preserving `request.rawBody`),
  `backend/src/sms/provider-factory.ts`, `backend/src/sms/routes.ts` (passes `rawBody`, removes the
  temporary diagnostics log), `backend/src/config.ts` (Relayion env + `superRefine`),
  `backend/.env.example` and `backend/docs/relayion.md` (new).
- Tests: `backend/tests/relayion.test.ts` (new), 15 cases with an injected fake `fetch`; no network.
- No `frontend/**` file was touched and no migration was edited. The signature check and the
  provider-error mapping (retryable `PROVIDER_ERROR` vs terminal `VALIDATION_FAILED`) still need a
  human review against the Relayion console. Prompt recorded verbatim in
  [`prompts/2026-10-16-relayion-provider.md`](prompts/2026-10-16-relayion-provider.md).

## SMS MVP short commands (2026-10-16)

OpenCode (agent; model **DeepSeek V4.1 Flash**), delegated implementation worker on branch
`task/T-mvp-commands`, added the short SMS command interface (`P <amount> <destination>`, a bare
4-digit confirmation code, `0` cancel, `1` last payment, `2` destinations, `9` help) on top of the
existing long commands, which keep working as compatible alternatives.

- AI-generated, pending human review: `backend/src/sms/command-service.ts` (parser + engine +
  replies), `backend/src/sms/commands.ts` (short help in the dev simulator),
  `backend/src/recipients/service.ts` (permanent per-user destination numbers, resolve by number or
  alias), `backend/src/db/migrations/008_sms_mvp.sql` (new: `recipients.number`,
  `recipient_counters`, `sms_confirmation_codes`), `backend/docs/sms-commands.md` (new) and
  `backend/tests/mvp-commands.test.ts` (new, 21 cases).
- The final wording dropped the currency from every reply (it is always COP), as the team requested;
  `backend/tests/commands.test.ts` was updated accordingly.
- Design points to review by hand: the permanent numbering scheme (monotonic `recipient_counters`
  plus a `UNIQUE (user_id, number)` index), the per-user confirmation-code registry that prevents
  reusing a code for another payment when an SMS arrives late, and the automatic expiry of a lapsed
  pending payment.
- `frontend/**` was not touched. Prompt recorded verbatim in
  [`prompts/2026-10-16-mvp-comandos-sms.md`](prompts/2026-10-16-mvp-comandos-sms.md).

## Bilingual Chasky README (2026-10-17)

Claude Code (model **Sonnet 5.5**) rewrote the root `README.md` (English) and created `README.es.md`
(Spanish): the problem, benefits, SMS flow, conceptual architecture and payment-flow Mermaid diagrams,
install steps, the meaning of the name Chasky, and a phased roadmap. The team supplied the slogan, the
name's meaning, the Colombia/COP launch scope and the Rhyza (not yet released) direction. No
application code changed. Pending human review: the roadmap wording and the licensing/custody claims
(phase 4) must be checked by the team, and no connectivity statistics are cited on purpose. Prompts
recorded verbatim in [`prompts/2026-10-17-readme-chasky.md`](prompts/2026-10-17-readme-chasky.md).
