# Guía para agentes — SMS-Openpayments

Este repositorio es un backend de pagos por SMS con Interledger / Open Payments (Node.js + TypeScript).
El framework HTTP todavía no está elegido; no asumas Next.js ni ningún stack anterior.

## Contribuciones de la IA

- Toda intervención de la IA debe producir código funcional y responder a una necesidad concreta.
- Antes de modificar código, revisar el comportamiento existente y las dependencias de la parte
  afectada para evitar romper funciones que ya operan correctamente.
- Mantener la compatibilidad con los flujos actuales. No eliminar ni alterar funcionalidades
  existentes salvo que la tarea lo requiera expresamente.
- Después de cada cambio, ejecutar `./scripts/verify.sh` (o `npm test`) y corregir los errores
  introducidos antes de dar la tarea por terminada.
- Si no es posible verificar un cambio, indicar con claridad qué quedó sin comprobar y qué riesgo
  puede afectar al funcionamiento.

## Política de IA del hackatón (obligatoria)

1. **Divulgación.** Mantener [`AI_USAGE.md`](../AI_USAGE.md) en la raíz al día: qué herramientas de IA
   se usaron, para qué, y en qué archivos (o "todo el proyecto" si aplica). Indicar explícitamente
   los archivos con poca o ninguna IA.
2. **Registro de prompts.** Guardar en [`prompts/`](../prompts/) el **texto real** de los prompts
   enviados a la IA (no resúmenes), con un archivo por tema o sesión. Añadir el prompt nuevo ahí
   antes de dar por cerrada una tarea relevante.
3. **Criterio humano.** La IA es una herramienta, no un sustituto del criterio del equipo. Revisar,
   probar y entender cualquier código antes de publicarlo. Confiar, pero verificar: el código de IA
   puede tener errores sutiles, ser inseguro o usar APIs desactualizadas.
4. **Preparación Open Payments.** Antes de construir sobre Open Payments, completar el curso de Platzi
   o revisar la guía oficial: <https://openpayments.dev/>.

## Convenciones de trabajo

- Respuestas y documentación del proyecto en **español**; identificadores de código en inglés.
- El *Agent Workflow Kit* vive solo en local (`.opencode/`, `.agent-workflow/`, `scripts/harness/`,
  `docs/agent-workflow/`); no se sube al repositorio.

<!-- El Agent Workflow Kit añade a continuación su bloque gestionado. No editar ese bloque a mano. -->

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
npm test
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
