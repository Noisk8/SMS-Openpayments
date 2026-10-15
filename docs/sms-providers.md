# Proveedores SMS

Cada proveedor implementa `SmsProvider` (`src/lib/sms/types.ts`):

```ts
interface SmsProvider {
  readonly name: string;
  readonly capabilities: { send: boolean; receive: boolean };
  sendSms(input: { to: string; body: string }): Promise<SendSmsResult>;
  parseIncoming(request: Request, rawBody: string): Promise<IncomingSms>;
  validateWebhook(request: Request, rawBody: string): Promise<boolean>;
}
```

El cuerpo del webhook se lee una sola vez y se pasa a `validateWebhook` y `parseIncoming`.

## Resumen de capacidades

| Proveedor | Envío | Recepción | Fuente |
|---|---|---|---|
| Mock | Sí (bandeja simulada) | Simulador | — |
| Twilio | Sí | Sí, firma `X-Twilio-Signature` | SDK oficial `twilio` |
| Onurix | Sí | **No** (pendiente) | docs.onurix.com/sms/send_sms |
| Inalambria | Sí | **No** (pendiente) | docs.inalambria.com (`/token`, `/mtmessage`) |
| Genérico | Sí (contrato propio) | Sí, firma HMAC-SHA256 | Contrato definido en el código |

Un webhook de un proveedor **que no es el activo** responde 404. Un webhook de un proveedor sin
recepción responde 501. Ninguno procesa mensajes sin firma válida.

## Twilio

Variables: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`.

1. Crea una cuenta en Twilio y obtén el Account SID y el Auth Token.
2. Compra o activa un número con capacidad SMS. Para Colombia, verifica con Twilio que el número y el
   tipo de envío estén habilitados: la disponibilidad depende del país y del operador.
3. En la configuración del número, define el webhook de mensajes entrantes como
   `POST https://TU_DOMINIO/api/webhooks/sms/twilio`.
4. `APP_URL` debe ser exactamente el dominio público con HTTPS: la firma se calcula sobre esa URL.

Comportamiento: se rechaza cualquier petición sin firma válida (401). Un mismo `MessageSid` se procesa
una sola vez.

## Onurix

Variables: `ONURIX_API_KEY`, `ONURIX_CLIENT_ID`.

- **Envío (implementado):** `POST https://www.onurix.com/api/v1/sms/send` con formulario
  `client`, `key`, `phone` (sin `+`) y `sms`. Según la documentación pública, la respuesta 200 incluye
  `id`. Se acepta como éxito solo si hay `id`.
- **Recepción (pendiente):** la documentación pública de webhooks de Onurix describe WhatsApp. La
  recepción de SMS de doble vía se habilita por soporte (códigos de error 1055/1056). Hasta tener esa
  especificación, el webhook responde 501.
- Antes de producción, el envío debe probarse con una cuenta real y la IP del servidor autorizada
  en el portal de Onurix.

## Inalambria

Variables: `INALAMBRIA_USER`, `INALAMBRIA_PASSWORD`.

- **Envío (implementado):** `POST https://rest.inalambria.com/token` con Basic (usuario:contraseña) y
  `{"grant_type":"password"}`; luego `POST /mtmessage` con `Authorization: Bearer`, `Type: 1`,
  `MessageText` y `Devices` (número sin `+`, 12 dígitos para Colombia). El éxito es `Status: 0`.
  El token se cachea hasta su vencimiento.
- **Recepción (pendiente):** la documentación consultada describe SMS de salida por REST. La
  recepción de respuestas usa código corto (`/momessage` para envío) o SMPP en modo Receiver; no hay
  un webhook REST de entrada documentado en lo revisado.
- No se usa la API *Inalambria Express*: es un producto distinto con otra autenticación.

## Proveedor genérico

Variables: `GENERIC_SMS_API_URL`, `GENERIC_SMS_API_KEY`, `GENERIC_SMS_WEBHOOK_SECRET`.

Contrato fijo (se configura con variables, no con expresiones):

- **Envío:** `POST GENERIC_SMS_API_URL`, cabecera `Authorization: Bearer <KEY>`, cuerpo JSON
  `{"to": "+57…", "text": "…"}`. Respuesta con `id`.
- **Recepción:** el proveedor envía `POST` con JSON `{"id","from","to","text"}` y la cabecera
  `X-Signature` con el HMAC-SHA256 en hexadecimal del cuerpo crudo.

Seguridad: la URL solo puede ser HTTPS (HTTP solo en localhost fuera de producción), no puede apuntar a
direcciones privadas o de metadatos, y las redirecciones están desactivadas. Sin
`GENERIC_SMS_WEBHOOK_SECRET` el proveedor no arranca.

## Añadir un proveedor

1. Crea `src/lib/sms/providers/<nombre>.ts` implementando `SmsProvider`.
2. Usa `requireEnv(env, [...], "<nombre>")` para validar sus variables en el constructor.
3. Implementa `sendSms` devolviendo `{ success, messageId?, error? }` sin lanzar errores de red.
4. Implementa `validateWebhook` con verificación criptográfica. Si no está verificada, devuelve `false`.
   Nunca devuelvas `true` por defecto.
5. Implementa `parseIncoming` normalizando el teléfono con `normalizeColombianPhone`.
6. Declara `capabilities` honestamente. Una capacidad no implementada debe lanzar un error claro.
7. Regístralo en `src/lib/sms/provider-factory.ts` y en el `switch` de `SMS_PROVIDER`.
8. Añade sus variables a `src/lib/config/env.ts` y `.env.example`.
9. Crea una ruta `src/app/api/webhooks/sms/<nombre>/route.ts` que llame a `receiveSmsWebhook`.
10. Añade pruebas contractuales en `tests/webhooks.test.ts` (firma válida, inválida y duplicado).
