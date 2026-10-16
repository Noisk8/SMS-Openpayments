# Prompts — Relayion SMS provider

Delegated implementation task (bounded worker, branch `task/T-relayion`). The text below is the
prompt exactly as sent to the agent.

## Task prompt

```text
You are a subagent spawned by another session.
You are a bounded implementation worker. Work ONLY inside this git worktree:
`/Users/juminstock/workspace/SMS-Openpayments/.worktrees/T-relayion` (branch `task/T-relayion`, base_sha `3b9f4d3950e54608adbf74573699ac7de170f92a`).

Environment: Node >= 20 (`source ~/.nvm/nvm.sh && nvm use 22`). Setup: `npm --prefix backend install`.

## Objective
Add a real SMS provider adapter for **Relayion** (`https://relayion.com`, API `https://api.relayion.com`), matching the existing `SmsProvider` contract (`backend/src/sms/types.ts`) so inbound SMS and outbound replies work with `SMS_PROVIDER=relayion`.

## Relayion API facts (authoritative — from https://relayion.com/docs)
- Base URL `https://api.relayion.com`, endpoints under `/api/v1/`. JSON envelope `{ success, data }` / `{ success:false, error:{ message, code } }`.
- **Auth (API calls):** `Authorization: Bearer rlyn_...` (API key created in the console).
- **Send SMS:** `POST /api/v1/outbound` with `{ recipientNumber, body, deviceId?, simSlotIndex? }`. Routing defaults to the key's scope; `deviceId`/`simSlotIndex` are optional overrides. Response `data: { id, status: 'DISPATCHED'|'QUEUED', ... }`. Errors: `403 UNAUTHORIZED_DEVICE`, `422 NO_ELIGIBLE_DEVICE`, `429 MONTHLY_LIMIT_EXCEEDED`.
- **Inbound:** `GET /api/v1/inbound/:id` returns `data: { id, senderNumber, body, status, receivedAt, deviceId, simSlotIndex, simPhoneNumber, ... }`.
- **Webhooks:** Relayion POSTs JSON events. Every request carries `X-Relayion-Signature` = **HMAC-SHA256 of the RAW request body using the webhook secret, hex-encoded**. Verification MUST use the raw bytes (never a re-serialized JSON). Event `inbound.received` payload:
  - default (`includeBody` off): `{ "event":"inbound.received", "timestamp":"...", "data": { "id":"<inboundMessageId>", "deviceId":"...", "senderNumber":"+63...", "simSlotIndex":0, "simPhoneNumber":"+63...", "receivedAt":"..." } }` — **no `body`**.
  - with `includeBody` on: the same plus `data.body`.
  - Always subscribe the webhook to the `inbound.*` category (mixing categories is rejected).

## Deliverables
1. `backend/src/sms/providers/relayion.ts` — `RelayionSmsProvider implements SmsProvider`:
   - `validateWebhook`: verify `X-Relayion-Signature` with `crypto.timingSafeEqual`, HMAC-SHA256 hex over the **raw body**. Reject when the event is not `inbound.received`. Never throw; return boolean.
   - `parseIncoming`: map `data.id` → messageId, `data.senderNumber` → from, `data.simPhoneNumber` → to, `data.receivedAt`/`timestamp` → receivedAt, and `data.body` → text. **If `data.body` is missing, fetch it** with `GET /api/v1/inbound/<id>` using the API key (inject a `fetch` for tests). Throw `AppError("VALIDATION_FAILED", …)` on a malformed payload.
   - `sendMessage`: `POST /api/v1/outbound` `{ recipientNumber: input.to, body: input.text, ...(deviceId) }`, map `data.id` → providerMessageId and DISPATCHED/QUEUED → `"queued"`, network/HTTP errors → `{ status: "failed", error }` (never throw).
   - `acknowledge`: return a small JSON ack (`{ success: true }`).
2. **Raw body**: the route currently hands Fastify's parsed body to providers. Add a JSON content-type parser that preserves the raw string (e.g. `request.rawBody`) and extend `WebhookRequest` with an optional `rawBody?: string` (keep existing providers working — do not break mock/twilio).
3. Config (`backend/src/config.ts`): `RELAYION_API_KEY`, `RELAYION_WEBHOOK_SECRET`, optional `RELAYION_DEVICE_ID`; require the two secrets when `SMS_PROVIDER=relayion` (superRefine, like twilio). Add `relayion` to the `SMS_PROVIDER` enum and to `backend/src/sms/provider-factory.ts`. Update `backend/.env.example`.
4. Remove the temporary diagnostic log added in `backend/src/sms/routes.ts` ("SMS webhook rejected: unauthorized") — it was a one-off to capture the provider shape.
5. Docs: add `backend/docs/sms-providers.md` section (or a small `backend/docs/relayion.md`) describing setup: console webhook (inbound.* category, `includeBody` recommendation), the secret, and the API key.
6. Tests (Vitest, inject a fake `fetch`; do NOT hit the network): valid signature accepted; wrong signature rejected; non-inbound event rejected; parse with `body` present; parse without `body` fetches via the API; `sendMessage` success and failure; config requires the Relayion secrets.

## Forbidden
- Do NOT touch `frontend/**`. Do NOT edit migrations. No real network calls in tests. No secrets in tracked files.

## Verification (from the worktree root)
```
npm --prefix backend run typecheck
cd backend && npm test
```

## Rules
- Commit on branch `task/T-relayion`. No push, no tags, don't touch the main workspace.
- Commits, comments and docs in **English**.

## Return (output contract)
status; base_sha; head_sha; branch; worktree; changed_files; verification (commands + result); assumptions; integration_notes (env vars + the exact webhook setup you assume); risks; blockers.
```
