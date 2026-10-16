# Backend — SMS + Open Payments

Node.js + TypeScript backend. It receives real SMS through a webhook, interprets commands, and
executes payments with Open Payments (`@interledger/open-payments`).

## Stack

| Component | Technology |
|---|---|
| Runtime | Node.js >= 20 + TypeScript |
| HTTP | Fastify |
| Database | SQLite + better-sqlite3 (raw SQL, no ORM) |
| Validation | Zod |
| Payments | `@interledger/open-payments` |
| Tests | Vitest |

## Getting started

```sh
cd backend
npm install
cp .env.example .env      # adjust values
npm run db:migrate        # apply the SQLite schema
npm run dev               # http://localhost:3000
```

## Commands

```sh
npm run dev          # server with reload (tsx watch)
npm run start        # server without reload
npm run typecheck    # tsc --noEmit
npm run test         # Vitest
npm run verify       # typecheck + tests (canonical gate)
npm run db:migrate   # apply migrations
```

## Sneak peek (local mode, no credentials)

The `mock` SMS provider and the `fake` payments provider let you exercise the flow without real
infrastructure. With the server running:

```sh
# Health
curl -s localhost:3000/health

# Simulate an inbound SMS (development only)
curl -s -X POST localhost:3000/dev/sms/simulate \
  -H 'content-type: application/json' \
  -d '{"from":"+573001234567","text":"AYUDA"}'

# Mock provider outbox
curl -s localhost:3000/dev/sms/outbox

# Persisted messages
curl -s localhost:3000/dev/sms/messages
```

## Real webhook

`POST /webhooks/sms` — the provider must sign/authenticate the request. The `mock` adapter uses the
`x-webhook-secret` header. The endpoint persists the message before acknowledging it and
deduplicates by `(provider, provider_message_id)`.

## Layout

```
src/
  server.ts            entry point (config, db, provider, listen)
  app.ts               Fastify construction (health, routes, errors)
  config.ts            Zod-validated environment
  domain.ts            types and states
  errors.ts            AppError + HTTP mapping
  db/                  connection, migrations (SQL) and helpers
  sms/                 SMS gateway: routes, service, commands, providers
  payments/            payments service + Open Payments adapter (boundary: types.ts)
  jobs/                persistent queue over SQLite
  security/            AES-256-GCM encryption of credentials
tests/
```

## Status (iteration 1)

- [x] Full SQLite schema (users, wallets, recipients, grants, payments, sms_messages, jobs, audit_events)
- [x] Zod config, secret encryption, persistent job queue
- [x] SMS gateway: signed webhook, persistence, deduplication, dev simulator
- [ ] Full command service (PAGAR/CONFIRMAR/CANCELAR/ESTADO)
- [ ] Payments service + Open Payments adapter
- [ ] Onboarding, recipients, grant lifecycle
- [ ] Job processor and reconciliation
