# Prompts — Live demo with Relayion: real payments and documentation (2026-10-17)

Session log for the day the SMS flow moved from the simulator to real handsets with the Relayion
provider on Railway. Prompts are reproduced verbatim, exactly as sent by the team.

## Prompt 1 (verbatim) — the last two Interledger transactions

```text
Las 2 ultimas transacciones de interledger puedes traerlas?
La ultima si le llego al destinatario, y la otra llega en 0s al destinatario
```

Outcome: the two most recent outgoing payments were fetched from the resource server
(`outgoingPayment.get`) and both showed `sentAmount == debitAmount` and `failed: false`. Our own
database still said `PROCESSING` for both, because reconciliation only ran when a job was enqueued
by hand. After enqueuing `reconcile_payment` for both, they became `COMPLETED`
(seq 18: 15,000.00 COP, seq 19: 17,420.00 COP). This is the evidence behind the automatic
reconciliation work item.

## Prompt 2 (verbatim) — where the payment code lives

```text
Como haces los pagos, dime que file es y donde esta
```

Outcome: the answer pointed at `backend/src/payments/` (`service.ts` for orchestration,
`open-payments.ts` for the SDK calls, `fake.ts`, `provider-factory.ts`, `reconciliation.ts`,
`types.ts`) plus the SMS trigger in `backend/src/sms/command-service.ts` and the job handlers in
`backend/src/jobs/handlers.ts`.

## Prompt 3 (verbatim) — include `incomingAmount`

The team pasted the Open Payments API reference for `incoming-payment`
(<https://openpayments.dev/apis/#tag/incoming-payment/POST/incoming-payments>) and then asked:

```text
Let's put the field incomingAmount on the payment request 

Can you show me which fields are we using atm and how we're filling them
```

Decision: `POST /incoming-payments` now sends `incomingAmount` (the amount the recipient should
receive). With matching assets the debit amount is used as the receive amount; with different
assets it is only set when the caller pins the receive side. The answer also listed every field
currently sent on `POST /incoming-payments`, `POST /quotes` and `POST /outgoing-payments`, and where
each value comes from.

Merged as PR #16 (`c00beb8`), 131 tests passing.

## Prompt 4 (verbatim) — deploy

```text
Deploy!
```

Outcome: Railway deployment of `c00beb8` finished with `SUCCESS` and `GET /health` reported
`ok · relayion · openpayments · COP · testFunds=true`.

## Prompt 5 (verbatim) — prompt-log audit and end-to-end documentation

```text
Puedes revisar que Todos los propmpts esten correctamente settled!

Tambien generar una documentacion tecnica de como funciona la implementacion e2e, todo en ingles
```

Outcome: the prompt log was audited (this file, the retired
`2026-10-16-cierre-bootstrap.md` log, the completed index in `README.md`, two redacted secrets and updated
references in `AI_USAGE.md`) and the end-to-end technical documentation was written in
[`backend/docs/architecture.md`](../backend/docs/architecture.md).

## Earlier instructions in the same live-demo session

The following instructions were relayed while the demo was running; their files were already logged
in [`2026-10-16-mvp-comandos-cortos.md`](2026-10-16-mvp-comandos-cortos.md) and
[`2026-10-16-mvp-comandos-sms.md`](2026-10-16-mvp-comandos-sms.md):

- new payment supersedes the pending one (no need to finish or cancel the previous one);
- help text must be understandable;
- recipients are global (any sender can pay any registered alias);
- currency is redundant and is omitted from the replies.
