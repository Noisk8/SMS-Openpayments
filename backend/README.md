# Backend — SMS + Open Payments

Backend Node.js + TypeScript. Recibe SMS reales por webhook, interpreta comandos y ejecuta pagos
con Open Payments (`@interledger/open-payments`).

## Stack

| Componente | Tecnología |
|---|---|
| Runtime | Node.js >= 20 + TypeScript |
| HTTP | Fastify |
| Base de datos | SQLite + better-sqlite3 (SQL directo, sin ORM) |
| Validación | Zod |
| Pagos | `@interledger/open-payments` |
| Pruebas | Vitest |

## Arranque

```sh
cd backend
npm install
cp .env.example .env      # ajusta valores
npm run db:migrate        # aplica el esquema SQLite
npm run dev               # http://localhost:3000
```

## Comandos

```sh
npm run dev          # servidor con recarga (tsx watch)
npm run start        # servidor sin recarga
npm run typecheck    # tsc --noEmit
npm run test         # Vitest
npm run verify       # typecheck + tests (gate canónico)
npm run db:migrate   # aplica migraciones
```

## Sneak peek (modo local, sin credenciales)

El proveedor de SMS `mock` y el de pagos `fake` permiten probar el flujo sin infraestructura real.
Con el servidor levantado:

```sh
# Salud
curl -s localhost:3000/health

# Simular un SMS entrante (solo desarrollo)
curl -s -X POST localhost:3000/dev/sms/simulate \
  -H 'content-type: application/json' \
  -d '{"from":"+573001234567","text":"AYUDA"}'

# Bandeja de salida del proveedor mock
curl -s localhost:3000/dev/sms/outbox

# Mensajes persistidos
curl -s localhost:3000/dev/sms/messages
```

## Webhook real

`POST /webhooks/sms` — el proveedor debe firmar/autenticar la petición. En el adaptador `mock` se usa
la cabecera `x-webhook-secret`. El endpoint persiste el mensaje antes de reconocerlo y deduplica por
`(provider, provider_message_id)`.

## Estructura

```
src/
  server.ts            arranque (config, db, proveedor, listen)
  app.ts               construcción de Fastify (health, rutas, errores)
  config.ts            validación de entorno con Zod
  domain.ts            tipos y estados
  errors.ts            AppError + mapeo a HTTP
  db/                  conexión, migraciones (SQL) y helpers
  sms/                 gateway SMS: rutas, servicio, comandos, proveedores
  payments/            (en construcción) servicio de pagos + adaptador Open Payments
  jobs/                cola persistente sobre SQLite
  security/            cifrado AES-256-GCM de credenciales
```

## Estado (iteración 1)

- [x] Esquema SQLite completo (users, wallets, recipients, grants, payments, sms_messages, jobs, audit_events)
- [x] Config con Zod, cifrado de secretos, cola de trabajos persistente
- [x] Gateway SMS: webhook firmado, persistencia, deduplicación, simulador dev
- [ ] Servicio de comandos completo (PAGAR/CONFIRMAR/CANCELAR/ESTADO)
- [ ] Servicio de pagos + adaptador Open Payments
- [ ] Onboarding, destinatarios, ciclo de vida de grants
- [ ] Procesador de trabajos y reconciliación
