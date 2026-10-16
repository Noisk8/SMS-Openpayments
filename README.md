# SMS-Openpayments

SMS payments in Colombia powered by **Interledger / Open Payments**. The idea: a person sends a text
message to pay someone, check a payment status, or create their account — no apps, no internet
connection required.

## Repository layout

```
backend/     Node.js + TypeScript backend (Fastify, better-sqlite3, Zod, Vitest, @interledger/open-payments)
prompts/     AI prompt log (hackathon AI policy)
AI_USAGE.md  AI usage disclosure
```

## Run the backend

```sh
cd backend
npm install
npm run dev            # http://localhost:3000
npm run verify         # typecheck + tests
```

See [`backend/README.md`](backend/README.md) for details.

## AI disclosure

This project uses AI during the hackathon. See [`AI_USAGE.md`](AI_USAGE.md) and [`prompts/`](prompts/).

## Agent workflow

The repository uses the *Agent Workflow Kit* **locally** (`.opencode/`, `.agent-workflow/`,
`scripts/harness/`, `docs/agent-workflow/`), all listed in `.gitignore`: each contributor installs
their own.
