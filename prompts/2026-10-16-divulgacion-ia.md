# Prompts — Divulgación de IA y registro de prompts (2026-10-16)

## Prompt (texto real)

```text
2. Crea algo que diga AIUsage o algo asi para que los agentes lo tengan en cuenta, donde se defina como vamos a guardar los prompts y toda la cosa
```

The team then pasted the **AI Policy** of the 2026 Open Payments Hackathon, which requires:

1. **Archivo `AI_USAGE.md` en la raíz** con: herramientas de IA usadas, para qué, y en qué parte del
   proyecto (archivos/funciones/componentes), o bien indicar que se usó en todo el proyecto. Además,
   especificar los archivos con mínima o ninguna IA (por ejemplo, el servicio de Open Payments).
2. **Carpeta `/prompts`** (o al final de `AI_USAGE.md` si es breve) con el **texto real** de los
   prompts, no resúmenes.
3. **Criterio humano:** usar la IA sin delegarle el trabajo ni el criterio; confiar pero verificar.
4. **Preparación previa** sobre Open Payments (curso de Platzi o la guía oficial).

## Outcome (what the AI did)

- Created `AI_USAGE.md` with the requested structure.
- Created `prompts/` with an index and the real prompts grouped by topic.
- Added the policy and its rules to `AGENTS.md` so agents take them into account.
