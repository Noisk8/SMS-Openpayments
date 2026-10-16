# Open Payments grants: lifetime, rotation and intervals

This document answers "how long does an authorization last?" for the backend's Open Payments
integration, and what we can (and cannot) configure.

## Two different clocks

| Thing | Who decides | Typical value |
|---|---|---|
| **Access token** (`access_token.value`) | The Authorization Server (AS) | ~10 minutes on the Interledger Test Wallet |
| **Grant** (the user's consent + `limits`) | The AS, bounded by the requested limits | as long as the granted window |

Open Payments/GNAP gives the **client no field to request a longer access-token lifetime**. `expires_in`
comes from the AS. What the client *can* do is (a) request a **budget window** with `limits.interval`
and (b) **rotate** the access token before it expires, so the grant stays usable without asking the
user again.

## Rotation (keeps a grant usable)

When a grant is granted the access token carries a **`manage`** URI
("The management URI for this access token"). The backend:

1. Persists `access_token_manage_uri` (plaintext URI; not a bearer credential) and the token expiry.
2. Schedules a `rotate_grant_token` job at **T-120s** before expiry
   (`backend/src/jobs/rotation.ts`).
3. On run, calls `token.rotate` (`POST <manage>`) with the current token and stores the **new** token,
   `manage` URI and expiry, then schedules the next rotation.
4. If the token already expired (or the AS rejects rotation), the grant is marked
   **`requires_reconsent`** — an explicit state; it never fails silently and never retries a transfer.

Rotation is single-flight per grant (DB lock) and stale schedules are ignored, so a rotation can never
double-run or be scheduled twice for the same expiry.

> An **already-expired** token cannot be rotated. Recovering from that requires a new interactive
> consent. That is why rotation runs proactively, not on demand.

## Budget window: `limits.interval`

The outgoing-payment grant can carry a repeating interval, e.g.:

```
limits: { interval: "R1/2026-10-16T00:00:00Z/P1M", debitAmount: { value, assetCode, assetScale } }
```

`R1/…/P1M` = one repetition, starting now, period one month. This is the documented way to model a
monthly budget (see the official guide *Get an outgoing payment grant for future payments*).

Configured with **`OP_GRANT_INTERVAL`**; empty means the grant is requested **without**
`limits.interval`. It is applied to every outgoing-payment grant the backend requests (onboarding
wallet connect, the SMS `CONFIRMAR` path, and the demo treasury top-up).

Grant budget and account balance are **separate**: a grant of N units authorizes spending up to N; it
does not move money into the account.

## Maximum duration

**The protocol defines no maximum** for an access-token lifetime or a grant/interval window; the AS is
the authority and may cap, shorten or reject a request. Concretely for the Interledger Test Wallet:

- Access tokens are issued with a short `expires_in` (~10 minutes) and are **not** configurable by the
  client; the backend keeps them fresh by rotation.
- A month-long `limits.interval` is *requested*, not guaranteed; the effective window is whatever the
  AS grants in its response.

So: the practical ceiling is provider-specific. Verify it against the connected provider by inspecting
the granted window/token expiry rather than assuming a value.

## Related files

- `backend/src/payments/open-payments.ts` — captures `access_token.manage` and sends `limits.interval`.
- `backend/src/grants/service.ts` — rotation + `requires_reconsent`.
- `backend/src/jobs/rotation.ts` — rotation scheduling (T-120s, expiry-scoped dedupe key).
- `backend/src/config.ts` — `OP_GRANT_INTERVAL`.
