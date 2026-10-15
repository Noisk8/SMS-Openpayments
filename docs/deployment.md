# Despliegue

## Requisitos

- Dominio público con HTTPS (Twilio y los demás webhooks exigen una URL accesible desde Internet).
- Docker y Docker Compose, o Coolify.
- `ENCRYPTION_KEY` generada con `openssl rand -base64 32` y guardada fuera del repositorio.

## Docker Compose

```bash
cp .env.example .env
# Edita: POSTGRES_PASSWORD, ENCRYPTION_KEY, APP_URL=https://tu-dominio, PAYMENT_PROVIDER, SMS_PROVIDER y credenciales
docker compose up -d --build
```

Servicios:

- `db`: PostgreSQL 17. **No publica puertos al host**; solo es accesible dentro de la red de compose.
  Los datos están en el volumen `pgdata`.
- `migrate`: aplica `prisma migrate deploy` y termina. La app arranca solo si termina bien.
- `app`: Next.js en modo standalone, puerto `APP_PORT` (por defecto 3000), usuario no root,
  healthcheck en `/api/health`.

Comprobación:

```bash
curl -s http://localhost:3000/api/health   # {"status":"ok"}
```

Al desplegar, `NODE_ENV=production` y `SMS_SIMULATOR_ENABLED=false` impiden el simulador y el seed.

> La imagen **no se ha construido en el entorno donde se desarrolló esta aplicación** (Docker no estaba
> instalado). Construye y prueba la imagen antes de dar el servicio por operativo.

## Coolify

1. **Nuevo recurso** → *Docker Compose* → conecta el repositorio.
2. Coolify leerá `compose.yaml`. Define en *Environment Variables* al menos:
   - `POSTGRES_PASSWORD` (fuerte, único),
   - `ENCRYPTION_KEY`,
   - `APP_URL` = URL pública del servicio `app`,
   - `PAYMENT_PROVIDER`, `SMS_PROVIDER` y sus credenciales.
3. En el servicio `app`, asigna el dominio y activa HTTPS (Let's Encrypt en Coolify).
4. Verifica que el servicio `db` no tiene dominio ni puerto público.
5. Despliega. Revisa los logs de `migrate` (debe terminar con éxito) y luego de `app`.
6. Si usas Twilio, configura el webhook de mensajes entrantes como
   `https://TU_DOMINIO/api/webhooks/sms/twilio`.

## Variables que no deben faltar en producción

| Variable | Motivo |
|---|---|
| `NODE_ENV=production` | Desactiva simulador, seed y cookies no seguras |
| `ENCRYPTION_KEY` | Sin ella no se pueden guardar ni leer secretos |
| `APP_URL` | Base de las firmas de webhooks y del callback de Open Payments |
| `SMS_SIMULATOR_ENABLED=false` | Refuerzo adicional |

## Operación

- **Copias de seguridad:** haz copia del volumen `pgdata` y de `ENCRYPTION_KEY` (sin la clave, los datos
  cifrados no son recuperables).
- **Retención de SMS:** programa `purgeOldSmsMessages(…, días)` desde un trabajo periódico.
- **Migraciones:** se aplican en cada despliegue con el servicio `migrate`.
- **Actualizaciones de dependencias:** revisa `npm audit` antes de cada release.
