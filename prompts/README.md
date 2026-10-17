# Prompts — index

Log of the **verbatim** text of the prompts sent to AI (not summaries), as required by the hackathon
AI Policy. One file per topic/session.

- [`2026-10-16-reinicio-y-sdk.md`](2026-10-16-reinicio-y-sdk.md) — project cleanup, language/SDK
  decision, and the initial workflow.
- [`2026-10-16-divulgacion-ia.md`](2026-10-16-divulgacion-ia.md) — creating `AI_USAGE.md` and `prompts/`.
- [`2026-10-16-workflow-agentes.md`](2026-10-16-workflow-agentes.md) — installing the Agent Workflow
  Kit locally.
- [`2026-10-16-specs-backend.md`](2026-10-16-specs-backend.md) — full specs for backend iteration 1
  (SMS + Open Payments).
- [`2026-10-16-english-convention.md`](2026-10-16-english-convention.md) — switching commits and docs
  to English.
- [`2026-10-16-alcance-cop.md`](2026-10-16-alcance-cop.md) — project scope: SMS accounts and COP.
- [`2026-10-16-cuentas-sms-rafiki-propio.md`](2026-10-16-cuentas-sms-rafiki-propio.md) — proposal for
  platform-managed COP accounts on a Rafiki instance operated by the team (not adopted; see the Open Payments model).
- [`2026-10-16-entorno-testnet.md`](2026-10-16-entorno-testnet.md) — testnet environment setup.
- [`2026-10-16-integracion-rafiki.md`](2026-10-16-integracion-rafiki.md) — Rafiki integration status
  review and repository integration with `origin/main`.
- [`2026-10-16-webhook-twilio.md`](2026-10-16-webhook-twilio.md) — SMS webhook and Twilio adapter.
- [`2026-10-16-testwallet-open-payments.md`](2026-10-16-testwallet-open-payments.md) — Test Wallet
  configuration for the Open Payments model, preflight script and Twilio adapter.
- [`2026-10-16-rotacion-grant.md`](2026-10-16-rotacion-grant.md) — access-token rotation and
  interval-based grant limits (`OP_GRANT_INTERVAL`).
- [`2026-10-16-demo-wallet-pool.md`](2026-10-16-demo-wallet-pool.md) — demo wallet pool
  (assignment at registration and automatic top-up).
- [`2026-10-16-demo-external-recipient.md`](2026-10-16-demo-external-recipient.md) — optional
  external payment destination for the demo wallet pool.
- [`2026-10-16-relayion-provider.md`](2026-10-16-relayion-provider.md) — Relayion SMS provider
  adapter (signed webhooks, body enrichment, outbound sends).
- [`2026-10-16-mvp-comandos-sms.md`](2026-10-16-mvp-comandos-sms.md) — SMS MVP short command
  interface (numbered recipients, confirm by code).
- [`2026-10-17-readme-chasky.md`](2026-10-17-readme-chasky.md) — bilingual Chasky README (slogan,
  architecture, roadmap, name tribute).

## Additional topic logs

These files were created by the parallel assistants working on the frontend/Chasky track and on the
real Interledger demo; they were missing from this index.

- [`2026-10-16-railway-mcp.md`](2026-10-16-railway-mcp.md) — Railway deployment and MCP server.
- [`2026-10-16-movimientos-wallet.md`](2026-10-16-movimientos-wallet.md) — read-only wallet history
  outside the backend (consent, gateway, dashboard).
- [`2026-10-16-saldo-wallet.md`](2026-10-16-saldo-wallet.md) — wallet balance question and why the
  history permission does not expose it.
- [`2026-10-16-retirar-integraciones.md`](2026-10-16-retirar-integraciones.md) — removing the Rafiki
  managed accounts and provider integrations.
- [`2026-10-16-asociar-wallet-chasky.md`](2026-10-16-asociar-wallet-chasky.md) — associating the
  requested wallet with the Chasky test account.
- [`2026-10-16-chasky-dashboard.md`](2026-10-16-chasky-dashboard.md) — Chasky identity, phone login
  and customer dashboard.
- [`2026-10-16-publicar-frontend-rafiki.md`](2026-10-16-publicar-frontend-rafiki.md) — integrating the
  frontend and the Rafiki work on top of `main`.
- [`2026-10-16-publicar-chasky.md`](2026-10-16-publicar-chasky.md) — publishing the Chasky change set.
- [`2026-10-16-eliminar-ramas-rafiki-twilio.md`](2026-10-16-eliminar-ramas-rafiki-twilio.md) — branch
  and PR cleanup with a local backup bundle.
- [`2026-10-16-interledger-demo.md`](2026-10-16-interledger-demo.md) — first real Interledger demo
  through the backend (signing credentials, recipient wallet, grant approval).
- [`2026-10-16-demo-account-pool.md`](2026-10-16-demo-account-pool.md) — demo account pool proposal
  and import of `dx_*` wallets.
- [`2026-10-16-demo-wallets-dx.md`](2026-10-16-demo-wallets-dx.md) — `dx_*` demo wallet inventory and
  assignment details.
- [`2026-10-16-mvp-comandos-cortos.md`](2026-10-16-mvp-comandos-cortos.md) — short SMS command
  specification and the "currency is redundant" clarification.
- [`2026-10-17-demo-pagos-reales.md`](2026-10-17-demo-pagos-reales.md) — live Relayion demo: real
  payments, pending-payment supersede, clearer help, global aliases, reconciliation of Interledger
  transactions, `incomingAmount`, and this documentation task.

Convention: `YYYY-MM-DD-topic.md`, with the prompt exactly as sent plus the relevant team answers.
