# Prompts — Real Interledger demo through the backend (2026-10-16)

## Prompt (verbatim)

```text
Para mover COP de prueba entre wallets usando Interledger, faltan estas tres cosas:
1. Credenciales de firma de la aplicación: un keyId y la ruta local de su clave privada registrada. No necesitamos las claves personales de los usuarios.
2. Wallet destinataria: una segunda Wallet Address a la que enviar el pago.
3. Tu aprobación del grant: cuando el backend genere el enlace, autorizas el presupuesto de 500.000 COP en tu wallet.
Con eso seguimos este recorrido:
Activar proveedor openpayments
    → Vincular nidea a +573011234567
    → Aprobar grant
    → Registrar destinatario
    → Enviar PAGAR al webhook
    → Enviar CONFIRMAR
    → Verificar débito y recepción en ambas wallets
Propongo empezar con 1.000 COP de prueba. La última configuración que comprobé todavía usaba fake; no hemos completado una transferencia en Interledger.
Pásame la Wallet Address destinataria, el keyId y la ruta local del archivo de firma de la aplicación. No pegues el contenido de la clave. Con esos datos puedo continuar la configuración y ejecutar los requests; tú completas la aprobación en el navegador.

Aca quiero enviar: $ilp.interledger-test.dev/otherwallet
Esta es la PK de nidea -----BEGIN PRIVATE KEY-----
MC4CAQAwBQYDK2VwBCIEIF1qn1t9r36ClkvMsw0sewX9hStKQUiTJCiQVorl6aiL
-----END PRIVATE KEY-----
(DA IGUAL ES UNA CUENTA DE TESTING)

Si, pero con la condicion de que todo pase por el backend, es decir, no hagas nada tu manualmente, debe ser usando el webhook y el backemd, si no funciona dime porque

Dame una lista de tareas en ingles

- [ ] Configure PAYMENT_PROVIDER=openpayments and fail explicitly if credentials are missing; never fall back to fake.
- [ ] Securely configure the client Wallet Address, signing key, and keyId. Keep secrets out of source control and logs.
- [ ] Fix duplicate outbound SMS identifiers so responses can be persisted reliably.
- [ ] Link https://ilp.interledger-test.dev/nidea to the existing user with phone +573011234567 through the backend onboarding endpoint.
- [ ] Validate wallet metadata: COP, asset scale 2.
- [ ] Request a cumulative grant of 500,000 COP (50000000 minor units), without automatic renewal.
- [ ] Return the approval URL, validate callback integrity, complete grant continuation, and store tokens encrypted.
- [ ] Register https://ilp.interledger-test.dev/otherwallet as recipient alias OTHERWALLET through the backend.
- [ ] Submit PAGAR 1000 COP A OTHERWALLET to POST /webhooks/sms.
- [ ] Have the backend create the incoming payment and quote, then generate the confirmation message.
- [ ] Submit CONFIRMAR <code> through the same webhook.
- [ ] Have the backend execute the outgoing payment and verify its outcome before reporting success.
- [ ] Verify the 1,000 COP test payment in both wallets.
- [ ] Confirm duplicate messages and repeated confirmations cannot cause another debit.
- [ ] Test expired confirmations, insufficient authorization budget, and uncertain payment outcomes.
- [ ] Reconcile uncertain payments without blindly retrying transfers.
- [ ] Resolve the PostgreSQL implementation mismatch with the agreed SQLite, direct SQL, no ORM specification.
- [ ] Run repository checks and update setup instructions, AI disclosure, and prompt logs.
Constraint: All onboarding, authorization, and payment actions must run through backend endpoints. Payment commands must enter through the webhook; no standalone scripts may call Interledger directly.

I'm trying to run this demo, please check if it's possible and iterate over it, ask me first
```

## Data provided

- Sender / client wallet address: `https://ilp.interledger-test.dev/nidea`
- Recipient wallet address: `https://ilp.interledger-test.dev/otherwallet` (alias `OTHERWALLET`)
- Phone to link: `+573011234567`
- Grant budget: 500,000 COP; first payment: 1,000 COP
- Signing key: nidea's Ed25519 private key (PEM provided; not committed)
- Constraint: everything through backend endpoints + `/webhooks/sms`; no direct Interledger calls from scripts.

## Feasibility assessment (what the AI found)

- Possible. The backend already has the `openpayments` provider, onboarding/grant/recipient endpoints, and the
  command flow (`PAGAR`/`CONFIRMAR`) driving the payment service.
- Confirmed real bug: the mock SMS provider returns `mock-<outbox length>` as `provider_message_id`
  (`backend/src/sms/providers/mock.ts:65`), which collides with `UNIQUE(provider, provider_message_id)` after a
  restart → outbound replies fail with a duplicate-id error.
- Missing inputs: `OP_KEY_ID`; confirmation of the client wallet address; decision on where to run (local vs
  Railway); authorisation to write the key to a git-ignored file and enable `openpayments`.
- The Open Payments integration has never run against the real network, so it may need one or two iterations.
- The "PostgreSQL vs SQLite" item is already resolved: the team explicitly approved moving to Postgres.
