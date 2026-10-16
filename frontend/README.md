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

## Chasky: login y dashboard

Abre `/login` para entrar con un número registrado, activo y previamente verificado.
El backend envía un código de seis dígitos al teléfono mediante el proveedor SMS
configurado; el código vence a los cinco minutos y permite cinco intentos.
No se crean cuentas ni billeteras al solicitar acceso. El alta continúa en `/accounts`
mediante el flujo SMS existente. En desarrollo con `SMS_PROVIDER=mock`, el SMS aparece
en el outbox del backend (`GET /dev/sms/outbox`); no se envía a un teléfono real.

`/dashboard` muestra datos del titular de la sesión: cuenta, billeteras, autorizaciones
y hasta 25 movimientos enviados o recibidos. Open Payments consulta el presupuesto restante del grant a través del proveedor.
Cuando el proveedor no lo expone, se muestra como no disponible, sin inventar un saldo.
Los botones de pago mantienen el canal SMS y sus confirmaciones existentes.

Las rutas Next.js `/api/customer/*` actúan como puente hacia `BACKEND_URL`. Guardan
la sesión en una cookie HttpOnly, SameSite=Lax y Secure en producción. No se necesitan
credenciales administrativas en el navegador. Configura `FRONTEND_ORIGIN` con el origen
HTTPS exacto del frontend en producción para validar las solicitudes POST.
En Railway el frontend es un servicio separado del backend.

El backend aplica automáticamente la migración `005_customer_login.sql` al arrancar.
Las sesiones duran ocho horas y se revocan al cerrar sesión. Los códigos y tokens se
guardan como hashes. Las solicitudes se limitan por teléfono (una por minuto, cinco
por hora) y por IP del cliente que conecta al backend (20 por hora). Si se utiliza
el puente Next.js, esa IP corresponde al servidor Next.js; se mantiene un límite
compartido conservador y no se confía en cabeceras IP arbitrarias del navegador.

### Contraseña opcional de pruebas

Con `TEST_PASSWORD_LOGIN_ENABLED=true`, `NODE_ENV=development` y `SMS_PROVIDER=mock`
en el backend, `/login` permite elegir «Contraseña de prueba». Está deshabilitada por
defecto y no funciona en producción ni con un transporte SMS externo. Una sesión de prueba puede consultar
el dashboard de una cuenta pendiente, sin verificar el teléfono ni activar pagos.
Al deshabilitar la opción, esas sesiones dejan de ser aceptadas.

Para asignar una contraseña al usuario existente, establece `CHASKY_TEST_PHONE` y
`CHASKY_TEST_PASSWORD` en el entorno del proceso y ejecuta
`npm --prefix backend run user:test-password`. El comando guarda un hash scrypt con
sal aleatoria y revoca las sesiones de prueba anteriores. No imprime la contraseña.

Cuando el backend anuncia la contraseña de prueba, el formulario la selecciona por
defecto. La base configurada en `backend/.env` debe ser la misma en que se registró
el usuario. Para trabajar en la interfaz sobre una base compartida se puede usar
`JOB_WORKER_ENABLED=false`: el servidor atiende login y dashboard sin procesar trabajos
de pagos. Su valor predeterminado es `true`. La clave privada del cliente Open Payments
se lee al usar el proveedor, de modo que un archivo de firma ausente no bloquea el login;
los pagos siguen requiriendo una clave válida del cliente y la autorización del titular.

### Ingresos recibidos directamente en la wallet

El dashboard combina movimientos del backend con recursos incoming-payment de Open
Payments cuando el titular conecta el historial. El botón solicita únicamente
`incoming-payment: list-all, read-all`, identificado por la wallet del usuario.
El titular completa la autorización en otra pestaña y vuelve para actualizar.
Los tokens de continuación y acceso se cifran en PostgreSQL con ENCRYPTION_KEY;
el cliente de lectura usa su propia clave local fuera de Git y no modifica el cliente
que firma pagos salientes. Configura OP_HISTORY_WALLET_ADDRESS, OP_HISTORY_KEY_ID y
OP_HISTORY_PRIVATE_KEY_PATH en el backend. Esta configuración limita la consulta a
esa wallet, y cada ruta verifica además el titular de la sesión.

Sin consentimiento se muestran solo movimientos locales, con un aviso explícito.
Al consultar la wallet se omiten recursos cuyo recibido sea cero y se evita duplicar
pagos ya registrados por su incoming_payment_id. Se consulta una página de hasta 100
recursos y se muestran los últimos 25 movimientos disponibles; se avisa si existe más
historial. Un recurso entrante puede agregar varios abonos y su fecha es la de creación
del recurso. No es un extracto bancario ni una consulta del saldo de la wallet.

### Saldo real de Test Wallet

El SDK Open Payments no expone el saldo de la cuenta. La aplicación Test Wallet
consulta su saldo a través de su backend autenticado, ligado a una sesión de titular.
El permiso incoming-payment usado para los movimientos no autoriza esa API privada.
La pantalla distingue entre presupuesto autorizado y saldo, y ofrece abrir Test Wallet
cuando no existe una fuente de saldo. No se obtiene el saldo sumando los ingresos:
podrían faltar salidas, depósitos, comisiones o fondos retenidos. Para integrar el saldo
real en Chasky falta un endpoint del proveedor y su autenticación de lectura autorizada.
