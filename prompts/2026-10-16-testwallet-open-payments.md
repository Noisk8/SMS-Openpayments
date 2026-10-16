# Prompts reales — Test Wallet, Open Payments y Twilio

Sesión con OpenCode (modelo claude-haiku-5-5). Se registran los mensajes del usuario tal como se
enviaron, en orden.

## 1. Análisis de axios

> analiza el proyecto  axios  o cualme recomiendas?analiza el proyecto que debo de utilizar  axios  o cualme recomiendas?

## 2. Revisión de Rafiki antes de subir

> bueno entoonces sube los cambios a ggiithub pero antes alnaliza que todo está bien con el tema de lo de rafiki

## 3. Subir Rafiki a main

> necesito que subas todo lo de rafiki a main soluciona los conflictos y subelo

## 4. Configurar según el modelo del equipo

> necesito que configures esto de manera que sea coherente con  el modelo que hay en el codigo ddel proyecto Código custodial de Rafiki (feat/rafiki-integration, ac1cf37): contradice el modelo del equipo que elegiste. Para subirlo a main habría que portarlo a Postgres y a la interfaz PaymentProvider, resolver 12 conflictos y cambiar la especificación. Lo dejé en tu máquina sin tocar main.
> - Adaptador de Twilio: va junto al código custodial. Tampoco está en main.
> - infra/rafiki/compose.yaml y scripts de setup/smoke: son del modelo custodial. El compose además referencia un servicio rafiki-auth que no define.

## 5. Aclaración de entorno

> recuerda que esto es con wallets de test
