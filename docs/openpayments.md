# Open Payments

## Estado

Implementado con el SDK oficial `@interledger/open-payments` **v7.4.0**. Las firmas se verificaron
contra los tipos instalados (`node_modules/@interledger/open-payments/dist`).

**No probado contra la red real.** Para probarlo hacen falta una wallet address de la aplicación, una
clave Ed25519 registrada y cuentas de usuario en un proveedor compatible. Ninguna de estas credenciales
está configurada en este repositorio. Hasta entonces, la prueba de integración externa figura como
**pendiente**.

## Separación de conceptos

| Concepto | Qué es | Dónde vive |
|---|---|---|
| A. Identidad de la aplicación | La wallet address y la clave de **la aplicación** (cliente Open Payments) | Variables `OPENPAYMENTS_*`, fichero de clave fuera del repo |
| B. Claves de autenticación | Par Ed25519 con el que la aplicación firma sus peticiones | Un único par para toda la aplicación |
| C. Billetera con fondos | La wallet address de cada usuario en su proveedor | Tabla `Wallet` (`provider = "openpayments"`) |

No se genera una clave por usuario: el modelo documentado de Open Payments usa una clave por cliente.
Las claves privadas nunca se devuelven por la API ni se guardan en la base de datos.

## Configuración

```bash
OPENPAYMENTS_CLIENT_WALLET_ADDRESS=https://ilp.example.com/mi-app
OPENPAYMENTS_KEY_ID=<id de la clave registrada>
OPENPAYMENTS_PRIVATE_KEY_PATH=/ruta/segura/private-key.json
PAYMENT_PROVIDER=openpayments
```

Para generar el par de claves y registrar la pública en tu wallet address, usa la guía oficial:
https://openpayments.dev/guides/ (sección de claves). El fichero de clave privada debe estar fuera del
repositorio (`.gitignore` ya excluye `*.pem` y `keys/`).

En modo Open Payments, `crearCuenta` exige una `walletAddress` existente del usuario. La aplicación
**no inventa endpoints de creación de billeteras**: si el proveedor no ofrece una API documentada
para crearlas, el usuario indica la suya.

## Flujo implementado (`src/lib/payments/providers/openpayments.ts`)

Para cada `enviarDinero`:

1. Resolver las wallet addresses de origen y destino (`walletAddress.get`).
2. Grant no interactivo en el receptor → `incomingPayment.create`.
3. Grant no interactivo en el origen (`quote`) → `quote.create` con `debitAmount` en la escala del origen.
4. Si existe una autorización `GRANTED` vigente del usuario para esa billetera, se usa su token.
5. Si no existe, se solicita un **interactive grant** para `outgoing-payment` con el límite del quote:
   - la transacción queda `REQUIRES_AUTHORIZATION`,
   - se devuelve la URL de consentimiento (`interact.redirect`),
   - el token de continuación se guarda cifrado.
6. Tras el consentimiento, el usuario vuelve a `GET /api/payments/authorizations/{id}/callback?interact_ref=…`.
   La aplicación ejecuta `grant.continue`, guarda el token cifrado y completa el pago.
7. `outgoingPayment.create` → `outgoingPayment.get`. El estado es:
   - `COMPLETED` si `sentAmount` iguala a `debitAmount`,
   - `FAILED` si `failed` es verdadero,
   - `PROCESSING` en otro caso.

Nunca se marca un pago como exitoso solo porque se envió la petición.

## Límites conocidos

- **Verificación del `hash` del callback:** no implementada todavía. La seguridad del paso depende de que
  el token solo se emita tras `grant.continue` con un `interact_ref` válido y de que el callback exija
  una sesión del titular de la autorización. Debe añadirse antes de producción.
- **Saldo:** `verSaldo` devuelve `BALANCE_NOT_SUPPORTED`. Open Payments no garantiza una API de saldo.
- **Pagos futuros:** la autorización se reutiliza mientras no venza ni se revoque. El límite del grant
  lo aplica el Authorization Server; la aplicación no lleva un contador local.
- **Consulta de estado posterior:** el estado se determina en el momento del pago. Un pago que quede
  en curso más tarde no se actualiza todavía automáticamente.

## Prueba con la wallet de pruebas (pendiente)

1. Crea una cuenta en https://wallet.interledger-test.dev/ y anota su wallet address.
2. Genera el par de claves y regístralo según la guía de Open Payments.
3. Configura las variables anteriores y `PAYMENT_PROVIDER=openpayments`.
4. Registra en la aplicación la wallet del usuario (`CREAR` o la web con `walletAddress`).
5. Envía un importe pequeño: deberías recibir `REQUIRES_AUTHORIZATION` y una URL de consentimiento.
6. Completa el consentimiento y comprueba que el pago pasa a `COMPLETED`.

Cuando esto se pruebe, actualiza esta sección con la fecha y el resultado.
