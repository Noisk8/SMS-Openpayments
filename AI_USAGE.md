# AI Usage Disclosure

This file satisfies the **AI Policy** of the 2026 Open Payments Hackathon: it declares which AI
tools were used, for what, and where in the project. The real prompts are stored in
[`prompts/`](prompts/).

## Tools used

- **OpenCode** (AI agent; model **DeepSeek V4.1 Flash**) — used in this session to reset the
  repository, write the AI disclosure, install the local agent workflow, and build the backend.
- **Previous AI assistants** — the original prototype (Next.js + Prisma + SMS providers + mock mode)
  was generated with AI assistance before the reset. That code was removed from the working tree and
  is preserved only in git history.

## Where and how AI was used

### 1. Repository reset to a clean skeleton

- The agent researched the official Open Payments SDKs and removed the previous application code.
- The team decided the scope (what to delete and what to keep); the agent executed the cleanup.

### 2. AI disclosure and agent documentation

- `AI_USAGE.md`, `prompts/` and `AGENTS.md`: drafted with the agent and reviewed by the team.

### 3. Agent workflow (local only)

- Installed the *Agent Workflow Kit* (`Another-DevX/agent-workflow-kit`) with its official CLI. The
  paths it generates are in `.gitignore` and are not published.

### 4. Backend implementation (`backend/`)

- The agent scaffolded the backend foundation and the first feature verticals: environment config,
  SQLite schema and migrations, the SMS gateway (webhook, persistence, deduplication, dev simulator),
  the persistent job queue, secret encryption, the payments domain and the accounts domain.
- Files to review by hand: the Open Payments adapter (`backend/src/payments/open-payments.ts`) and
  the payment service (`backend/src/payments/service.ts`) — the team will read, correct and test the
  Open Payments flow itself as the lowest-AI part of the codebase.

## What we did ourselves

- Defined the scope, the stack and the cuts.
- Owned the Open Payments design decisions (grant budgets, confirmation model).
- (Ongoing) Reviewing and testing every AI change before accepting it.

## Prompt log

See [`prompts/`](prompts/):

- [`prompts/2026-10-16-reinicio-y-sdk.md`](prompts/2026-10-16-reinicio-y-sdk.md)
- [`prompts/2026-10-16-divulgacion-ia.md`](prompts/2026-10-16-divulgacion-ia.md)
- [`prompts/2026-10-16-workflow-agentes.md`](prompts/2026-10-16-workflow-agentes.md)
- [`prompts/2026-10-16-cierre-bootstrap.md`](prompts/2026-10-16-cierre-bootstrap.md)
- [`prompts/2026-10-16-specs-backend.md`](prompts/2026-10-16-specs-backend.md)
- [`prompts/2026-10-16-english-convention.md`](prompts/2026-10-16-english-convention.md)

> Note: update this file whenever AI touches new code.
