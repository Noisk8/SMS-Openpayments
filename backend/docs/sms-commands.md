# SMS MVP commands

Short command interface implemented by the SMS engine
(`backend/src/sms/command-service.ts`) on top of the Open Payments flow. The
long commands (`PAGAR`, `CONFIRMAR`, `CANCELAR`, `ESTADO`, `AYUDA`) keep working
as compatible alternatives; both families share the same rules. `AYUDA`/`HELP`
return the same short help as `9`.

Amounts are always in the wallet currency (COP for this deployment), so the
currency is never repeated in replies.

Destinations are addressed **by alias only**: the SMS interface never shows,
accepts or requires a recipient number.

## Commands

| SMS | Action |
|---|---|
| `P 1000 ANA` | Prepare a payment of 1000 to the recipient alias `ANA` |
| `4746` | Confirm the pending payment with the received code |
| `0` | Cancel the pending payment |
| `1` | Show the last payment |
| `9` / `AYUDA` / `HELP` | Show help |

Input is case-insensitive and tolerates extra spaces. A numeric token is never a
destination: it would only resolve a recipient whose alias is literally that
number. `2` is **not** a command.

## Create a payment (`P`)

```
Envias: 1000
Destino: Tienda Ruta N
Recibe: 1000
Responde 4746 para pagar.
0 cancela. Vence en 5 min.
```

Nothing is executed until the right code arrives. The code is stored only as a
salted hash. `P` accepts a recipient `alias`; matching folds case, trims the
edges and ignores inner whitespace, so `TIENDARUTAN` matches `Tienda Ruta N`.
Recipients are per user: an alias that belongs to someone else never resolves.

MVP amounts are **positive integers in major units** (`1000` = 1000 COP). Dots,
commas, signs and amounts over the ceiling (`MVP_MAX_AMOUNT_MAJOR`) are rejected.
The amount is scaled to the wallet's `asset_scale` before hitting the payment
service.

## Confirm (a bare 4-digit code)

```
Pago en proceso: 1000 a Tienda Ruta N.
Te avisaremos al confirmar.
1 para consultar.
```

When the provider confirms settlement the reply is `Pago confirmado: 1000 a
Tienda Ruta N.`. Confirmation is atomic: the payment is claimed with a
conditional `UPDATE`, so repeating the code (or a concurrent duplicate) never
debits twice.

## Cancel (`0`) and status (`1`)

`0` cancels only a payment still awaiting confirmation:

```
Pago cancelado. No se envio dinero.
```

`1` shows the last created payment, including the pending one:

```
Ultimo pago: 1000 a Tienda Ruta N.
Estado: pendiente.
Usa el codigo de tu SMS original o envia 0 para cancelar.
```

The code is never repeated: only its hash is stored, so a pending payment tells
the user to reuse the original SMS.

## Help (`9`, `AYUDA`, `HELP`)

```
Para pagar: P <monto> <destino>
Ejemplo:    P 1000 RUTA
Confirmar:  responde solo el codigo de 4 digitos
0 cancela | 1 ultimo pago | 9 ayuda
```

The help never mentions a destination list: there is none.

## Rules

- The sender must be registered, verified and active.
- Amounts use the wallet currency; it is shown implicitly (never in the text).
- Destinations resolve by alias only (case- and whitespace-insensitive) and are
  **global**: any sender can pay any registered alias. The
  `recipients.number` column and `recipient_counters` are no longer part of the
  SMS interface.
- One pending payment per user.
- 4-digit confirmation codes, 5-minute expiry, at most 5 failed attempts.
- A lapsed code expires the payment automatically and allows creating another.
- A code is never reused for another payment of the same user: every issued code
  is recorded in `sms_confirmation_codes` (hash + fingerprint). Code length grows
  once the shorter space is exhausted (see the `TODO` in `issueConfirmationCode`).
- Existing payment states are kept: `AWAITING_CONFIRMATION`, `PROCESSING`,
  `COMPLETED`, `CANCELLED`, `EXPIRED`, `FAILED`, `NEEDS_REVIEW`.

## Short errors

| Case | Reply |
|---|---|
| Wrong format | `Formato: P 1000 ANA. 9 para ayuda.` |
| Unknown destination | `Destino no encontrado. 9 para ayuda.` |
| Pending payment | `Ya tienes un pago pendiente. Usa su codigo o envia 0 para cancelar.` |
| Wrong code | `Codigo incorrecto. Quedan N intentos.` |
| Expired code | `El pago vencio. Crea otro con P monto destino.` |
| No pending payment | `No tienes un pago pendiente. 9 para ayuda.` |
| Uncertain result | `Pago en revision. No repitas el envio. 1 para consultar.` |
| Unknown text | `Comando no reconocido. 9 para ayuda.` |
