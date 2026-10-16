# Demo wallet pool

The demo wallet pool provisions **pre-created Open Payments wallets** to customers during
registration and funds each of them **once** from a shared treasury wallet. It is a demo
convenience: it does not create a new payment platform, does not migrate data and does not add
payment infrastructure. Top-ups and later payments always run through the **real test
infrastructure** (Interledger Test Wallet) using the same `openpayments` provider as the rest of
the backend.

> **Disclosure.** This feature exists only for controlled demos. The wallets are Test Wallet
> accounts with play money. Never point it at real accounts, real funds or real personal data. It
> is **disabled by default** (`DEMO_WALLET_ASSIGNMENT_ENABLED=false`).

## What it does

1. **Import** a pool: one treasury wallet address plus one or more customer wallet addresses, and
   optionally a single **external payment destination**. Each address is validated with
   `walletAddress.get` (Open Payments discovery) and its currency, scale and service URLs are
   stored. Duplicates and wallets whose asset differs from the treasury are rejected. Re-importing
   is idempotent and never resets an existing assignment or funding.
2. **Register** a customer: `POST /admin/users` with `assignDemoWallet: true` creates or reuses the
   customer, atomically reserves one AVAILABLE customer wallet, links it to the customer, and
   enqueues one persistent `demo_topup` job. Repeating the call returns the existing assignment —
   no new wallet, no new top-up. When the pool has an external recipient, it is pre-registered as a
   recipient of the assigned customer under `DEMO_EXTERNAL_ALIAS`, so the customer can pay it with
   `PAGAR <monto> A <alias>`; the recipient is created once and never duplicated.
3. **Fund** the assigned wallet from the treasury: an incoming payment on the customer wallet, a
   quote pinned to the amount the customer must **receive**, then an outgoing payment authorized by
   the treasury grant. The onboarding funding is stored as a payment with `purpose = 'DEMO_TOPUP'`
   and a unique idempotency key.

## Configuration (server-side only)

| Variable | Meaning |
| --- | --- |
| `DEMO_WALLET_ASSIGNMENT_ENABLED` | Enables demo assignment. Default `false`. |
| `DEMO_TOPUP_AMOUNT` | Amount the customer must **receive**, in minor units. |
| `DEMO_TOPUP_CURRENCY` / `DEMO_TOPUP_ASSET_SCALE` | Asset of the top-up. |
| `DEMO_TOPUP_MAX_AMOUNT` | Hard ceiling for the treasury debit per assignment. |
| `DEMO_EXTERNAL_ALIAS` | Alias under which the pool's optional external recipient is pre-registered for each customer. Default `EXTERNAL`. |

`config.ts` validates that the automatic top-up is greater than zero and never exceeds the ceiling.

## Endpoints

All three use the existing admin authentication (`Authorization: Bearer <ADMIN_API_TOKEN>`).

### `POST /admin/demo/wallet-pool/import`

```json
{
  "treasury": "https://ilp.interledger-test.dev/treasury",
  "customers": ["https://.../c1", "..."],
  "externalRecipient": "https://ilp.interledger-test.dev/external"
}
```

The `customers` array must contain at least one address. `externalRecipient` is optional: it is a
payment destination the assigned customer can pay, is never assigned to a customer and needs no
outgoing-payment grant. It must not be the treasury nor one of the customers, and its asset must
match the treasury. Response:

```json
{
  "treasury": { "walletAddress": "...", "currency": "COP", "assetScale": 0, "created": true },
  "customers": { "imported": 9, "refreshed": 0, "total": 9 },
  "externalRecipient": { "walletAddress": "...", "currency": "COP", "assetScale": 0, "created": true }
}
```

`externalRecipient` is `null` when none was provided.

### `POST /admin/users`

```json
{ "phone": "+573001112233", "assignDemoWallet": true }
```

Without `assignDemoWallet` the endpoint keeps its original behaviour. With it, the response adds a
`demo` block:

```json
{
  "user": { "id": "...", "phone": "+573001112233", "status": "pending" },
  "demo": {
    "customerId": "...",
    "assignmentId": "...",
    "walletAddress": "https://ilp.interledger-test.dev/c1",
    "registrationStatus": "pending",
    "fundingStatus": "PENDING",
    "authorizationStatus": "PENDING",
    "externalAlias": "EXTERNAL"
  }
}
```

HTTP `201` on first assignment, `200` when an existing assignment is returned. `externalAlias` is
`null` when the pool has no external recipient.

### `GET /admin/users/:id/demo-status`

Returns the assignment and funding progress. It never exposes access tokens or continue tokens. When
the customer owns the pool's external recipient, `externalAlias` is the alias to use in
`PAGAR <monto> A <alias>`.

```json
{
  "userId": "...",
  "assigned": true,
  "externalAlias": "EXTERNAL",
  "assignment": {
    "id": "...",
    "walletAddress": "https://ilp.interledger-test.dev/c1",
    "poolStatus": "ASSIGNED",
    "registrationStatus": "pending",
    "fundingStatus": "FUNDED",
    "authorizationStatus": "AUTHORIZED",
    "paymentId": "...",
    "lastError": null,
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

## Treasury grant

The backend needs an outgoing-payment grant for the treasury wallet to fund customers. The first
top-up requests one; if the Test Wallet grants it non-interactively it is reused for later
assignments. If the wallet owner's consent is required, the grant stays `PENDING_INTERACTION`, the
assignment moves to `OPERATOR_ACTION_REQUIRED`, and the operator completes consent through the
existing `GET /auth/callback?grant_id=...&interact_ref=...` endpoint.

## Failure handling

- **Pool exhausted** → `503` with `DEMO_WALLET_POOL_EXHAUSTED`.
- **Already assigned wallet** → reassignment is rejected (`DEMO_WALLET_ALREADY_ASSIGNED`); only
  AVAILABLE wallets are ever reserved, and a repeated registration returns the existing assignment.
- **Treasury funds insufficient** → the assignment is preserved and funding is marked `FAILED`.
- **Grant insufficient/invalid** → `OPERATOR_ACTION_REQUIRED` (authorization `REJECTED`/`MISSING`).
- **Uncertain result** (timeout/failed status read) → `RECONCILIATION_REQUIRED`; the backend only
  inspects the known outgoing-payment resource and never sends a second transfer. The wallet is
  never reassigned.
- **Notification failure** never triggers another top-up: top-ups are not driven by notifications.
- **Reset** requires an explicit admin process; pool wallets are never recycled automatically.

## Local setup with the fake provider

For local development without Test Wallet credentials:

```dotenv
PAYMENT_PROVIDER=fake
DEMO_WALLET_ASSIGNMENT_ENABLED=true
DEMO_TOPUP_AMOUNT=5000
DEMO_TOPUP_MAX_AMOUNT=10000
ENCRYPTION_KEY=<openssl rand -base64 32>
```

Register the treasury and customer wallets in the fake provider (the `fake` provider grants
non-interactively), then run the import, register a customer and run the job processor. The test
suite (`backend/tests/demo-wallet-pool.test.ts`) exercises the whole flow, including concurrent
registration, pool exhaustion and reconciliation.
