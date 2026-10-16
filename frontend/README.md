# Frontend recuperado — SMS Pagos

Se recuperó el diseño de Next.js del commit `982ae5e`: portada, CSS, iconos,
animaciones, carruseles y conversación SMS ilustrativa. Las páginas Cuenta,
Enviar dinero y Saldo conservan el estilo y preparan comandos del backend actual.
No se recuperaron Prisma, el backend antiguo ni sus APIs de sesiones web.

```sh
npm ci --prefix frontend
npm run dev:frontend       # desde la raíz; http://localhost:3005
npm run build:frontend
```

Copiar `frontend/.env.example` a `frontend/.env.local` si se necesita configurar:

- `NEXT_PUBLIC_SMS_NUMBER`: número real del proyecto, en E.164. Habilita los
  enlaces para abrir la aplicación de SMS con el comando preparado. No es un secreto.
- `BACKEND_URL`: dirección privada del backend para el simulador de desarrollo.
  Por defecto, `http://127.0.0.1:3000`.

`/simulator` usa el simulador del backend Fastify, no una segunda lógica de pagos.
Solo está disponible en desarrollo; en producción devuelve 404. Las páginas
públicas no exponen credenciales administrativas ni consultan saldos por un
número arbitrario: la identidad se verifica mediante el canal SMS.

Para desplegar la interfaz, crear un servicio separado con Root Directory
`frontend/`, build `npm ci && npm run build` y start `npm start -- --hostname 0.0.0.0`.
El puerto local del script es 3005; en Railway establecer el comando de arranque
`npx next start --hostname 0.0.0.0 --port $PORT`. El dominio del webhook sigue
apuntando al servicio backend, no al frontend.
