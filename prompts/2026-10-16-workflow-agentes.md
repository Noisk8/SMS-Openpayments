# Prompts — Workflow de agentes y `.gitignore` (2026-10-16)

## Prompt 1 (texto real)

```text
3. mete al gitignore todas las cosas de los agentes ya que cada quien va a tener su propia setup
```

## Prompt 2 (texto real)

```text
https://github.com/Another-DevX/agent-workflow-kit finalmente, implementa esta arquitectura para que funcione LOCALMENTE para mis agentes! y ten en cuenta lo que añadiste con las reglas
```

## Team answer to the clarifying question

- **What stays local only (gitignore):** "The whole local workflow (Recommended)" — `.opencode/`,
  `.agent-workflow/`, `.orchestration/`, `.worktrees/`, `.review/`, `scripts/verify*.sh`,
  `scripts/harness/` and `docs/agent-workflow/` are not pushed to the repository.

## Outcome (what the AI did)

- Installed the **Agent Workflow Kit** (`Another-DevX/agent-workflow-kit`) locally with its CLI,
  recording `verifyCommand` and `setupCommand` in `.agent-workflow/project.json`.
- Added the workflow paths to `.gitignore` so each contributor keeps their own configuration.
- Kept `AI_USAGE.md` and `prompts/` **versioned** (they are mandatory for the hackathon), unlike the
  kit, which is local.
