# Prompts — Limpieza del proyecto y elección de SDK (2026-10-16)

## Prompt (texto real, íntegro)

```text
1. Puedes limpiar este proyecto Sí. **Para su sistema de pagos por SMS recomiendo Open Payments + el SDK de Node.js + Interledger Test Wallet.** El mejor encaje es el **Premio a la Inclusión**, por facilitar pagos desde teléfonos básicos o con conectividad limitada.

La decisión que deben resolver primero es **cómo autoriza el usuario los pagos**: enviar un SMS no sustituye el consentimiento que exige Open Payments.

**Qué tecnologías tienen disponibles**

| Tecnología / recurso | Para qué sirve | Qué usaría en su proyecto |
|---|---|---|
| **Open Payments** | API estándar para preparar e iniciar pagos entre cuentas compatibles. | El núcleo de la integración. |
| **Wallet Addresses** | Direcciones que identifican cuentas y permiten descubrir sus servicios y moneda. | Asociar cada teléfono registrado con una dirección de wallet. |
| **GNAP y grants** | Permisos con los que la aplicación puede actuar sobre una cuenta, con consentimiento y límites. | Autorizar los pagos del remitente. |
| **SDK Node.js / TypeScript** | Cliente que firma solicitudes y valida respuestas. | La opción principal para el backend. También hay recursos para PHP. |
| **Interledger Test Wallet** | Billetera de prueba con dinero ficticio y APIs de Open Payments. | Dos cuentas para demostrar envío y recepción. |
| **Interledger Pay / Boutique** | Aplicaciones de referencia de pagos entre personas y comercio electrónico. | Consultarlas para entender los flujos. |
| **Rafiki** | Software para que un proveedor de cuentas incorpore Open Payments e Interledger. | Reservarlo para una etapa en la que operen su propia infraestructura. |

La página del hackathon reúne los [recursos y aplicaciones de prueba](https://interledger.org/es/hackathon/open-payments/). El [SDK oficial](https://github.com/interledger/open-payments-node) describe los componentes de Open Payments; [Rafiki](https://rafiki.dev/integration/overview/) cubre la integración desde el lado del proveedor de cuentas.

**Cómo encaja SMS con Open Payments**

Mi propuesta es que ustedes construyan la interfaz y la lógica que conecta el teléfono con la billetera:

```text
Teléfono del usuario
        ↓ SMS
Proveedor de mensajería
        ↓ webhook
Backend de ustedes
  • identifica al usuario
  • resuelve teléfono → wallet
  • verifica confirmación y límites
        ↓ SDK
Open Payments → billeteras compatibles
        ↓
SMS con el resultado verificado
```

El proveedor de SMS es un componente externo que deben contratar o integrar. El teléfono sería un alias administrado por ustedes; **no se convierte automáticamente en una dirección de Open Payments**.

El flujo de pago usa tres recursos:

1. **`incoming-payment`**: prepara la recepción en la cuenta destinataria.
2. **`quote`**: obtiene los importes de envío y recepción.
3. **`outgoing-payment`**: inicia el pago desde la cuenta remitente, con el permiso correspondiente.

Después deben consultar el resultado antes de enviar el comprobante. La documentación explica el [flujo completo y su autorización](https://openpayments.dev/concepts/op-flow/).

**La parte decisiva: pagar desde un teléfono básico**

Tienen dos caminos:

| Enfoque | Experiencia | Encaje |
|---|---|---|
| **Autorización por cada pago** | El SMS inicia el proceso y devuelve un enlace para autorizar en la wallet. | Es el MVP más directo, pero requiere navegador y conexión para aprobar. |
| **Autorización previa con límites** | El usuario conecta su wallet y autoriza un presupuesto durante el registro; después ordena pagos por SMS dentro de ese permiso. | Es el enfoque que recomiendo explorar para inclusión. |

Open Payments documenta [permisos para pagos futuros sin conocer previamente al destinatario](https://openpayments.dev/guides/outgoing-grant-future-payments/), con límites de gasto. **Primero validaría ese flujo en la Test Wallet**, antes de diseñar toda la experiencia alrededor de él.

La promesa precisa sería: **“pagos cotidianos por SMS después de una vinculación y autorización inicial”**. Un servicio que funcione exclusivamente por SMS desde el registro también necesita resolver la autenticación y el consentimiento con el proveedor de la cuenta.

**Setup que recomiendo para el hackathon**

1. **Crear dos cuentas en la [Test Wallet](https://wallet.interledger-test.dev/)**, con fondos de prueba y sus direcciones.
2. **Montar un backend Node.js + TypeScript** con el SDK `@interledger/open-payments`. Configurar la identidad del cliente, su clave privada y `keyId`; guardar las claves únicamente en el servidor.
3. **Completar primero un pago entre ambas wallets**, incluyendo consentimiento, ejecución y verificación del resultado.
4. **Agregar una base de datos** para usuarios, asociación teléfono–wallet, permisos y transacciones.
5. **Conectar SMS bidireccional** mediante un endpoint HTTPS público.
6. **Implementar pocos comandos claros:** `PAGAR`, `CONFIRMAR`, `ESTADO` y `AYUDA`.

Ejemplo de interacción propuesta:

```text
Usuario: PAGAR 5 A ANA

Sistema: Enviarás 5 [moneda] a Ana.
Responde CONFIRMAR 7421.

Usuario: CONFIRMAR 7421

Sistema: Pago completado. Referencia: TX-1042.
```

Usaría una confirmación de un solo uso, caducidad, límites por operación y protección contra mensajes duplicados. También validaría la firma de los webhooks del proveedor de SMS. El número de origen por sí solo no debería ser toda la autenticación.

**No desplegaría Rafiki para el primer prototipo.** Operarlo añade servicios de autorización, bases de datos, liquidez y relaciones entre proveedores. La Test Wallet les permite concentrarse en la experiencia SMS; [Rafiki requiere una infraestructura considerablemente mayor](https://rafiki.dev/integration/deployment/services/backend-service/).

**A qué premio apuntar**

La página publica categorías de premios, sin exigir un stack distinto para cada una. Todos los equipos pueden postularse a todas. Su encaje principal es **Puntored — Premio a la Inclusión**; también pueden defender impacto si identifican una comunidad y una necesidad concreta. [Categorías oficiales](https://interledger.org/es/hackathon/2026-hackathon-medellin/).

Para la demo, mostraría: registro previo → autorización limitada → SMS desde un teléfono básico → pago entre wallets → confirmación de recepción. Añadiría un intento duplicado para demostrar que no cobra dos veces.

Eso se alinea con lo que exige la evaluación: **solicitud, autorización, ejecución y finalización exitosa**, además del repositorio público, demo y presentación. [Entrega y evaluación](https://interledger.org/es/hackathon/submission-judging/).

**Mi recomendación concreta:** construir una aplicación cliente de Open Payments para pagos por SMS, con autorización previa y límites, usando la Test Wallet como infraestructura. Su diferenciador será hacer el pago accesible y confiable desde el teléfono básico.  vamos a hacer algo asi, entonces no dejes tantas cosas que no vamos a usar, hagamos el backend en un SDK simple y sencillo, depende del lenguaje que permita usar openpayments, investiga y me dices cual
```

## Team answers to the clarifying questions

- **Cleanup scope:** "I would remove roughly everything and leave the project virgin."
- **Starting point:** "Skeleton + kit only" (delete Next.js, `src/`, `prisma/`, `tests/`, `docs/`,
  Docker and configs; keep git, the local agent kit, `AI_USAGE.md`, `prompts/`, `.gitignore` and
  `README`; recreate `package.json`).
- **Backend framework:** "Decide later".

## Outcome (what the AI did)

- Researched the official Open Payments SDKs: **Node.js/TypeScript** (`@interledger/open-payments`)
  and **PHP** (`interledger/open-payments-php`). Recommended **Node.js + TypeScript**.
- Removed the application code and left the skeleton described above.
