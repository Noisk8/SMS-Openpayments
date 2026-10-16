# Prompts — Workflow de agentes y `.gitignore` (2026-10-16)

## Prompt 1 (texto real)

```text
3. mete al gitignore todas las cosas de los agentes ya que cada quien va a tener su propia setup
```

## Prompt 2 (texto real)

```text
https://github.com/Another-DevX/agent-workflow-kit finalmente, implementa esta arquitectura para que funcione LOCALMENTE para mis agentes! y ten en cuenta lo que añadiste con las reglas
```

## Respuesta del equipo a la pregunta de aclaración

- **Qué queda solo en local (gitignore):** «Todo el workflow local (Recomendado)» — `.opencode/`,
  `.agent-workflow/`, `.orchestration/`, `.worktrees/`, `.review/`, `scripts/verify*.sh`,
  `scripts/harness/` y `docs/agent-workflow/` no se suben al repositorio.

## Resultado (lo que hizo la IA)

- Instaló el **Agent Workflow Kit** (`Another-DevX/agent-workflow-kit`) localmente con su CLI,
  registrando `verifyCommand` y `setupCommand` en `.agent-workflow/project.json`.
- Añadió al `.gitignore` las rutas del workflow para que cada integrante tenga su propia configuración.
- Mantuvo `AI_USAGE.md` y `prompts/` **versionados** (son obligatorios para el hackatón), a diferencia
  del kit, que es local.
