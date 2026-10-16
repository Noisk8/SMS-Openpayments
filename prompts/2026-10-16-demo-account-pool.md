# Prompts — Demo Account Pool (revised model) (2026-10-16)

## Prompt (verbatim)

````text
The model changes a little bit given how openpayments works

# Demo Account Pool — Implementation Specification

## Goal

Extend the existing backend to assign pre-created Test Wallet accounts to demo participants.

Use two Test Wallet login users:

- **Provider login:** one funded treasury account and nine independent customer accounts.
- **Recipient login:** one independent account used as an external payment destination.

Each financial account must have its own Wallet Address. Do not substitute multiple addresses pointing to the same underlying account.

Keep the existing backend, PostgreSQL, direct SQL, jobs, SMS webhook, and Open Payments integration.

## 1. Validate feasibility first

Before preparing the full pool:

1. Create two independent COP accounts under the provider login.
2. Add one Wallet Address to each account.
3. Confirm separate balances.
4. Use the backend’s application signing identity to request separate outgoing-payment grants.
5. Approve the grants through Test Wallet.
6. Transfer test COP between the accounts through the backend.
7. Verify token expiration and supported credential-management behavior.

Confirm that the provider login allows the required number of accounts. Do not assume production GateHub account limits apply unchanged to Test Wallet.

If account limits or authorization behavior prevent the intended demo, report the limitation before continuing.

## 2. Prepare the pool

Create and import:

- One `TREASURY` account with sufficient test COP.
- Nine `CUSTOMER` accounts available for assignment.
- One `EXTERNAL_RECIPIENT` account under the second login.

Discover currency and asset scale from each Wallet Address. Require COP for this demo.

Preparation may use the Test Wallet interface. All grant requests, top-ups, and demo payments must run through the backend.

## 3. Authorization model

Use the backend application’s signing identity. Do not collect a private key for every customer account.

Request a separate bounded outgoing-payment grant for:

- Treasury, to fund assigned accounts.
- Each customer account, to execute participant payments.

Persist each grant against its specific Wallet Address and application signing identity. A grant for one address must never authorize a payment from another.

Grant budget and account balance are separate values.

Preserve encrypted credentials, expiration information, and continuation/token-management data returned by the provider. Do not assume expired tokens can always be renewed without consent.

The external recipient does not need an outgoing-payment grant merely to receive this demo’s payments.

## 4. Registration and assignment

Extend the existing registration flow:

1. Register or reuse the customer by normalized phone.
2. Atomically reserve an available customer account.
3. Associate its Wallet Address with that customer.
4. Create one onboarding top-up job from Treasury.
5. Verify the transfer outcome.
6. Mark the customer ready only when phone verification, funding, and outgoing authorization requirements are satisfied.

Repeated requests must return the existing assignment without another allocation or top-up.

If the pool is exhausted, return an explicit error.

Assignment represents access through our application. It does not transfer ownership of the underlying Test Wallet account to the participant.

## 5. Minimal backend changes

- Add a protected pool-import operation.
- Extend the existing registration endpoint with demo assignment.
- Add pool role, assignment state, and customer association using a small migration.
- Reuse existing wallet, grant, payment, and job services.
- Tag onboarding payments as `DEMO_TOPUP` with a unique assignment-based idempotency key.
- Expose assignment, funding, and authorization status to the frontend through a protected integration.
- Keep administrative credentials out of browser code.

## 6. Funding and payments

Onboarding funding:

Treasury → incoming payment → quote → outgoing payment → verified result.

Participant payment:

Webhook `PAGAR` → quote and confirmation → webhook `CONFIRMAR` → outgoing payment using that participant’s grant → verified result.

Use server-configured top-up amounts. Do not allow frontend callers to select arbitrary treasury debits.

A failed notification must not repeat a transfer. Uncertain transfer outcomes require reconciliation, not blind retries.

## 7. Acceptance criteria

- Accounts have independently verified balances.
- Nine participants receive nine distinct accounts.
- Concurrent or repeated registrations cannot duplicate assignments or top-ups.
- Treasury funds each assignment exactly once.
- Participants can pay the external recipient through the existing webhook.
- Duplicate confirmations cannot create another debit.
- Grants are selected using the sender’s assigned wallet

Please implement this!
````

## Notes

- Reviewer finding: the earlier `dx_1…dx_5` wallets share the same `authServer`/`resourceServer`, so they are **addresses on one account** — they do not satisfy this revised model, which requires independent accounts.
- Feasibility (section 1) depends on creating independent Test Wallet accounts manually; it is a gate before preparing the full pool.
