# Relayion SMS provider

This backend can send and receive SMS through [Relayion](https://relayion.com) by setting
`SMS_PROVIDER=relayion`. The adapter lives in `backend/src/sms/providers/relayion.ts` and implements
the same [`SmsProvider`](../src/sms/types.ts) contract as `mock` and `twilio`.

- API base URL: `https://api.relayion.com` (endpoints under `/api/v1/`).
- Response envelope: `{ success, data }`, or `{ success: false, error: { message, code } }`.

## 1. Configuration

In `backend/.env` (never commit it):

```dotenv
SMS_PROVIDER=relayion
SMS_FROM=+63...
RELAYION_API_KEY=rlyn_...          # API key created in the Relayion console
RELAYION_WEBHOOK_SECRET=...        # webhook secret (signs every delivery)
# RELAYION_DEVICE_ID=...           # optional: force the sending device
```

`RELAYION_API_KEY` and `RELAYION_WEBHOOK_SECRET` are required when `SMS_PROVIDER=relayion`; the
process refuses to start without them (`backend/src/config.ts`).

### API key

Create an API key in the Relayion console. It looks like `rlyn_...` and is sent on every API call as:

```
Authorization: Bearer rlyn_...
```

### Device / routing

Outbound routing uses the device scope of the API key by default. Set `RELAYION_DEVICE_ID` only when
you need to pin a specific device; it is sent as the optional `deviceId` field on
`POST /api/v1/outbound`. An ineligible or unauthorized device surfaces as
`NO_ELIGIBLE_DEVICE` / `UNAUTHORIZED_DEVICE` and the send is reported as failed.

## 2. Webhook setup (console)

Point the Relayion webhook at:

```
https://<your-public-host>/webhooks/sms
```

- **Category:** subscribe to `inbound.*` only. Relayion rejects webhooks that mix categories.
- **`includeBody`:** recommended **on**. With it, each `inbound.received` event already carries
  `data.body`, so no extra API call is needed. When it is off, the adapter transparently fetches the
  message with `GET /api/v1/inbound/:id` using the API key.
- **Secret:** copy the webhook secret into `RELAYION_WEBHOOK_SECRET`.

### Signature verification

Every delivery carries `X-Relayion-Signature`: the hex-encoded HMAC-SHA256 of the **raw request
body** computed with the webhook secret. The adapter verifies the signature with
`crypto.timingSafeEqual` over the exact bytes received (`request.rawBody`), never over a
re-serialized copy of the parsed JSON, and rejects any event whose type is not `inbound.received`.

Because the raw bytes are needed, `backend/src/app.ts` installs a JSON content-type parser that
stores the untouched payload on `request.rawBody` before parsing it.

### Event shape

Default (`includeBody` off):

```json
{
  "event": "inbound.received",
  "timestamp": "2026-01-01T00:00:00.000Z",
  "data": {
    "id": "<inboundMessageId>",
    "deviceId": "...",
    "senderNumber": "+63...",
    "simSlotIndex": 0,
    "simPhoneNumber": "+63...",
    "receivedAt": "2026-01-01T00:00:00.000Z"
  }
}
```

With `includeBody` on, `data.body` is added.

The adapter maps: `data.id` → `messageId`, `data.senderNumber` → `from`, `data.simPhoneNumber` → `to`,
`data.receivedAt` (or the top-level `timestamp`) → `receivedAt`, and `data.body` → `text`.

## 3. Outbound replies

`POST /api/v1/outbound` with:

```json
{ "recipientNumber": "+63...", "body": "...", "deviceId": "<optional>" }
```

A `DISPATCHED` or `QUEUED` response is recorded as `queued` with the returned `data.id` as the
provider message id. Network and HTTP errors are reported as `failed` and never thrown, so an
outbound failure does not break command handling.

## 4. Local development

Use `SMS_PROVIDER=mock` locally (see `backend/.env.example`). To exercise the Relayion adapter
without hitting the network, inject a fake `fetch` into `RelayionSmsProvider` (the test suite does
this in `backend/tests/relayion.test.ts`).
