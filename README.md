# SMS-Openpayments

Pagos por SMS en Colombia usando **Interledger / Open Payments**. La idea: una persona escribe un
mensaje de texto para enviar dinero, consultar su saldo o crear su cuenta, sin apps ni conexión a
internet.

> **Estado:** el repositorio se reinició a un esqueleto limpio. El código anterior (Next.js, Prisma,
> proveedores SMS, modo mock) sigue disponible en el historial de git y se reconstruirá de forma
> mínima. La base actual es solo `package.json`, una prueba de humo y la documentación de agentes e IA.

## Enfoque previsto

- **Open Payments + SDK oficial de Node.js/TypeScript** (`@interledger/open-payments`).
- **Interledger Test Wallet** como billetera de pruebas.
- Un backend mínimo: webhook de SMS + cliente de Open Payments.
- Autorización previa con límites para que el usuario pague por SMS tras una vinculación inicial.

Detalle de la investigación de SDKs en [`docs/`](docs/) cuando se documente; por ahora la decisión es
mantener **Node.js + TypeScript** porque es el SDK oficial, mantenido y ya conocido por el equipo.

## Ejecutar

```sh
npm test      # prueba de humo (node:test, sin dependencias)
```

El framework del backend está **por decidir**. Cuando se elija se añadirán sus dependencias y
comandos.

## Divulgación de IA

Este proyecto usa IA durante el hackatón. Ver [`AI_USAGE.md`](AI_USAGE.md) y la carpeta
[`prompts/`](prompts/) con los prompts reales usados.

## Workflow de agentes

El repo usa el *Agent Workflow Kit* de forma **local** (`.opencode/`, `.agent-workflow/`,
`scripts/harness/`, `docs/agent-workflow/`). Esas rutas están en `.gitignore`: cada integrante
instala y configura el suyo.
