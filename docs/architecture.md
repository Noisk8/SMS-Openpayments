# Arquitectura

## Capas

```
Presentación     src/app (páginas, route handlers), src/components
     │
Aplicación       src/lib/accounts, src/lib/transfers, src/lib/balances, src/lib/sms/command-handler.ts
     │           (crearCuenta, enviarDinero, verSaldo, manejador SMS)
Dominio          reglas de validación (src/lib/validation), errores (src/lib/errors.ts),
     │           contabilidad (LedgerEntry, saldos derivados del libro)
Infraestructura  src/lib/payments/providers, src/lib/sms/providers, src/lib/db, src/lib/crypto
```

Los canales (web, webhooks, simulador) solo traducen su entrada a una llamada de aplicación.
Ninguno contiene lógica de pagos.

## Flujo de un SMS

```
Proveedor SMS ──webhook──> receiveSmsWebhook()
                              │  valida firma (si el proveedor es el activo)
                              ▼
                        parseIncoming() → IncomingSms
                              │
                              ▼
                     handleIncomingSms()  ── deduplica (proveedor, id)
                              │
                parseCommand() → comando tipado
                              │
             crearCuenta / confirmarCuenta / enviarDinero / verSaldo
                              │
                   sendTrackedSms() → respuesta registrada
```

El simulador (`POST /api/dev/sms/simulate`) reemplaza únicamente el proveedor de salida por el mock.

## Pagos en modo mock

- Cada usuario tiene una `Wallet` con `provider = "mock"`.
- Los saldos **no se guardan**: se calculan sumando `LedgerEntry` (CREDIT − DEBIT).
- Una transferencia es una transacción de base de datos que:
  1. bloquea las dos billeteras con `SELECT … FOR UPDATE` (orden por id para evitar interbloqueos),
  2. comprueba el saldo del origen,
  3. inserta un DEBIT y un CREDIT del mismo importe,
  4. marca la `Transaction` como `COMPLETED`.
- Si el saldo no alcanza, la transacción queda `FAILED` y no se escribe ningún movimiento.
- La clave de idempotencia es única en `Transaction`. Un reintento devuelve la operación original.

## Pagos en modo Open Payments

Ver `docs/openpayments.md`. El adaptador no escribe saldos: el saldo lo mantiene la billetera del
proveedor. `verSaldo` devuelve `BALANCE_NOT_SUPPORTED` porque Open Payments no ofrece una API
universal de saldo.

## Cambiar de proveedor

- SMS: `SMS_PROVIDER` selecciona la implementación en `src/lib/sms/provider-factory.ts`.
- Pagos: `PAYMENT_PROVIDER` selecciona la implementación en `src/lib/payments/provider-factory.ts`.

La prueba `tests/sms.test.ts` (TEST 11) demuestra que el mismo SMS produce el mismo resultado de pago
con otro proveedor de envío.

## Modelo de datos

| Tabla | Propósito |
|---|---|
| `User` | Titular: teléfono y alias únicos, hash de clave (Argon2id) y fecha de verificación |
| `Wallet` | Billetera del usuario (mock o externa). Las claves privadas van cifradas |
| `PaymentAuthorization` | Consentimiento Open Payments (token cifrado, estado, límite) |
| `Transaction` | Operación de envío, con referencia, estado e idempotencia |
| `LedgerEntry` | Movimientos contables de cada transacción |
| `SmsMessage` | Mensajes entrantes y salientes, con cuerpo cifrado y deduplicación |
| `PhoneVerification` | Código de alta (solo hash) con caducidad e intentos |
