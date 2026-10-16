# Divulgación de uso de IA

Este archivo cumple la **Política de IA** del 2026 Hackatón de Open Payments: declarar qué
herramientas de IA se usaron, para qué, y en qué parte del proyecto. Los prompts reales están en
[`prompts/`](prompts/).

## Herramientas usadas

- **OpenCode** (agente de IA; modelo **DeepSeek V4.1 Flash**) — usado en esta sesión para reiniciar
  el repositorio, redactar la divulgación de IA e instalar el workflow de agentes.
- **Asistentes de IA previos** — el prototipo original (Next.js + Prisma + proveedores SMS + modo
  mock) fue generado con asistencia de IA antes del reinicio. Ese código quedó eliminado del árbol de
  trabajo y se conserva solo en el historial de git.

## Dónde y cómo se usó la IA

### 1. Reinicio del repositorio a un esqueleto limpio

- Se usó el agente para investigar los SDKs oficiales de Open Payments y para eliminar el código de
  aplicación anterior.
- Decisión y alcance (qué borrar y qué conservar) tomada por el equipo; el agente ejecutó la limpieza.

### 2. Divulgación de IA y documentación de agentes

- `AI_USAGE.md`, `prompts/` y `AGENTS.md`: redactados con el agente y revisados por el equipo.

### 3. Workflow de agentes (solo local)

- Instalación del *Agent Workflow Kit* (`Another-DevX/agent-workflow-kit`) con el CLI oficial. Las
  rutas que genera están en `.gitignore` y no se publican.

### 4. Código de la aplicación

- **Todavía no existe.** El framework del backend está por decidir. Cuando se escriba, se documentará
  aquí archivo por archivo, incluyendo explícitamente el servicio de Open Payments, que el equipo
  buscará escribir y entender con la menor ayuda de IA posible.

## Qué hicimos nosotros

- Definir el alcance, los recortes y el stack.
- Revisar y validar cada cambio del agente antes de aceptarlo.
- (Pendiente) Reescribir y probar el flujo de Open Payments a mano y documentarlo en
  [`docs/`](docs/).

## Registro de prompts

Ver [`prompts/`](prompts/):

- [`prompts/2026-10-16-reinicio-y-sdk.md`](prompts/2026-10-16-reinicio-y-sdk.md)
- [`prompts/2026-10-16-divulgacion-ia.md`](prompts/2026-10-16-divulgacion-ia.md)
- [`prompts/2026-10-16-workflow-agentes.md`](prompts/2026-10-16-workflow-agentes.md)
- [`prompts/2026-10-16-cierre-bootstrap.md`](prompts/2026-10-16-cierre-bootstrap.md)

> Nota: actualizar este archivo cada vez que la IA toque código nuevo.
