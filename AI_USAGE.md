# AI Usage Disclosure

This file satisfies the **AI Policy** of the 2026 Open Payments Hackathon: it declares which AI
tools were used, for what, and where in the project. The real prompts are stored in
[`prompts/`](prompts/), one file per topic/session, and indexed in
[`prompts/README.md`](prompts/README.md).

## 1. Tools used

This is the **complete** list of AI tools used in this project; every entry below is part of the
same agent-driven workflow.

| Tool | Model | Used for | Notes |
|---|---|---|---|
| **OpenCode** | `deepseek-v4.1-flash` (provider `opencode-go`) | Backend, infrastructure, deployments, documentation, prompt-log audit | Primary tool. Used as an orchestrator plus delegated implementation workers, each in its own branch/worktree, with independent verification and review |
| **OpenCode** | `claude-haiku-5-5` | Review of the local Rafiki test node; preparation of a documentation-only branch | No application code was generated in that step |
| **OpenAI Codex** | (no fixed model recorded) | Frontend (`frontend/`), Chasky branding and dashboard, customer login, read-only wallet history, branch cleanup | Team-directed; the backend modules already in `main` were not rewritten by it |
| **Claude Code** | `sonnet-5.5` | Bilingual root documentation (`README.md`, `README.es.md`) | Documentation only, no application code |
| Earlier AI assistants | — | Original pre-event prototype (Next.js + Prisma + SMS providers + mock mode) | That code was **removed from the working tree** during the hackathon reset and is preserved only in git history |

## 2. Credits consumed

The agent client records its own usage per session. Aggregated for every session run in this
repository (including the delegated workers in `.worktrees/`):

| Model | Sessions | Input tokens | Output tokens | Reasoning tokens | Cache-read tokens | Cache-write tokens | Accounted cost |
|---|---|---|---|---|---|---|---|
| `deepseek-v4.1-flash` (`opencode-go`) | 18 | 6,218,145 | 619,371 | 771,025 | 372,622,268 | 3,172 | **≈ US$2.89** |

Notes:

- The figures come from the local OpenCode telemetry database for the sessions whose working
  directory is this repository (`session_v2`: `cost`, `tokens_input`, `tokens_output`,
  `tokens_reasoning`, `tokens_cache_read`, `tokens_cache_write`), read on 2026-10-17.
- Total accounted cost: **≈ US$2.89** across 18 sessions. No additional credits were purchased for
  this project beyond the plan in use, and no paid tool was used without being listed in section 1.
- The other tools (OpenAI Codex, Claude Code) were run under the team's own subscriptions; their
  clients do not expose a per-project figure here, so only the OpenCode accounting is reported.

## 3. Human review, testing and the role of AI

- **Human review happened for every change.** Each feature was developed on its own branch, opened
  as a pull request and reviewed and merged by the team (PRs #2–#17 in
  <https://github.com/Noisk8/SMS-Openpayments>). The team read the diff, questioned the design and
  accepted or rejected the result; nothing was merged automatically.
- **Every feature has automated tests.** The backend has 131 unit and integration tests (Vitest
  against a real PostgreSQL instance, 13 suites), and both the backend and the frontend typecheck.
  The canonical gate is `./scripts/verify.sh` (`npm run verify`); it currently reports
  `VERIFICATION PASSED`.
- **Real-money-path evidence.** The Open Payments flow was exercised end to end against the
  Interledger Test Wallet with real SMS messages (Relayion), and the settled payments were read back
  from the resource server (`outgoingPayment.get`) and reconciled to `COMPLETED`.
- **AI paradigm.** The whole deliverable was built with an **agent-driven development (ADD)**
  workflow: planning and decomposition, parallel delegated workers in isolated worktrees, explicit
  contracts and acceptance criteria, mechanical verification, and a separate review pass before
  integration. Because of that, **no file in the deliverable is "little or no AI"**: every source,
  test, migration, script and document was produced with AI assistance under this orchestration.
- **What the team decided and owns** (human judgement, not delegated): scope and cuts, the stack
  (Fastify + PostgreSQL + `@interledger/open-payments`), the account model (users' own wallets and
  grants, not a platform-managed custody model), grant budgets and the long grant interval, the SMS
  command grammar and confirmation model, when to stop feature work, and every merge. The binary
  choices (delete the prototype, drop Twilio, drop the Rafiki managed-account branch, keep the demo
  wallet pool) were human decisions executed by the agents.
- Long-term roadmap wording, the custody/licensing claims and the licensing questions in the
  README are the team's responsibility; the agents only wrote the prose.

## 4. Repository state at submission

Verifiable state of the deliverable, checked on 2026-10-17:

| Item | Evidence |
|---|---|
| Public GitHub repository | `https://github.com/Noisk8/SMS-Openpayments` — visibility `PUBLIC` (`gh repo view`) |
| Everything delivered on the main branch | `main` = `origin/main`, the single branch of record of the public repository; the working tree is clean; every feature PR (#2–#17) is merged. Application code, tests, migrations, scripts and documentation all live in `main` |
| Application code written during the hackathon | The backend and the current frontend were written during the event (commits dated 2026-10-16/17). The pre-event prototype was deleted from the tree during the reset and survives only in git history; no prototype code was reused in the deliverable. The frontend was reworked during the event from the team's earlier design (see §5.7) |
| Prompt log complete | `prompts/` holds the verbatim prompts of every session and tool, one file per topic, all indexed in `prompts/README.md` (32 files) |
| Known and documented gaps | [`backend/docs/architecture.md`](backend/docs/architecture.md) lists the behaviours that are not implemented (automatic reconciliation, an SMS reply for payment errors, admin grant cancel/revoke against the real provider, etc.) |

## 5. Where and how AI was used

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
  the database schema and migrations, the SMS gateway (webhook, persistence, deduplication, dev
  simulator), the persistent job queue, secret encryption, the payments domain and the accounts
  domain.
- The Open Payments adapter (`backend/src/payments/open-payments.ts`) and the payment service
  (`backend/src/payments/service.ts`) are the money-moving core; they were written through the same
  ADD workflow and are covered by tests, and the team reviewed the flow (incoming payment, quote,
  outgoing payment, grants) before accepting it.

### 5. Rafiki test-node review (analysis only)

- The agent checked the local Rafiki v2.4.5 test node (`docker`, signed read-only admin query,
  secrets handling and the Docker compose file) and compared the team's Open Payments design with
  an alternative platform-managed account model.
- The alternative model was not adopted. Its prompts are kept as history
  (`prompts/2026-10-16-cuentas-sms-rafiki-propio.md`). No code from that branch is in `main`.

### 6. Test Wallet configuration and the first SMS adapter

- `backend/src/payments/test-wallet-check.ts`, `backend/scripts/check-test-wallet.ts` and
  `backend/tests/test-wallet-check.test.ts`: read-only preflight for a Test Wallet client key and
  wallets.
- A Twilio adapter (`backend/src/sms/providers/twilio.ts` + `backend/tests/twilio.test.ts`) was
  built and tested while Twilio was the candidate provider. **It was later removed** together with
  its dependency when the team adopted Relayion (see §5.12); the history is kept in git and in
  `prompts/2026-10-16-webhook-twilio.md`.
- Editing it touched: `backend/src/config.ts`, `backend/src/app.ts` (form parsing),
  `backend/src/sms/provider-factory.ts`, `backend/src/sms/routes.ts`, `backend/tsconfig.json`,
  `backend/package.json` and `backend/.env.example`.
- Documentation written with the agent: `backend/docs/test-wallet.md`.

### 7. Frontend and Rafiki integration on `main`

- OpenAI Codex was used to recover and adapt `frontend/`, integrate `backend/src/managed/`, the
  additive `003_rafiki_accounts.sql` migration, configuration, routes, boot, scripts, tests, Compose
  and documentation. The PostgreSQL and Open Payments implementations of `main` were kept; the SQLite
  importer and the local database migration were not included. The frontend starts from the team's
  earlier design, with AI adaptations for SMS and the simulator. Prompt:
  [`prompts/2026-10-16-publicar-frontend-rafiki.md`](prompts/2026-10-16-publicar-frontend-rafiki.md).
- **PR #3 GitGuardian check:** Codex reviewed the Generic Password finding and simplified the
  mandatory `RAFIKI_DB_PASSWORD` reference in `infra/rafiki/compose.yaml`. The value still comes from
  the private environment; the flagged text was a Compose error message, not a password.

### 8. Demo wallet pool, assignment and top-up

- All files for this feature are listed in
  [`prompts/2026-10-16-demo-wallet-pool.md`](prompts/2026-10-16-demo-wallet-pool.md):
  `backend/src/demo/**` (pool repository, service and routes),
  `backend/src/db/migrations/004_demo_wallet_pool.sql`, the demo additions to
  `backend/src/config.ts`, `backend/src/errors.ts`, `backend/src/payments/**`,
  `backend/src/onboarding/**`, `backend/src/jobs/**`, `backend/src/app.ts`, plus
  `backend/tests/demo-wallet-pool.test.ts`, `backend/tests/config.test.ts`,
  `backend/docs/demo-wallet-pool.md` and `backend/.env.example`.
- Treasury-grant handling and the reconciliation rules were reviewed by the team before the demo.

### 9. Grant access-token rotation and interval limits

OpenCode (`deepseek-v4.1-flash`) implemented, on branch `task/T-grant-rotation`, access-token
rotation for Open Payments grants and interval-based grant limits. Files: the migration
`backend/src/db/migrations/005_grant_token_manage.sql`, `backend/src/jobs/rotation.ts`, and edits to
`backend/src/payments/types.ts`, `backend/src/payments/open-payments.ts`,
`backend/src/payments/service.ts`, `backend/src/payments/fake.ts`, `backend/src/grants/service.ts`,
`backend/src/jobs/handlers.ts`, `backend/src/onboarding/service.ts`,
`backend/src/sms/command-service.ts`, `backend/src/config.ts` and `backend/.env.example`. Tests:
`backend/tests/grant-rotation.test.ts` (new) and `backend/tests/config.test.ts` (extended). No
`frontend/**` file was touched and migrations 001/002 were left unchanged. Prompt recorded verbatim
in [`prompts/2026-10-16-rotacion-grant.md`](prompts/2026-10-16-rotacion-grant.md).

### 10. Demo external recipient

OpenCode (`deepseek-v4.1-flash`), delegated worker on branch `task/T-demo-recipient`, added the
optional external payment destination to the demo wallet pool: a new `EXTERNAL_RECIPIENT` pool role
that is never assignable, an optional `externalRecipient` on pool import, and the pre-registration
of that destination as a customer recipient (under `DEMO_EXTERNAL_ALIAS`) so demo customers can pay
it with the existing SMS command. It reuses the pool repository, the recipients service and the
payments/jobs flow; no parallel system was added.

- Files: `backend/src/db/migrations/006_demo_external_recipient.sql`, `backend/src/demo/repository.ts`
  and `backend/src/demo/service.ts` (role type, single-external import validation,
  `ensureDemoExternalRecipient`), `backend/src/demo/routes.ts` (import schema),
  `backend/src/onboarding/routes.ts` (exposes `externalAlias`), the `DEMO_EXTERNAL_ALIAS` addition in
  `backend/src/config.ts`, `backend/.env.example` and `backend/docs/demo-wallet-pool.md`.
- Tests: `backend/tests/demo-wallet-pool.test.ts` extended with import/idempotency/role-conflict,
  never-allocated and end-to-end external-payment cases.
- Prompt recorded verbatim in
  [`prompts/2026-10-16-demo-external-recipient.md`](prompts/2026-10-16-demo-external-recipient.md).

### 11. Chasky: identity, phone login, dashboard and wallet history

OpenAI Codex implemented the visible rename to Chasky and the dashboard in
`frontend/src/app/{login,dashboard,api/customer}/`, the `phone-login.tsx` and
`customer-dashboard.tsx` components, styles, navigation and example configuration. On the backend it
added `backend/src/customer/`, `005_customer_login.sql`, route registration and the
`customer.test.ts` suite, with an update to the test helper. The behaviour is documented in
`frontend/README.md`. Prompt: `prompts/2026-10-16-chasky-dashboard.md`.

- **Test account registration.** Codex registered the requested phone in the PostgreSQL instance
  indicated by the user through `registerWithDemoWallet`, and narrowed that function's dependency
  type in `backend/src/demo/service.ts` to `config` and `db`. Verification, authorization and
  top-up states were left intact, and no supplied credential was written to a versioned file.
- **Test password.** Development-only password login with the mock SMS provider:
  `006_test_password_login.sql`, `backend/scripts/set-test-password.ts`, tests and documentation.
  Passwords are stored with scrypt and a random salt; the normal OTP login is preserved.
- **Chasky wallet association.** Codex checked the wallet metadata and that the supplied private key
  matched the requested wallet's public key, then associated the account inside a transaction,
  keeping its previous wallet and verification states. The private key was used in memory only and
  was not stored in the repository or the database. No grants were created and no funds moved.
- **Direct password access in the local environment.** Codex configured the private local
  environment to use the shared database and to enable test access, and selected the default
  password in the form. The server can disable jobs with `JOB_WORKER_ENABLED` and loads the Open
  Payments key when the real provider is used. The requested user's login and wallet were verified
  in the browser. Tests and documentation were added; no secret was written to a versioned file.
- **Wallet history received outside the backend.** Codex implemented the history gateway and service
  in `backend/src/customer/history*`, the `007_wallet_history.sql` migration, read and consent
  routes, configuration, tests and the dashboard connection, after consulting the official guide and
  the SDK types. The user explicitly authorised `list-all` for their own wallet after automated
  review refused to widen the permission without that clarification. The provider asks for consent;
  no sending permissions are created and no funds move. The previously supplied key is kept only in
  an ignored local file with `600` permissions so the read client survives restarts, and tokens are
  encrypted in the database. Final validation: 90 tests passing and a clean frontend build, with the
  authenticated session confirming a connected history and two completed incoming resources after
  the account holder's consent.
- **Balance inquiry.** Codex reviewed the official Open Payments APIs and the public Test Wallet
  code: the balance is read from its private backend with an account-holder session and is not
  provided by the history permission. The messages in `backend/src/customer/routes.ts` and the
  dashboard card were corrected, adding a link to Test Wallet and a test that prevents presenting an
  incoming payment as available balance. No amounts were invented and no grant was widened.

### 12. Removing provider integrations and branch cleanup

- At the user's request, Codex removed the Twilio adapter and dependency, the managed Rafiki code,
  its webhooks, scripts, Compose file, variables, specific tests and the managed-account migration
  from new installations, and pointed the dashboard exclusively at Open Payments wallets, grants and
  payments. The mock SMS simulator, PostgreSQL, the wallet pool, the login and the Chasky frontend
  are kept. Existing installation tables were not dropped and the shared database was not touched.
- The Rafiki/Twilio branches and PRs were reviewed, backed up into a local bundle, and their local
  and remote references removed; `main` and the Chasky work were preserved. No application code
  changed in that cleanup. Prompt: `prompts/2026-10-16-eliminar-ramas-rafiki-twilio.md`.
- The Chasky change set (login, history, integrations removal) was reviewed, the ignored private
  files checked, and the change set integrated with the recent `main` before publishing. Prompt:
  `prompts/2026-10-16-publicar-chasky.md`.

### 13. Relayion SMS provider

OpenCode (`deepseek-v4.1-flash`), delegated worker on branch `task/T-relayion`, added the real SMS
provider adapter, matching the existing `SmsProvider` contract. It verifies inbound webhooks by
HMAC-SHA256 over the raw request body, fetches the message body through `GET /api/v1/inbound/:id`
when the webhook omits it, and sends outbound replies through `POST /api/v1/outbound`.

- Files: `backend/src/sms/providers/relayion.ts` (new), `backend/src/sms/types.ts` (`rawBody` and an
  async-capable `parseIncoming`), `backend/src/sms/service.ts`, `backend/src/app.ts` (JSON parser
  preserving `request.rawBody`), `backend/src/sms/provider-factory.ts`, `backend/src/sms/routes.ts`,
  `backend/src/config.ts` (Relayion env + `superRefine`), `backend/.env.example` and
  `backend/docs/relayion.md` (new).
- Tests: `backend/tests/relayion.test.ts` (new), 15 cases with an injected fake `fetch`; no network.
- The signature check and the provider-error mapping were validated with real inbound and outbound
  messages during the live demo. Prompt recorded verbatim in
  [`prompts/2026-10-16-relayion-provider.md`](prompts/2026-10-16-relayion-provider.md).

### 14. SMS MVP: short commands and confirmation by code

OpenCode (`deepseek-v4.1-flash`), delegated worker on branch `task/T-mvp-commands`, added the short
SMS command interface (`P <amount> <destination>`, a bare confirmation code, `0` cancel, `1` last
payment, `9` help) on top of the long commands, which keep working as compatible alternatives.

- Files: `backend/src/sms/command-service.ts` (parser + engine + replies),
  `backend/src/sms/commands.ts`, `backend/src/recipients/service.ts`,
  `backend/src/db/migrations/008_sms_mvp.sql` (`recipients.number`, `recipient_counters`,
  `sms_confirmation_codes`), `backend/docs/sms-commands.md` (new) and
  `backend/tests/mvp-commands.test.ts` (new, 21 cases).
- The reply wording omits the currency (it is always COP), as the team requested;
  `backend/tests/commands.test.ts` was updated accordingly.
- The design points were reviewed by the team: the permanent numbering scheme, the per-user
  confirmation-code registry that prevents reusing a code for another payment when an SMS arrives
  late, and the automatic expiry of a lapsed pending payment. Later iterations removed the numeric
  destination list and made a new payment supersede the pending one (§5.16).

### 15. Bilingual Chasky README

Claude Code (`sonnet-5.5`) rewrote the root `README.md` (English) and created `README.es.md`
(Spanish): the problem, benefits, SMS flow, conceptual architecture and payment-flow Mermaid
diagrams, install steps, the meaning of the name Chasky, and a phased roadmap. The team supplied the
slogan, the name's meaning, the Colombia/COP launch scope and the Rhyza (not yet released)
direction. No application code changed. Prompts recorded verbatim in
[`prompts/2026-10-17-readme-chasky.md`](prompts/2026-10-17-readme-chasky.md).

### 16. Live Relayion demo, SMS UX fixes and `incomingAmount`

OpenCode (`deepseek-v4.1-flash`) ran the first real end-to-end demo with the Relayion provider on
Railway and applied the fixes the team requested while the demo was running. All changes are
backend-only; no `frontend/**` file was touched and no existing migration was edited.

- **A new payment supersedes the pending one:** `backend/src/sms/command-service.ts` cancels the open
  `AWAITING_CONFIRMATION` payment for that user when a new `P ...` command arrives, so the user never
  has to finish or cancel the previous one.
- **Clearer help text and global destination aliases:** `command-service.ts` (help/`AYUDA` wording)
  and `backend/src/recipients/service.ts`. The global fallback was wired into the SMS resolution path
  (`getGlobalRecipientByAlias`), so any sender can pay any registered alias; the sender's own copy of
  a name still wins. Merged as PRs #15 and #17.
- **`incomingAmount` on the incoming payment:** `backend/src/payments/open-payments.ts`
  (`createIncomingPayment`), `backend/src/payments/service.ts` (the bound is the caller's receive
  amount, or the debit amount when both wallets share the asset) and `backend/src/payments/types.ts`
  / `fake.ts` (contract). Merged as PR #16 (`c00beb8`), 131 tests passing, deployed to Railway
  (`SUCCESS`, `/health` = `ok`).
- **Evidence gathering, not code:** the last two Interledger transactions were read back from the
  resource server (`outgoingPayment.get`) and reconciled to `COMPLETED`; both had already settled
  (`sentAmount == debitAmount`, `failed: false`) while our database still showed `PROCESSING`. This is
  the evidence behind the automatic-reconciliation work item, which is **not implemented yet**.
- **Documentation:** the end-to-end technical description in
  [`backend/docs/architecture.md`](backend/docs/architecture.md), which also records the gaps found
  while writing it (no SMS reply when `executePayment` throws, no automatic reconciliation, admin
  grant cancel/revoke failing against the real provider).
- Review priorities recorded for this batch: the supersede rule (it cancels a live payment), the
  global alias fallback (it widens who can be paid), and the `incomingAmount` bound (an over-tight
  bound would make the receiving side reject a payment).

#### Prompt-log audit and secret redaction

The agent audited [`prompts/`](prompts/) on request: it removed the retired bootstrap log
`prompts/2026-10-16-cierre-bootstrap.md` (kept in history as evidence), completed the index in
[`prompts/README.md`](prompts/README.md) with the thirteen topic files that the parallel assistants
had created without indexing, and added the missing references here.
Two live secrets found in the logs were redacted on 2026-10-17 — the application signing key in
`prompts/2026-10-16-interledger-demo.md` and the 64-hex `ENCRYPTION_KEY` value in
`prompts/2026-10-16-railway-mcp.md` — keeping the prompt text but removing the values. The real
values remain only in the private environment (`.env`, git-ignored) and in Railway variables. Prompt
recorded verbatim in
[`prompts/2026-10-17-demo-pagos-reales.md`](prompts/2026-10-17-demo-pagos-reales.md).

## 6. Prompt log

See [`prompts/`](prompts/):

- [`prompts/2026-10-16-reinicio-y-sdk.md`](prompts/2026-10-16-reinicio-y-sdk.md)
- [`prompts/2026-10-16-divulgacion-ia.md`](prompts/2026-10-16-divulgacion-ia.md)
- [`prompts/2026-10-16-workflow-agentes.md`](prompts/2026-10-16-workflow-agentes.md)
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
- [`prompts/2026-10-16-rotacion-grant.md`](prompts/2026-10-16-rotacion-grant.md)
- [`prompts/2026-10-16-railway-mcp.md`](prompts/2026-10-16-railway-mcp.md)
- [`prompts/2026-10-16-movimientos-wallet.md`](prompts/2026-10-16-movimientos-wallet.md)
- [`prompts/2026-10-16-saldo-wallet.md`](prompts/2026-10-16-saldo-wallet.md)
- [`prompts/2026-10-16-retirar-integraciones.md`](prompts/2026-10-16-retirar-integraciones.md)
- [`prompts/2026-10-16-asociar-wallet-chasky.md`](prompts/2026-10-16-asociar-wallet-chasky.md)
- [`prompts/2026-10-16-chasky-dashboard.md`](prompts/2026-10-16-chasky-dashboard.md)
- [`prompts/2026-10-16-publicar-frontend-rafiki.md`](prompts/2026-10-16-publicar-frontend-rafiki.md)
- [`prompts/2026-10-16-publicar-chasky.md`](prompts/2026-10-16-publicar-chasky.md)
- [`prompts/2026-10-16-eliminar-ramas-rafiki-twilio.md`](prompts/2026-10-16-eliminar-ramas-rafiki-twilio.md)
- [`prompts/2026-10-16-interledger-demo.md`](prompts/2026-10-16-interledger-demo.md)
- [`prompts/2026-10-16-demo-account-pool.md`](prompts/2026-10-16-demo-account-pool.md)
- [`prompts/2026-10-16-demo-wallets-dx.md`](prompts/2026-10-16-demo-wallets-dx.md)
- [`prompts/2026-10-16-mvp-comandos-cortos.md`](prompts/2026-10-16-mvp-comandos-cortos.md)
- [`prompts/2026-10-17-readme-chasky.md`](prompts/2026-10-17-readme-chasky.md)
- [`prompts/2026-10-17-demo-pagos-reales.md`](prompts/2026-10-17-demo-pagos-reales.md)

The index of every log file is kept in [`prompts/README.md`](prompts/README.md).

> Note: update this file whenever AI touches new code.
