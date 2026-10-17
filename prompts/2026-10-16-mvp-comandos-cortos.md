# Prompts — MVP de comandos cortos (2026-10-16)

## Prompt 1 (verbatim)

````text
Propongo este spec para el MVP: comandos cortos, destinatarios numerados y confirmación enviando únicamente el código.

### Comandos

| SMS | Acción |
|---|---|
| `P 1000 2` | Preparar un pago de 1000 al destinatario 2 |
| `P 1000 TIENDARUTAN` | Lo mismo, usando el alias |
| `4746` | Confirmar el pago con el código recibido |
| `0` | Cancelar el pago pendiente |
| `1` | Consultar el último pago |
| `2` | Listar destinatarios |
| `9` | Mostrar ayuda |

Los números de destinatario solo se interpretan dentro de `P <monto> <destino>`, así que no chocan con los comandos.

### Flujo de pago

**Usuario:**
```text
P 1000 2
```

**Backend:**
```text
Envias: 1000 COP
Destino: Tienda Ruta N
Recibe: 1000 COP
Responde 4746 para pagar.
0 cancela. Vence en 5 min.
```

No se ejecuta el pago hasta recibir el código correcto.

**Usuario:**
```text
4746
```

**Backend:**
```text
Pago en proceso: 1000 COP a Tienda Ruta N.
Te avisaremos al confirmar.
1 para consultar.
```

Al completarse:
```text
Pago confirmado: 1000 COP a Tienda Ruta N.
```

### Destinatarios

**Usuario:**
```text
2
```

**Backend:**
```text
Destinos:
1 Ana
2 Tienda Ruta N
3 Juan
Para pagar: P 1000 2
```

Cada usuario tiene su propia lista. Los números son permanentes: **no se reordenan ni se reutilizan al eliminar un destinatario**, para evitar pagos al destino equivocado.

### Cancelación y consulta

`0` cancela únicamente un pago que todavía espera confirmación:
```text
Pago cancelado. No se envio dinero.
```

`1` muestra el último pago creado, incluyendo el pendiente:
```text
Ultimo pago: 1000 COP a Tienda Ruta N.
Estado: pendiente.
Responde 4746 para pagar o 0 para cancelar.
```

El código solo se muestra mientras siga vigente y queden intentos. Si se guarda únicamente como hash, **no se vuelve a mostrar**: la respuesta indica que consulte el SMS original.

### Ayuda

**Usuario:**
```text
9
```

**Backend:**
```text
P 1000 2: pagar
Codigo recibido: confirmar
0: cancelar
1: ultimo pago
2: destinos
9: ayuda
```

### Reglas del backend

- Identificar al usuario por el número de origen; exigir registro, verificación y cuenta activa.
- Aceptar mayúsculas, minúsculas y espacios adicionales.
- Usar la moneda de la wallet y mostrarla antes de confirmar.
- Para el MVP, aceptar montos enteros positivos en unidades mayores: `1000` significa 1000 COP. Rechazar puntos, comas, negativos y montos sobre el límite.
- Permitir un solo pago pendiente por usuario.
- Mantener códigos de 4 dígitos, vigencia de 5 minutos y máximo 5 intentos fallidos.
- Interpretar un mensaje de exactamente 4 dígitos como intento de confirmación.
- Al vencer el código, expirar el pago automáticamente y permitir crear otro.
- Ejecutar la confirmación de forma atómica; repetir el código nunca debe generar otro débito.
- Mantener los estados actuales: `AWAITING_CONFIRMATION`, `PROCESSING`, `COMPLETED`, `CANCELLED`, `EXPIRED`, `FAILED` y `NEEDS_REVIEW`.
- Conservar los comandos largos actuales como alternativas compatibles.

**Los SMS pueden llegar tarde:** nunca reutilizar un código para otro pago del mismo usuario. Si se agota el espacio de códigos, será necesario ampliar su longitud.

### Errores breves

| Caso | Respuesta |
|---|---|
| Formato incorrecto | `Formato: P 1000 2. Envia 2 para ver destinos.` |
| Destino inexistente | `Destino no encontrado. Envia 2 para ver destinos.` |
| Pago pendiente | `Ya tienes un pago pendiente. Usa su codigo o envia 0 para cancelar.` |
| Código incorrecto | `Codigo incorrecto. Quedan N intentos.` |
| Código vencido | `El pago vencio. Crea otro con P monto destino.` |
| Sin pago pendiente | `No tienes un pago pendiente. 9 para ayuda.` |
| Resultado incierto | `Pago en revision. No repitas el envio. 1 para consultar.` |
| Texto desconocido | `Comando no reconocido. 9 para ayuda.` |

**Alcance:** este cambio simplifica la interacción; el código recibido por SMS sigue siendo una confirmación, no un PIN personal. La autorización por llamada sería una extensión aparte. Si la wallet exige abrir un enlace de consentimiento en cada pago, ese requisito debe resolverse antes de ofrecer un flujo completamente sin internet. Let's implement this!
````

## Prompt 2 (verbatim) — COP is redundant

```text
El cop es redundante, siempre se envia cop!

El cop es redundante, siempre se envia cop!
```

Decision: the MVP replies must **omit the currency** (always COP): `Envias: 1000`, `Recibe: 1000`,
`Pago en proceso: 1000 a <destino>.`, `Pago confirmado: 1000 a <destino>.`,
`Ultimo pago: 1000 a <destino>.`.

## Notes

- Implementation delegated as `T-mvp-commands`; the worker was steered to drop the currency from the
  replies.
