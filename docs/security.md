# Seguridad

## Principios

- Ninguna operación de dinero se autoriza solo porque el webhook informa un número de origen.
  El número identifica una cuenta candidata. La operación exige una sesión o una verificación.
- Las operaciones reciben `AuthorizationContext` construido por el canal (sesión web o SMS verificado),
  nunca un número libre enviado por el cliente.
- Los secretos se cifran (AES-256-GCM). Las claves de usuario se guardan con Argon2id.
- Los errores no muestran trazas ni detalles internos (`src/lib/http/responses.ts`).

## Medidas implementadas

| Medida | Dónde |
|---|---|
| Validación estricta (Zod + normalización E.164) | `src/lib/validation` |
| Importes en enteros (BigInt), sin punto flotante | `src/lib/validation/money.ts` |
| Límite por transferencia | `MAX_TRANSFER_MINOR` |
| Idempotencia (clave única en `Transaction`) | `src/lib/transfers/send-money.ts` |
| Deduplicación de SMS (proveedor + id) | `SmsMessage`, `src/lib/sms/command-handler.ts` |
| Sin saldos negativos: bloqueo de filas y comprobación en la misma transacción | `src/lib/payments/providers/mock.ts` |
| Doble entrada: suma cero por transacción | `LedgerEntry` |
| Firma de webhooks: Twilio (`X-Twilio-Signature`), genérico (HMAC) | `src/lib/sms/providers` |
| Webhook rechazado si el proveedor no es el activo o no tiene recepción verificada | `src/lib/sms/webhook.ts` |
| Sesión web firmada (HMAC), `HttpOnly`, `SameSite=Strict`, `Secure` en producción | `src/lib/auth/session.ts` |
| Verificación del celular con código de un solo uso y caducidad de 10 minutos | `src/lib/accounts` |
| Límite de intentos del código (5) y de inicio de sesión | `src/lib/context.ts` |
| Protección anti-SSRF en URLs de proveedores | `src/lib/sms/http-safety.ts` |
| Simulador deshabilitado en producción (ruta y página) | `src/lib/dev/simulator-guard.ts` |
| Auditoría: transacciones, movimientos y SMS registrados con cuerpo cifrado | Tablas `Transaction`, `LedgerEntry`, `SmsMessage` |
| Secretos fuera de la API pública (respuestas de cuenta probadas) | `tests/accounts.test.ts` |

## Amenazas consideradas

| Amenaza | Mitigación | Riesgo residual |
|---|---|---|
| Suplantación de número / SMS spoofing | Código de verificación para el alta; el envío por SMS en modo real debe ir acompañado de un segundo factor | Alto en SMS sin segundo factor: el operador entrega el origen |
| SIM swapping | Ninguna mitigación técnica en la app | **Alto**. Recomendado: segundo factor (clave) para importes altos |
| Reenvío de un SMS legítimo | Idempotencia por identificador del mensaje | Bajo |
| Reutilización de webhooks | Firma por petición y deduplicación por id | Bajo |
| Transferencias duplicadas | Clave de idempotencia única y deduplicación de SMS | Bajo |
| Acceso a saldos ajenos | `verSaldo` exige que el titular del contexto coincida con el teléfono | Bajo |
| Robo de claves privadas | Cifrado en reposo; no se devuelven por la API; fichero fuera del repo | Medio: depende de la custodia de `ENCRYPTION_KEY` y del fichero de clave |
| Manipulación de importes | Importes validados como enteros y límite máximo | Bajo |
| Condiciones de carrera | Bloqueo `FOR UPDATE` y prueba de concurrencia (TEST 13) | Bajo |
| Fuerza bruta de códigos o claves | Límites de intentos y de frecuencia (en memoria) | Medio con varias réplicas: el límite no se comparte |
| SSRF desde el proveedor genérico | Solo HTTPS, sin IPs privadas, sin redirecciones | Medio: no se resuelve DNS para bloquear rebinding |

## Limitaciones que deben resolverse antes de producción

1. **Segundo factor para pagos reales por SMS.** Hoy el SMS con origen verificado basta en modo mock.
   En modo real debe exigirse una clave o un consentimiento adicional según el importe.
2. **Límites en memoria.** Con varias instancias, usar un almacén compartido.
3. **Verificación del `hash` del callback de Open Payments.** Pendiente.
4. **Rotación de `ENCRYPTION_KEY`.** No está implementada. Los datos cifrados con `v1` necesitan una
   estrategia de re-cifrado si se cambia la clave.
5. **Retención de SMS.** La función `purgeOldSmsMessages` existe, pero debe programarse (cron del
   despliegue) con el plazo que defina el responsable de datos.
6. **Política de sesión y clave.** La clave es opcional en el alta; para la web se recomienda exigirla.
7. **Vulnerabilidades de dependencias.** `npm audit` reporta avisos en dependencias transitivas que
   deben revisarse antes de producción.

## Datos personales

Se guardan teléfono, alias y el cuerpo cifrado de los SMS. Los mensajes de verificación se registran sin
el código. Antes de operar en Colombia, revisa el tratamiento de datos con el responsable legal
(Ley 1581 de 2012) y la retención definida.
