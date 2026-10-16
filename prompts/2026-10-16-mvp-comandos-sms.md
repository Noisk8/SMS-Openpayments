# Prompt — SMS MVP command interface (`task/T-mvp-commands`)

Delegated implementation task, branch `task/T-mvp-commands`.

## Prompt (verbatim)

You are a subagent spawned by another session.
You are a bounded implementation worker. Work ONLY inside this git worktree:
`.worktrees/T-mvp-commands` (branch `task/T-mvp-commands`, base_sha
`2662023fc255fcc9beba564cfdcf333c8f880eb3`).

### Objective

Implement the SMS **MVP command interface** below (short commands, numbered
recipients, confirm-by-code). Keep the existing long commands (`PAGAR`,
`CONFIRMAR`, `CANCELAR`, `ESTADO`, `AYUDA`) working as compatible alternatives.

### Commands (verbatim spec from the team)

| SMS | Acción |
|---|---|
| `P 1000 2` | Preparar un pago de 1000 al destinatario 2 |
| `P 1000 TIENDARUTAN` | Lo mismo, usando el alias |
| `4746` | Confirmar el pago con el código recibido |
| `0` | Cancelar el pago pendiente |
| `1` | Consultar el último pago |
| `2` | Listar destinatarios |
| `9` | Mostrar ayuda |

Los números de destinatario solo se interpretan dentro de `P <monto> <destino>`,
así que no chocan con los comandos.

#### Flow

`P 1000 2` replies:

```
Envias: 1000 COP
Destino: Tienda Ruta N
Recibe: 1000 COP
Responde 4746 para pagar.
0 cancela. Vence en 5 min.
```

Nothing executes until the correct code arrives. `4746` replies:

```
Pago en proceso: 1000 COP a Tienda Ruta N.
Te avisaremos al confirmar.
1 para consultar.
```

On completion:

```
Pago confirmado: 1000 COP a Tienda Ruta N.
```

#### Recipients (`2`)

```
Destinos:
1 Ana
2 Tienda Ruta N
3 Juan
Para pagar: P 1000 2
```

Each user has their own list. Numbers are **permanent: never reordered, never
reused after deleting a recipient** (so a number can never point at the wrong
destination).

#### Cancel / status

`0` cancels only a payment that is still awaiting confirmation:

```
Pago cancelado. No se envio dinero.
```

`1` shows the last created payment, including the pending one:

```
Ultimo pago: 1000 COP a Tienda Ruta N.
Estado: pendiente.
Responde 4746 para pagar o 0 para cancelar.
```

The code is only shown while it is still valid and attempts remain. Because only
a hash is stored, the code is **never shown again** for a pending payment — the
reply must say to check the original SMS instead.

#### Help (`9`)

```
P 1000 2: pagar
Codigo recibido: confirmar
0: cancelar
1: ultimo pago
2: destinos
9: ayuda
```

### Backend rules

- Identify the user by sender number; require registered, verified, active.
- Accept upper/lower case and extra spaces.
- Use the wallet currency; show it before confirming.
- MVP amounts: **positive integers in major units** (`1000` = 1000 COP). Reject
  dots, commas, negatives and amounts over the limit.
- One pending payment per user.
- 4-digit codes, 5-minute expiry, max 5 failed attempts.
- EXACTLY 4 digits as a message = a confirmation attempt.
- When the code expires, **expire the payment automatically** and allow creating
  another.
- Confirmation must be atomic; repeating the code must never debit twice.
- Keep the existing states: `AWAITING_CONFIRMATION`, `PROCESSING`, `COMPLETED`,
  `CANCELLED`, `EXPIRED`, `FAILED`, `NEEDS_REVIEW`.
- Keep the long commands as compatible alternatives.
- SMS can arrive late: **never reuse a code for another payment of the same
  user**. (If the space is exhausted, the code length must grow — leave a
  TODO/comment, do not silently reuse.)
- Destination display name: use the recipient alias (e.g. `Tienda Ruta N` is just
  the alias shown; store/display the alias).

### Short errors

| Caso | Respuesta |
|---|---|
| Formato incorrecto | `Formato: P 1000 2. Envia 2 para ver destinos.` |
| Destino inexistente | `Destino no encontrado. Envia 2 para ver destinos.` |
| Pago pendiente | `Ya tienes un pago pendiente. Usa su codigo o envia 0 para cancelar.` |
| Código incorrecto | `Codigo incorrecto. Quedan N intentos.` |
| Código vencido | `El pago vencio. Crea otro con P monto destino.` |
| Sin pago pendiente | `No tienes un pago pendiente. 9 para ayuda.` |
| Resultado incierto | `Pago en revision. No repitas el envio. 1 para consultar.` |
| Texto desconocido | `Comando no reconocido. 9 para ayuda.` |

### Scope

- `backend/src/sms/command-service.ts` (parser + engine + replies)
- `backend/src/sms/commands.ts` (keep the sync dev entry working)
- `backend/src/recipients/**`
- ONE new migration adding the recipient number + a per-user monotonic counter
  (backfill existing rows by `created_at` order).
- `backend/tests/**`

Do NOT touch `frontend/**`.

### Tests (Vitest)

Cover: each short command; `P` with a number and with an alias; wrong format;
unknown destination; one-pending rule; bare 4-digit confirmation; wrong code
(attempt count); expired code (payment EXPIRED + can create another); `0` cancel;
`1` status (pending + last); `2` list with stable numbers; **numbers are not
reused after deleting a recipient**; repeated confirmation never double-debits;
long commands still work; case-insensitive inputs.

### Verification (from the worktree root)

```
npm --prefix backend run typecheck
cd backend && npm test
```

### Rules

- Commit on branch `task/T-mvp-commands`. No push, no tags, don't touch the main
  workspace.
- Commits, comments and docs in **English**.
- Update `backend/docs/` with a short `sms-commands.md` describing the MVP.

### Return (output contract)

status; base_sha; head_sha; branch; worktree; changed_files; verification
(commands + result); assumptions (especially the recipient-numbering scheme);
integration_notes; risks; blockers.

## Team clarification (verbatim)

The currency is redundant — it is always COP. Omit it from every SMS reply.

Examples of the new wording:

- Pending: `Envias: 1000` / `Destino: <alias>` / `Recibe: 1000` / `Responde 4746
  para pagar.` / `0 cancela. Vence en 5 min.`
- Confirming: `Pago en proceso: 1000 a <destino>.`
- Completed: `Pago confirmado: 1000 a <destino>.`
- Status: `Ultimo pago: 1000 a <destino>.`
- Errors that mention an amount: no currency either.

Keep everything else exactly as specified (short commands, numbered permanent
recipients, confirm by 4-digit code, `0`/`1`/`2`/`9`, one pending payment,
expiry, atomicity, long commands as alternatives). Update the tests/code that
assert the previous `COP` wording, and reflect the change in
`backend/docs/sms-commands.md`. Re-run `npm --prefix backend run typecheck` and
`cd backend && npm test`.
