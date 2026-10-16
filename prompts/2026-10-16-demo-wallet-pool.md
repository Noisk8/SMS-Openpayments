# Demo wallet pool (backend) — prompt log

Date: 2026-10-16
Agent: OpenCode (model `deepseek-v4.1-flash`), delegated implementation worker.

## Verbatim prompt

> You are a subagent spawned by another session.
> You are a bounded implementation worker. Work ONLY inside this git worktree:
> `/Users/juminstock/workspace/SMS-Openpayments/.worktrees/T-walletpool-api` (branch
> `task/T-walletpool-api`, base_sha
> `c24c505e0d522534fc8546a8eeea68b718f75116`).
>
> Environment: Node >= 20 (`source ~/.nvm/nvm.sh && nvm use 22`). One-time setup from the worktree
> root: `npm --prefix backend install`.
>
> ## Feature: Demo Wallet Pool (backend)
>
> Simulate wallet provisioning by assigning PRE-CREATED Open Payments wallets during registration.
> Top-ups and later payments must run through the REAL test infrastructure (Interledger Test Wallet).
> Do NOT add a new platform, migrate databases, or deploy extra payment infra.
>
> Reuse the existing Fastify backend, PostgreSQL (raw SQL, no ORM), migrations in
> `backend/src/db/migrations/`, the onboarding/payments/jobs services, and the `openpayments`
> provider.
>
> ### Scope (only these areas)
> - `backend/src/db/migrations/**` (ADD a new `003_*.sql`, never edit 001/002)
> - `backend/src/config.ts` (add the new env vars + validation)
> - `backend/src/**` new modules under something like `backend/src/demo/**` (pool
>   repository/service/routes)
> - `backend/src/onboarding/**`, `backend/src/payments/**`, `backend/src/jobs/**` (extend, do not
>   break existing behavior)
> - `backend/src/app.ts` (register the new routes)
> - `backend/.env.example`
> - `backend/tests/**`
>
> ### Data model
> A wallet-pool table (or equivalent fields) with: Wallet Address, role (`TREASURY`|`CUSTOMER`),
> allocation status (`AVAILABLE`|`RESERVED`|`ASSIGNED`), assigned user id, metadata (currency,
> scale, discovered service URLs), timestamps.
> Enforce: one assigned customer per pool wallet, one demo wallet per customer, one automatic
> initial top-up per assignment, atomic reservation under concurrent registrations. Persist customer
> + reservation together where possible; NEVER hold a DB transaction open during network calls.
>
> Track the onboarding funding as a payment with purpose `DEMO_TOPUP` and a unique onboarding
> idempotency key.
>
> ### Endpoints (keep existing admin auth with `Authorization: Bearer ADMIN_API_TOKEN`)
> 1. `POST /admin/demo/wallet-pool/import` — input: one treasury address + nine customer addresses.
>    For each: discover/validate Open Payments metadata (`walletAddress.get`), store
>    address/currency/scale/role, reject duplicates, reject incompatible currencies, keep the
>    treasury out of customer assignment. Repeated imports must NOT reset assignments or funding.
> 2. Extend `POST /admin/users` with an explicit demo mode, preserving existing behavior otherwise:
>    `{ "phone": "+573...", "assignDemoWallet": true }` → create/reuse the customer, atomically
>    reserve one AVAILABLE customer wallet, associate it, create the treasury top-up, enqueue a
>    persistent job, and return: customer id, assigned wallet address (when allocated), registration
>    status, funding status, payment authorization status. Repeated registration MUST return the
>    existing assignment (no new wallet, no new top-up).
> 3. `GET /admin/users/:id/demo-status` — assignment + funding progress; never expose
>    tokens/secrets.
>
> ### Top-up execution
> Reuse the existing payments service: treasury → incoming payment on the assigned wallet → quote →
> outgoing payment using the TREASURY grant → verify the outcome. Backend-authorized onboarding
> operation; no SMS confirmation. Bounded by the configured amount, treasury permissions, and
> assignment uniqueness. Store debit and receive amounts separately; if the configured top-up is
> what the customer must RECEIVE, quote for that receive amount and validate the treasury debit.
> On timeout/uncertain result: do NOT send another transfer blindly; reconcile the known operation,
> keep the assignment reserved and the customer's state pending/review. A notification failure must
> never trigger another top-up.
>
> ### Configuration (server-side only)
> - enable demo wallet assignment
> - initial top-up amount, currency, asset scale
> - maximum permitted automatic funding per assignment
> (Use clear names, e.g. `DEMO_WALLET_ASSIGNMENT_ENABLED`, `DEMO_TOPUP_AMOUNT`,
> `DEMO_TOPUP_CURRENCY`, `DEMO_TOPUP_ASSET_SCALE`, `DEMO_TOPUP_MAX_AMOUNT`. Validate them in
> `config.ts`.)
>
> ### Failure handling
> - pool exhausted → explicit error code `DEMO_WALLET_POOL_EXHAUSTED`
> - treasury funds insufficient → preserve the assignment, mark funding failed
> - grant insufficient/invalid → operator-action-required state
> - funding uncertain → mark for reconciliation; never reassign the wallet
> - repeated registration → return existing assignment + funding status
> - already assigned wallet → reject reassignment
> - demo reset requires an explicit admin process; never recycle automatically
>
> ### Tests (Vitest, real Postgres via `embedded-postgres`; use the FAKE payments provider for logic
> tests)
> Cover: import/idempotent re-import, allocation, **concurrency cannot allocate the same wallet**,
> idempotency (repeat registration), pool exhaustion (10th registration), exactly one top-up per
> assignment, uncertain funding → reconciliation without reassignment.
>
> ### Forbidden
> - Do NOT touch `frontend/**`.
> - Do NOT edit `backend/src/db/migrations/001_*.sql` or `002_*.sql`.
> - Do NOT change existing public contracts/behaviour beyond the additive demo mode.
> - No secrets in tracked files.
>
> ### Verification (from the worktree root)
> ```
> npm --prefix backend run typecheck
> cd backend && npm test
> ```
>
> ### Rules
> - Commit on branch `task/T-walletpool-api`. No push, no tags, don't touch the main workspace.
> - Commits, comments and docs in **English**.
> - Update `backend/.env.example` and add a short `backend/docs/demo-wallet-pool.md` describing
>   setup + the demo preparation disclosure.
>
> ### Return (output contract)
> status; base_sha; head_sha; branch; worktree; changed_files; verification (commands + result);
> assumptions; integration_notes; risks; blockers.

## Follow-up prompts

- "Continue" (the orchestrator allowed the worker to proceed after the first checkpoint).

## Notes

- A new migration file `004_demo_wallet_pool.sql` was added instead of `003_*` because
  `003_rafiki_accounts.sql` already existed on the base revision.
