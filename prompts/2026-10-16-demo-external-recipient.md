# Demo external recipient (backend) — prompt log

Date: 2026-10-16
Agent: OpenCode (model `deepseek-v4.1-flash`), delegated implementation worker.

## Verbatim prompt

> You are a subagent spawned by another session.
> You are a bounded implementation worker. Work ONLY inside this git worktree:
> `/Users/juminstock/workspace/SMS-Openpayments/.worktrees/T-demo-recipient` (branch `task/T-demo-recipient`, base_sha `475d8e7b3dd690f084b9b649590548b82d18005a`).
>
> Environment: Node >= 20 (`source ~/.nvm/nvm.sh && nvm use 22`). Setup from the worktree root: `npm --prefix backend install`.
>
> ## Context
> The backend already implements a Demo Wallet Pool (`backend/src/demo/**`, migration `004_demo_wallet_pool.sql`): a pool table with roles `TREASURY`/`CUSTOMER`, `POST /admin/demo/wallet-pool/import` (1 treasury + ≥1 customers), `POST /admin/users` with `{ assignDemoWallet: true }` (atomic reservation + `DEMO_TOPUP` job), and `GET /admin/users/:id/demo-status`.
>
> The revised model adds a second Test Wallet login holding an **external payment destination**.
>
> ## Scope (backend only)
> 1. Migration: extend the pool role to include `EXTERNAL_RECIPIENT` (ADD a new migration file with the next free number; do NOT edit `001`–`005`).
> 2. Import: `POST /admin/demo/wallet-pool/import` accepts an OPTIONAL single `externalRecipient` Wallet Address (in addition to `treasury` + `customers`). It is stored with role `EXTERNAL_RECIPIENT`, is **never assignable** (only `CUSTOMER` wallets are allocated), needs no outgoing-payment grant, and is validated exactly like the others (metadata discovery, COP/asset compatibility, duplicate/role-conflict rejection, idempotent re-import).
> 3. On a demo assignment (registration), if an external recipient exists in the pool, **pre-register it as a recipient for the assigned customer** so the participant can pay it through the existing SMS flow with `PAGAR <amount> A <alias>`. Use a configurable alias (env, e.g. `DEMO_EXTERNAL_ALIAS`, default `EXTERNAL`); reuse the existing recipients service; do not duplicate a recipient on repeated registration.
> 4. `GET /admin/users/:id/demo-status` may additionally expose the external alias when configured.
> 5. `.env.example` and `backend/docs/demo-wallet-pool.md` updated.
>
> ## Rules / constraints
> - Reuse existing services (pool repository, recipients, payments, jobs). Do not create a parallel system.
> - Do NOT touch `frontend/**` or migrations `001`–`005`.
> - One demo wallet per customer, one top-up per assignment, atomic reservation — do not regress the existing behaviour.
> - Commits, comments and docs in **English**.
>
> ## Tests (Vitest, real Postgres via `embedded-postgres`, FAKE payments provider)
> - Import with and without `externalRecipient`; re-import is idempotent; the external recipient is rejected as a duplicate/role conflict if imported differently.
> - The external recipient is never allocated to a customer.
> - After a demo registration with an external recipient configured, the assigned customer can `PAGAR <amount> COP A <alias>` through the command service/webhook and the payment resolves the external recipient's wallet address.
> - Existing demo/payments/commands tests keep passing.
>
> ## Verification (from the worktree root)
> ```
> npm --prefix backend run typecheck
> cd backend && npm test
> ```
>
> ## Return (output contract)
> status; base_sha; head_sha; branch; worktree; changed_files; verification (commands + result); assumptions; integration_notes; risks; blockers.

## Notes

- A new migration file `006_demo_external_recipient.sql` was added (the next free number after
  `005_grant_token_manage.sql`).
- No `frontend/**` file or migration `001`–`005` was touched.
