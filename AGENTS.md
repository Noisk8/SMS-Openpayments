# Agent guidelines — SMS-Openpayments

This repository is an SMS payments backend built on Interledger / Open Payments.
Stack: Node.js + TypeScript — Fastify, better-sqlite3 (raw SQL, no ORM), Zod, Vitest,
`@interledger/open-payments`.

## Language

- **All commit messages and documentation are written in English** (READMEs, `docs/`,
  `AI_USAGE.md`, `prompts/`).
- Code identifiers are in English.
- Day-to-day chat with the team may be in Spanish.

## AI contributions

- Every AI change must produce working code that answers a concrete need.
- Before changing code, review the existing behavior and dependencies to avoid breaking what
  already works.
- Keep compatibility with current flows. Do not remove or alter existing functionality unless the
  task explicitly requires it.
- After each change, run `./scripts/verify.sh` (or `npm run verify`) and fix any errors introduced
  before considering the task done.
- If a change cannot be verified, state clearly what was left unchecked and what risk it carries.

## Hackathon AI policy (mandatory)

1. **Disclosure.** Keep [`AI_USAGE.md`](../AI_USAGE.md) up to date: which AI tools were used, for
   what, and where in the project (or "throughout" if applicable). Explicitly list the files with
   little or no AI.
2. **Prompt log.** Store in [`prompts/`](../prompts/) the **verbatim** text of the prompts sent to AI
   (not summaries), one file per topic/session. Append new prompts there before closing a relevant
   task.
3. **Human judgment.** AI is a tool, not a replacement for the team's judgment. Review, test, and
   understand any code before publishing it. Trust, but verify: AI code can contain subtle bugs, be
   insecure, or use outdated APIs.
4. **Open Payments preparation.** Before building on Open Payments, complete the Platzi course or
   review the official guide: <https://openpayments.dev/>.

## Working conventions

- The Agent Workflow Kit lives only locally (`.opencode/`, `.agent-workflow/`, `scripts/harness/`,
  `docs/agent-workflow/`); it is not committed.

<!-- agent-workflow:begin -->
# Agent Workflow

This project uses the portable agent workflow kit. Before modifying the
repository, read and follow:

```text
docs/agent-workflow/DEVELOPMENT_CONTRACT.md
```

Operational mechanics for delegated execution live in:

```text
docs/agent-workflow/orchestration.md
docs/agent-workflow/iteration-profiles.md
docs/agent-workflow/review-state.md
```

Project scope for the current increment is defined in:

```text
AGENTS.md
```

Canonical mechanical verification:

```sh
npm run verify
```

Rules:

- One delegated implementation task = one branch = one worktree.
- The orchestrator owns worktrees, integration, verification and promotion.
- Workers never integrate themselves, move `known-good`, push or deploy.
- Review is independent, incremental and evidence-based.
- Never build new work on a suspected broken foundation.
- Do not move `known-good` until an iteration passes verification and review.
- Preserve user content outside the managed block below.
<!-- agent-workflow:end -->
