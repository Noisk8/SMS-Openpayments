# Prompt log — Grant access-token rotation + interval limits (2026-10-16)

Delegated implementation task (subagent) for branch `task/T-grant-rotation`.
Verbatim prompt below.

---

You are a subagent spawned by another session.
You are a bounded implementation worker. Work ONLY inside this git worktree:
`/Users/juminstock/workspace/SMS-Openpayments/.worktrees/T-grant-rotation` (branch `task/T-grant-rotation`, base_sha `c24c505e0d522534fc8546a8eeea68b718f75116`).

Environment: Node >= 20 (`source ~/.nvm/nvm.sh && nvm use 22`). Setup from the worktree root: `npm --prefix backend install`.

## Problem
Open Payments access tokens expire (~10 minutes on the Interledger Test Wallet, set by the Authorization Server). Today the backend drops the token's `manage` URI, so once the token expires the user must re-approve the grant. We want "authorize once, pay later" over hours.

## Goal (implement BOTH, they are complementary)
1. **Access-token rotation** so an existing grant stays usable without re-consent.
2. **Interval-based grant limits** (`limits.interval`, per the official guide "Get an outgoing payment grant for future payments") so the consent carries a defined budget window.

## Documentation facts you must rely on
- GNAP/Open Payments: the AS sets the token TTL; the client cannot request a longer one.
- When a grant is granted, the access token includes a **`manage`** URI ("The management URI for this access token").
- Rotation: `client.token.rotate({ url: manageUri, accessToken })` (`POST <manage>`) returns a new `AccessToken { value, expires_in, manage }`. The grant and its limits persist.
- Rotation only works while the current token is still valid. If it already expired, consent must be requested again (make that state explicit).
- `limits.interval` example: `R3/2025-05-20T13:00:00Z/P1M` (repetitions / start / period).

## Scope (backend only)
- `backend/src/db/migrations/**` — ADD one migration (name it `003_grant_token_manage.sql`; I will renumber at integration if needed). Never edit 001/002.
- `backend/src/payments/types.ts` — extend `GrantedAccess` with an optional `manageUri?: string | null`.
- `backend/src/payments/open-payments.ts` — capture `access_token.manage` wherever a granted token is produced (`requestOutgoingGrant` granted path, `continueGrant`) and return it; ensure `rotateAccessToken` also returns the NEW `manageUri` and expiry.
- `backend/src/grants/**` — persist `access_token_manage_uri` and the token expiry on the grant row (the URL is not a bearer credential; plaintext is acceptable, but do not log it). Add a service that rotates a grant's token and persists the new value + new manage URI + expiry.
- `backend/src/jobs/**` — add a `rotate_grant_token` handler and enqueue it when a grant is granted. It must reschedule itself to rotate shortly before expiry (e.g., T-120s). Single-flight: never run two rotations for the same grant concurrently. If the token is already expired (or rotation is rejected), mark the grant as requiring new consent (explicit state/field) — never fail silently.
- `backend/src/payments/service.ts` — when requesting the outgoing grant, include `limits.interval` when configured (see config). Keep the existing `debitAmount` limit.
- `backend/src/config.ts` — add optional config, e.g. `OP_GRANT_INTERVAL` (ISO-8601/GNAP interval, e.g. `R1/2026-10-16T00:00:00Z/P1Y`). When set, apply it to outgoing-payment grant requests. Validate it loosely; do not break when unset.
- `backend/src/server.ts` / `backend/src/app.ts` — register the new job handler (keep existing wiring intact).
- `backend/.env.example` — document the new variable.
- `backend/tests/**` — tests using the FAKE provider.

## Required behaviours / tests (Vitest, real Postgres via `embedded-postgres`)
- A granted token stores its `manage` URI + expiry.
- Rotation replaces the token (and stores the new `manage` URI + expiry) and reschedules the next rotation job.
- An already-expired token produces the "requires new consent" state (no silent failure, no double top-up/payment).
- The configured `limits.interval` is included in the outgoing-payment grant request when set; absent when unset.
- Existing tests keep passing (do not regress payments/grants/commands).

## Forbidden
- Do NOT touch `frontend/**`.
- Do NOT edit migrations 001/002 or weaken existing contracts.
- Never log tokens or manage URIs at info level.

## Verification (from the worktree root)
```
npm --prefix backend run typecheck
cd backend && npm test
```

## Rules
- Commit on branch `task/T-grant-rotation`. No push, no tags, don't touch the main workspace.
- Commits, comments and docs in **English**.

## Return (output contract)
status; base_sha; head_sha; branch; worktree; changed_files; verification (commands + result); assumptions (especially anything about the `manage` field shape or rotation semantics); integration_notes; risks (e.g. rotation racing an in-flight payment); blockers.
