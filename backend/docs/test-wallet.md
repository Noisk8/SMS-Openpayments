# Testing with Interledger Test Wallet

This backend runs in `PAYMENT_PROVIDER=openpayments` mode against the Interledger test network.
The Test Wallet uses play money only. Do not use real funds or real personal data here.

The application is an Open Payments client. It does not operate a Rafiki node and does not use any
admin API. Each user's money stays in a wallet address that the user controls, and payments require
the user's consent through a grant.

## 1. Create the accounts (manual, in the browser)

Follow the official guide: <https://openpayments.dev/sdk/before-you-begin/>

1. Create a Test Wallet account at <https://wallet.interledger-test.dev>.
2. Create a wallet account and fund it with play money (Deposit).
3. Add a wallet address to each account. Create at least:
   - one **client** wallet address for the application (`OP_CLIENT_WALLET_ADDRESS`),
   - one **sender** wallet address (the user who pays),
   - one **receiver** wallet address (the user who receives).
4. Generate a key pair for the client wallet in **Settings > Developer Keys**. The wallet downloads
   `private.key` and shows the `keyId`. Store the private key outside the repository.

## 2. Configure the backend

In `backend/.env` (never commit it):

```dotenv
PAYMENT_PROVIDER=openpayments
OP_CLIENT_WALLET_ADDRESS=https://ilp.interledger-test.dev/<client-wallet>
OP_KEY_ID=<keyId shown by the Test Wallet>
OP_PRIVATE_KEY_PATH=/absolute/path/outside/repo/private.key
PAYMENT_CURRENCY=<asset of the test wallets>
PAYMENT_ASSET_SCALE=<scale of that asset>
DATABASE_URL=postgresql://...
ENCRYPTION_KEY=<openssl rand -base64 32>
ADMIN_API_TOKEN=<openssl rand -hex 32>
```

`PAYMENT_CURRENCY` must match the asset of the wallets you use. The default `COP` is not guaranteed
to exist in the Test Wallet; check the asset first with the preflight below.

## 3. Preflight (read-only)

From `backend/`:

```sh
npm run check:testwallet -- <sender_wallet_url> <receiver_wallet_url>
```

The script checks, without signing requests or creating grants:

- each wallet address is readable and uses `PAYMENT_CURRENCY` / `PAYMENT_ASSET_SCALE`;
- the client wallet's `jwks.json` publishes `OP_KEY_ID`, and that key matches `OP_PRIVATE_KEY_PATH`.

It prints no private key material. It exits with code 1 on any failure.

## 4. Consent callback

The consent step redirects the wallet owner back to this backend. For that, `PUBLIC_BASE_URL` must be
an HTTPS URL reachable from the internet, for example through a tunnel to the local port. The
Open Payments SDK works over HTTPS.

## Limits

- The preflight proves configuration only. Running the test suite (`npm run verify`) does not
  prove a real transfer on the Test Wallet network.
- A real end-to-end payment still needs the sender's consent in the Test Wallet and funded accounts.
