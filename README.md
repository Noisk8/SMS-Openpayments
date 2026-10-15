# SMS-Openpayments

Pagos por SMS en Colombia mediante Interledger y Open Payments. Una persona crea su cuenta con el celular,
envía dinero y consulta su saldo escribiendo mensajes de texto, sin apps ni conexión a internet.

## Comandos SMS

| Comando | Ejemplo | Función |
|---|---|---|
| `CREAR <alias>` | `CREAR carlos` | Inicia el alta y envía un código de 6 dígitos |
| `CONFIRMAR <código>` | `CONFIRMAR 123456` | Verifica el número y activa la billetera |
| `ENVIAR <monto> <teléfono>` | `ENVIAR 20000 3109876543` | Transfiere dinero a otro número registrado |
| `SALDO` | `SALDO` | Devuelve el saldo disponible |
| `AYUDA` | `AYUDA` | Lista los comandos |

## Estructura del proyecto

```mermaid
flowchart TD
    ROOT["SMS-Openpayments/"]
    ROOT --> APP["src/app<br/>páginas y route handlers"]
    ROOT --> COMP["src/components<br/>formularios y landing"]
    ROOT --> LIB["src/lib<br/>lógica de la aplicación"]
    ROOT --> PRISMA["prisma<br/>esquema y migraciones"]
    ROOT --> TESTS["tests<br/>pruebas Vitest"]
    ROOT --> DOCS["docs<br/>arquitectura, seguridad y despliegue"]
    ROOT --> SCRIPTS["scripts<br/>utilidades de desarrollo"]
    ROOT --> INFRA["Dockerfile<br/>compose.yaml<br/>.env.example"]

    APP --> API["api/<br/>webhooks, cuentas, pagos, salud"]
    APP --> PAGES["accounts · payments · balance<br/>simulator · landing"]
    LIB --> ACC["accounts<br/>alta y verificación"]
    LIB --> TRF["transfers<br/>enviar dinero"]
    LIB --> BAL["balances<br/>saldo desde el libro"]
    LIB --> SMS["sms<br/>comandos y proveedores"]
    LIB --> PAY["payments<br/>mock y Open Payments"]
    LIB --> SEC["auth · crypto · rate-limit"]
    LIB --> DB["db<br/>cliente Prisma"]
```

## Flujo de datos

Todos los canales llaman a las mismas funciones de aplicación. La lógica de pagos vive en un único
sitio, así que una transferencia produce el mismo resultado venga por web o por SMS.

```mermaid
flowchart LR
    subgraph Canales
        WEB["Web<br/>formularios"]
        WH["Webhook SMS<br/>Twilio, genérico"]
        SIM["Simulador<br/>solo desarrollo"]
    end

    subgraph Aplicacion["Aplicación"]
        CMD["handleIncomingSms<br/>deduplica y parsea"]
        ACC["crearCuenta<br/>confirmarCuenta"]
        TRF["enviarDinero"]
        BAL["verSaldo"]
    end

    subgraph Infraestructura
        SMSP["Proveedor SMS<br/>mock · twilio · generic"]
        PAYP["Proveedor de pagos<br/>mock · openpayments"]
        DB[("PostgreSQL<br/>usuarios, libro contable,<br/>mensajes, códigos")]
    end

    WEB --> ACC
    WEB --> TRF
    WEB --> BAL
    WH --> CMD
    SIM --> CMD
    CMD --> ACC
    CMD --> TRF
    CMD --> BAL

    ACC --> SMSP
    CMD -->|respuesta| SMSP
    TRF --> PAYP
    ACC --> DB
    TRF --> DB
    BAL --> DB
    CMD --> DB
    PAYP --> DB
```

### Recorrido de un SMS entrante

```mermaid
sequenceDiagram
    autonumber
    participant U as Persona (celular)
    participant P as Proveedor SMS
    participant W as Webhook
    participant H as handleIncomingSms
    participant DB as PostgreSQL

    U->>P: Envía "ENVIAR 20000 3109876543"
    P->>W: POST con firma del proveedor
    W->>W: Valida la firma
    W->>H: Mensaje normalizado
    H->>DB: Registra el SMS y comprueba duplicados
    H->>H: Interpreta el comando
    H->>DB: Transferencia atómica con bloqueo de billeteras
    H->>P: Envía la respuesta
    P->>U: Confirmación por SMS
```

## Pagos en modo mock

- Cada usuario tiene una billetera. Los saldos **no se guardan**: se calculan sumando `LedgerEntry`.
- Una transferencia bloquea las dos billeteras con `SELECT … FOR UPDATE`, comprueba el saldo, escribe
  un débito y un crédito del mismo importe y marca la operación como completada.
- La clave de idempotencia es única: un reintento devuelve la operación original.

Más detalle en [`docs/architecture.md`](docs/architecture.md).

## Ejecutar en local

Requisitos: Node.js 22 y Docker (opcional, para PostgreSQL).

```bash
cp .env.example .env          # ajusta los valores
npm ci
npm run db:migrate            # aplica las migraciones
npm run dev                   # http://localhost:3000
```

Pruebas y calidad:

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

## Despliegue

Con Docker Compose o Coolify: ver [`docs/deployment.md`](docs/deployment.md). El stack tiene tres
servicios: `db` (PostgreSQL), `migrate` (aplica migraciones y termina) y `app` (la aplicación).

## Documentación

- [`docs/architecture.md`](docs/architecture.md): capas, flujo de SMS y modelo de datos.
- [`docs/openpayments.md`](docs/openpayments.md): integración con Open Payments.
- [`docs/sms-providers.md`](docs/sms-providers.md): proveedores SMS y su estado.
- [`docs/security.md`](docs/security.md): controles de seguridad.
- [`docs/deployment.md`](docs/deployment.md): despliegue en producción.
