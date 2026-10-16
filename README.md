# SMS-Openpayments

Pagos por SMS en Colombia usando **Interledger / Open Payments**. La idea: una persona escribe un
mensaje de texto para enviar dinero, consultar el estado o crear su cuenta, sin apps ni conexión a
internet.

## Estructura

```
backend/     backend Node.js + TypeScript (Fastify, better-sqlite3, Zod, Vitest, @interledger/open-payments)
prompts/     registro de prompts de IA (política del hackatón)
AI_USAGE.md  divulgación de uso de IA
```

## Ejecutar el backend

```sh
cd backend
npm install
npm run dev            # http://localhost:3000
npm run verify         # typecheck + tests
```

Detalle en [`backend/README.md`](backend/README.md).

## Divulgación de IA

Este proyecto usa IA durante el hackatón. Ver [`AI_USAGE.md`](AI_USAGE.md) y [`prompts/`](prompts/).

## Workflow de agentes

El repo usa el *Agent Workflow Kit* de forma **local** (`.opencode/`, `.agent-workflow/`,
`scripts/harness/`, `docs/agent-workflow/`), en `.gitignore`: cada integrante instala el suyo.
