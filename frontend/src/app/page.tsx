import Link from "next/link";
import type { ReactNode } from "react";
import { HorizontalScroll } from "@/components/landing/horizontal-scroll";
import {
  BoltIcon,
  CheckIcon,
  ClockIcon,
  GlobeIcon,
  LayersIcon,
  MessageIcon,
  PhoneIcon,
  SendIcon,
  ShieldIcon,
  StoreIcon,
  UsersIcon,
  WalletIcon,
  WifiOffIcon,
} from "@/components/landing/icons";
import { PhoneDemo } from "@/components/landing/phone-demo";
import { Reveal } from "@/components/landing/reveal";
import { ScrollChrome } from "@/components/landing/scroll-chrome";

type IconComponent = (props: { className?: string }) => ReactNode;

type Item = { title: string; text: string; Icon: IconComponent };

const SECTIONS = [
  { id: "inicio", label: "Inicio" },
  { id: "como-funciona", label: "Cómo funciona" },
  { id: "demo", label: "Demo" },
  { id: "sin-conexion", label: "Sin conexión" },
  { id: "alcance", label: "Alcance" },
  { id: "arquitectura", label: "Canales" },
  { id: "empezar", label: "Empezar" },
];

const COMMANDS = [
  { code: "CREAR CUENTA", label: "Crea tu cuenta" },
  { code: "VERIFICAR 123456", label: "Verifica tu número" },
  { code: "PAGAR 20000 A +573109876543", label: "Envía dinero" },
  { code: "SALDO", label: "Consulta tu saldo" },
  { code: "AYUDA", label: "Lista los comandos" },
];

const BENEFITS = [
  "Sin datos móviles",
  "Funciona con señal 2G",
  "Nada que instalar",
  "Reintentos sin duplicar",
  "Cualquier celular",
  "Llega cuando vuelve la red",
];

const STEPS: (Item & { code: string })[] = [
  {
    title: "Crea tu cuenta",
    text: "Escribe CREAR CUENTA desde tu celular. Te enviamos un código de 6 dígitos.",
    code: "CREAR CUENTA",
    Icon: PhoneIcon,
  },
  {
    title: "Confirma tu número",
    text: "El código confirma que el celular es tuyo y activa tu billetera. Tiene caducidad e intentos limitados.",
    code: "VERIFICAR 123456",
    Icon: MessageIcon,
  },
  {
    title: "Envía dinero",
    text: "Solo necesitas el monto y el número de destino. Recibirás una cotización y un código para confirmar el pago.",
    code: "PAGAR 20000 A +573109876543",
    Icon: SendIcon,
  },
  {
    title: "Consulta tu saldo",
    text: "SALDO devuelve tu balance en cualquier momento, desde cualquier celular, sin abrir una app.",
    code: "SALDO",
    Icon: WalletIcon,
  },
];

const OFFLINE_REASONS: Item[] = [
  {
    title: "Cero datos móviles",
    text: "El SMS viaja por la red del operador. No necesitas plan de datos, WiFi ni cobertura de internet para pagar.",
    Icon: WifiOffIcon,
  },
  {
    title: "Funciona con señal 2G",
    text: "Un mensaje de texto entra donde una aplicación no alcanza a cargar. La red mínima basta para mover dinero.",
    Icon: GlobeIcon,
  },
  {
    title: "Nada que instalar",
    text: "Cualquier celular, incluso los básicos, participa desde el primer mensaje. Sin tiendas, descargas ni actualizaciones.",
    Icon: PhoneIcon,
  },
  {
    title: "Llega cuando vuelve la red",
    text: "Si la cobertura falla, el operador encola el mensaje y lo entrega después. La app lo procesa al llegar.",
    Icon: ClockIcon,
  },
  {
    title: "Reintentos sin duplicar",
    text: "Cada SMS se identifica por su id y una clave de idempotencia evita que un mismo pago se aplique dos veces.",
    Icon: ShieldIcon,
  },
];

const ADOPTION: Item[] = [
  {
    title: "Sin curva de aprendizaje",
    text: "Si ya sabes mandar un SMS, ya sabes usar la app. El gesto es el mismo de siempre: escribir y enviar.",
    Icon: MessageIcon,
  },
  {
    title: "Sin hardware ni megas",
    text: "No hay datáfono que comprar ni datos que consumir. Eso baja la barrera de entrada para quien empieza.",
    Icon: StoreIcon,
  },
  {
    title: "Misma lógica en todos los canales",
    text: "Web y SMS aplican las mismas reglas: un pago es un pago, venga por donde venga.",
    Icon: UsersIcon,
  },
];

const REACH: Item[] = [
  {
    title: "Personas sin cuenta bancaria",
    text: "El celular es la billetera. El número de teléfono identifica a la persona: no hace falta tarjeta ni sucursal.",
    Icon: UsersIcon,
  },
  {
    title: "Veredas y zonas rurales",
    text: "Donde el internet llega a ratos, el pago entra por la señal de voz y texto que sí suele existir.",
    Icon: GlobeIcon,
  },
  {
    title: "Comercios de barrio",
    text: "Recibir la confirmación por mensaje permite vender sin depender de datáfonos ni de una conexión permanente.",
    Icon: StoreIcon,
  },
  {
    title: "Envíos a la familia",
    text: "Enviar dinero es escribir un mensaje a un número conocido, sin apps ni intermediarios nuevos.",
    Icon: SendIcon,
  },
];

const CHANNELS: Item[] = [
  {
    title: "Web",
    text: "Formularios para crear cuenta, enviar dinero y consultar saldo con sesión iniciada.",
    Icon: LayersIcon,
  },
  {
    title: "SMS",
    text: "Comandos de texto entrantes por webhook, con validación de firma y respuesta registrada.",
    Icon: MessageIcon,
  },
  {
    title: "Simulador",
    text: "Bandeja de desarrollo que usa el mismo procesador que los proveedores reales, sin enviar mensajes.",
    Icon: BoltIcon,
  },
];

const GUARANTEES: Item[] = [
  {
    title: "Transacciones atómicas",
    text: "Débito y crédito en la misma operación, con bloqueo de billeteras. El saldo nunca queda en negativo.",
    Icon: ShieldIcon,
  },
  {
    title: "Idempotencia real",
    text: "Un mensaje duplicado o un reintento devuelven la operación original en lugar de ejecutar el pago otra vez.",
    Icon: CheckIcon,
  },
  {
    title: "Preparado para Interledger",
    text: "El proveedor de pagos es intercambiable: modo demo hoy y Open Payments para billeteras externas con credenciales.",
    Icon: GlobeIcon,
  },
];

const container = "mx-auto w-full max-w-6xl px-5 sm:px-8";
const sectionBase = `${container} scroll-mt-24 py-20 sm:py-28`;
const bleed = "relative left-1/2 -mb-8 -mt-8 w-screen -translate-x-1/2 overflow-x-clip";
const eyebrow = "text-xs font-semibold uppercase tracking-[0.2em]";
const cardLight = "rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:border-flag-blue/40 hover:shadow-lg";
const cardDark = "rounded-2xl border border-white/10 bg-white/5 p-6 transition hover:border-flag-yellow/50 hover:bg-white/10";
const iconChipLight = "flex h-11 w-11 items-center justify-center rounded-xl bg-flag-blue text-white shadow-sm";

export default function HomePage() {
  return (
    <>
      <ScrollChrome sections={SECTIONS} />

      <div className={bleed}>
        {/* ------------------------------- HERO ------------------------------- */}
        <section id="inicio" className="relative isolate overflow-hidden bg-night-950 text-white">
          <div className="mesh-hero absolute inset-0 -z-10" aria-hidden="true" />
          <div className="grid-lines absolute inset-0 -z-10" aria-hidden="true" />

          <div className={`${container} grid items-center gap-14 pb-32 pt-20 sm:pt-28 lg:grid-cols-2 lg:gap-10`}>
            <div>
              <Reveal>
                <p className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3.5 py-1.5 text-xs font-medium tracking-wide text-flag-yellow backdrop-blur">
                  <span className="h-1.5 w-1.5 rounded-full bg-flag-red" />
                  Colombia · Pagos por SMS
                </p>
              </Reveal>

              <Reveal delay={90}>
                <h1 className="mt-6 text-4xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">
                  El pago que llega <span className="gradient-text">donde no llega internet</span>
                </h1>
              </Reveal>

              <Reveal delay={180}>
                <p className="mt-6 max-w-xl text-base leading-relaxed text-slate-300 sm:text-lg">
                  Crea tu cuenta con el celular, envía dinero y consulta tu saldo con un simple SMS. Sin apps,
                  sin tarjetas y sin plan de datos.
                </p>
              </Reveal>

              <Reveal delay={260}>
                <div className="mt-9 flex flex-wrap items-center gap-3">
                  <Link
                    href="/accounts"
                    className="rounded-full bg-flag-yellow px-6 py-3 text-sm font-semibold text-night-950 shadow-lg shadow-flag-yellow/20 transition hover:brightness-110"
                  >
                    Crear cuenta
                  </Link>
                  <Link
                    href="/payments"
                    className="rounded-full border border-white/20 px-6 py-3 text-sm font-semibold text-white transition hover:border-flag-yellow hover:text-flag-yellow"
                  >
                    Enviar dinero
                  </Link>
                  <a
                    href="#como-funciona"
                    className="rounded-full px-4 py-3 text-sm font-medium text-slate-300 transition hover:text-white"
                  >
                    Cómo funciona ↓
                  </a>
                </div>
              </Reveal>

              <Reveal delay={340}>
                <dl className="mt-12 grid max-w-lg grid-cols-3 gap-4 border-t border-white/10 pt-6">
                  {[
                    ["0 MB", "de datos para pagar"],
                    ["5", "comandos SMS"],
                    ["1", "lógica para web y SMS"],
                  ].map(([value, label]) => (
                    <div key={label}>
                      <dt className="text-2xl font-semibold text-white sm:text-3xl">{value}</dt>
                      <dd className="mt-1 text-xs leading-snug text-slate-400">{label}</dd>
                    </div>
                  ))}
                </dl>
              </Reveal>
            </div>

            <Reveal variant="right" delay={160}>
              <HeroVisual />
            </Reveal>
          </div>

          <div className="flag-stripe absolute inset-x-0 bottom-0 h-1.5" aria-hidden="true" />
        </section>

        {/* ----------------------------- MARQUEES ----------------------------- */}
        <div className="marquee relative overflow-hidden border-b border-white/10 bg-night-950 py-4">
          <ul className="sr-only">
            {COMMANDS.map((command) => (
              <li key={command.code}>
                {command.code}: {command.label}
              </li>
            ))}
          </ul>
          <div className="marquee-track" aria-hidden="true">
            {[0, 1].map((half) => (
              <div key={half} className="flex shrink-0 gap-10 pr-10">
                {COMMANDS.map((command) => (
                  <span key={command.code} className="flex items-center gap-3 whitespace-nowrap text-sm">
                    <code className="rounded-md border border-white/15 bg-white/5 px-2 py-1 font-mono text-flag-yellow">
                      {command.code}
                    </code>
                    <span className="text-slate-400">{command.label}</span>
                    <span className="text-flag-red">●</span>
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>

        <div className="marquee marquee-reverse relative overflow-hidden bg-flag-blue py-3" aria-hidden="true">
          <div className="marquee-track">
            {[0, 1].map((half) => (
              <div key={half} className="flex shrink-0 gap-8 pr-8">
                {BENEFITS.map((benefit) => (
                  <span key={benefit} className="flex items-center gap-3 whitespace-nowrap text-sm font-medium text-white">
                    <span className="h-2 w-2 rounded-full bg-flag-yellow" />
                    {benefit}
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* -------------------------- CÓMO FUNCIONA -------------------------- */}
        <section id="como-funciona" className={`${sectionBase} bg-slate-50 text-slate-900`}>
          <Reveal className="max-w-2xl">
            <p className={`${eyebrow} text-flag-blue`}>Paso a paso</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Cómo funciona la app</h2>
            <p className="mt-4 text-slate-600">
              Cuatro pasos. La web y el SMS llaman exactamente a las mismas funciones, así que el resultado
              es idéntico venga por donde venga.
            </p>
          </Reveal>

          <Reveal delay={120} className="-mx-5 mt-10 px-5 sm:-mx-8 sm:px-8">
            <HorizontalScroll label="pasos de cómo funciona" tone="light">
              {STEPS.map((step, index) => (
                <article
                  key={step.title}
                  className={`flex w-[82vw] shrink-0 flex-col sm:w-[22rem] ${cardLight}`}
                >
                  <div className="flex items-center justify-between">
                    <span className={iconChipLight}>
                      <step.Icon className="h-5 w-5" />
                    </span>
                    <span className="text-5xl font-semibold text-flag-blue/10">0{index + 1}</span>
                  </div>
                  <h3 className="mt-5 text-lg font-semibold text-slate-900">{step.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600">{step.text}</p>
                  <code className="mt-auto block rounded-lg bg-night-950 px-3 py-2.5 font-mono text-xs text-flag-yellow">
                    {step.code}
                  </code>
                </article>
              ))}
            </HorizontalScroll>
          </Reveal>
        </section>

        {/* ------------------------------ DEMO ------------------------------- */}
        <section id="demo" className="relative isolate scroll-mt-24 overflow-hidden bg-night-900 py-20 text-white sm:py-28">
          <div className="mesh-soft absolute inset-0 -z-10" aria-hidden="true" />
          <div className={`${container} grid items-center gap-12 lg:grid-cols-2`}>
            <Reveal variant="left">
              <p className={`${eyebrow} text-flag-yellow`}>Demo en vivo</p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
                Una conversación, no un formulario
              </h2>
              <p className="mt-4 max-w-xl text-slate-300">
                Cada mensaje se analiza, se deduplica, se traduce a una regla de negocio y recibe una respuesta.
                Recorre la conversación paso a paso o escríbela tú mismo en el simulador.
              </p>

              <ul className="mt-7 space-y-3 text-sm text-slate-300">
                {[
                  "El código de verificación caduca y tiene intentos limitados.",
                  "Los mensajes duplicados se detectan por su identificador.",
                  "Cada respuesta queda registrada junto al mensaje que la provocó.",
                ].map((item) => (
                  <li key={item} className="flex gap-3">
                    <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-flag-yellow" />
                    {item}
                  </li>
                ))}
              </ul>

              <div className="mt-8 flex flex-wrap gap-3">
                <Link
                  href="/simulator"
                  className="rounded-full bg-flag-yellow px-5 py-2.5 text-sm font-semibold text-night-950 transition hover:brightness-110"
                >
                  Abrir simulador SMS
                </Link>
                <Link
                  href="/accounts"
                  className="rounded-full border border-white/25 px-5 py-2.5 text-sm font-semibold text-white transition hover:border-flag-red hover:text-flag-red"
                >
                  Crear mi cuenta
                </Link>
              </div>
            </Reveal>

            <Reveal variant="right" delay={120}>
              <PhoneDemo />
            </Reveal>
          </div>
        </section>

        {/* --------------------------- SIN CONEXIÓN --------------------------- */}
        <section id="sin-conexion" className={`${sectionBase} bg-white text-slate-900`}>
          <Reveal className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
            <div className="max-w-2xl">
              <p className={`${eyebrow} text-flag-red`}>Poca conexión</p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
                Pensado para donde la señal falla
              </h2>
              <p className="mt-4 text-slate-600">
                En muchas regiones el internet llega a ratos y el saldo de datos se acaba. El SMS viaja por la
                red del operador, se entrega cuando hay cobertura y no consume megas en ningún extremo.
              </p>
            </div>
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-night-950 text-flag-yellow">
              <WifiOffIcon className="h-7 w-7" />
            </span>
          </Reveal>

          <Reveal delay={120} className="-mx-5 mt-10 px-5 sm:-mx-8 sm:px-8">
            <HorizontalScroll label="razones por las que funciona sin conexión" tone="light">
              {OFFLINE_REASONS.map((reason) => (
                <article
                  key={reason.title}
                  className={`w-[82vw] shrink-0 bg-slate-50 sm:w-[20rem] ${cardLight}`}
                >
                  <span className={iconChipLight}>
                    <reason.Icon className="h-5 w-5" />
                  </span>
                  <h3 className="mt-5 text-base font-semibold text-slate-900">{reason.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600">{reason.text}</p>
                </article>
              ))}
            </HorizontalScroll>
          </Reveal>

          <Reveal delay={80} className="mt-12">
            <div className="relative overflow-hidden rounded-3xl border border-slate-200 bg-slate-50 p-7 sm:p-9">
              <div className="flag-stripe absolute inset-x-0 top-0 h-1.5" aria-hidden="true" />
              <h3 className="text-xl font-semibold text-slate-900">Cómo ayuda esto a la adopción del público</h3>
              <p className="mt-3 max-w-3xl text-sm leading-relaxed text-slate-600">
                Una billetera digital solo se populariza si la entrada es facilísima. Pagar con un mensaje es algo
                que mucha gente ya hace a diario: eso quita la barrera de aprendizaje y la de conectividad al mismo
                tiempo, y permite que comerciantes, vecinos y familias se sumen aunque nunca hayan usado una app
                financiera.
              </p>
              <div className="mt-7 grid gap-6 sm:grid-cols-3">
                {ADOPTION.map((item) => (
                  <div key={item.title} className="border-t-2 border-flag-yellow pt-4">
                    <item.Icon className="h-5 w-5 text-flag-blue" />
                    <h4 className="mt-3 text-sm font-semibold text-slate-900">{item.title}</h4>
                    <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{item.text}</p>
                  </div>
                ))}
              </div>
            </div>
          </Reveal>
        </section>

        {/* ----------------------------- ALCANCE ----------------------------- */}
        <section id="alcance" className="relative isolate scroll-mt-24 overflow-hidden bg-night-950 py-20 text-white sm:py-28">
          <div className="mesh-hero absolute inset-0 -z-10 opacity-70" aria-hidden="true" />
          <div className={container}>
            <Reveal className="max-w-2xl">
              <p className={`${eyebrow} text-flag-yellow`}>Alcance de la app</p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
                Quién gana cuando el pago entra por SMS
              </h2>
              <p className="mt-4 text-slate-300">
                El mismo servicio cubre varios frentes: desde quien no tiene cuenta bancaria hasta el comercio que
                necesita confirmar un pago con la señal que tiene.
              </p>
            </Reveal>

            <div className="mt-12 grid gap-5 sm:grid-cols-2">
              {REACH.map((item, index) => (
                <Reveal key={item.title} variant={index % 2 === 0 ? "left" : "right"} delay={index * 90}>
                  <article className={`group h-full ${cardDark}`}>
                    <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-flag-blue text-white transition group-hover:bg-flag-red">
                      <item.Icon className="h-5 w-5" />
                    </span>
                    <h3 className="mt-5 text-lg font-semibold text-white">{item.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-slate-300">{item.text}</p>
                  </article>
                </Reveal>
              ))}
            </div>

            <Reveal delay={120} className="mt-10">
              <div className="rounded-3xl border border-flag-yellow/25 bg-flag-yellow/10 p-7 sm:p-9">
                <h3 className="text-lg font-semibold text-flag-yellow">Del mensaje a la adopción masiva</h3>
                <p className="mt-3 max-w-3xl text-sm leading-relaxed text-slate-300">
                  Como el canal ya es familiar, cada persona nueva puede recibir pagos el mismo día, sin esperar
                  instalaciones ni capacitación. El crecimiento se da de boca en boca, con la herramienta que la
                  gente ya usa para escribirse.
                </p>
              </div>
            </Reveal>
          </div>
        </section>

        {/* ----------------------------- CANALES ----------------------------- */}
        <section id="arquitectura" className={`${sectionBase} bg-slate-50 text-slate-900`}>
          <Reveal className="max-w-2xl">
            <p className={`${eyebrow} text-flag-blue`}>Por dentro</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
              Una sola lógica, tres puertas de entrada
            </h2>
            <p className="mt-4 text-slate-600">
              Los canales solo traducen su entrada a una llamada de aplicación. La regla de negocio vive en un único
              sitio: <code className="font-mono text-sm text-flag-blue">crearCuenta()</code>,{" "}
              <code className="font-mono text-sm text-flag-blue">enviarDinero()</code> y{" "}
              <code className="font-mono text-sm text-flag-blue">verSaldo()</code>.
            </p>
          </Reveal>

          <Reveal delay={120} className="-mx-5 mt-10 px-5 sm:-mx-8 sm:px-8">
            <HorizontalScroll label="canales de la app" tone="light">
              {CHANNELS.map((channel) => (
                <article key={channel.title} className={`w-[82vw] shrink-0 sm:w-[20rem] ${cardLight}`}>
                  <span className={iconChipLight}>
                    <channel.Icon className="h-5 w-5" />
                  </span>
                  <h3 className="mt-5 text-lg font-semibold text-slate-900">{channel.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600">{channel.text}</p>
                </article>
              ))}
            </HorizontalScroll>
          </Reveal>

          <Reveal delay={120} className="-mx-5 mt-8 px-5 sm:-mx-8 sm:px-8">
            <HorizontalScroll label="garantías técnicas" tone="light">
              {GUARANTEES.map((item) => (
                <article key={item.title} className={`w-[82vw] shrink-0 sm:w-[20rem] ${cardLight}`}>
                  <span className={iconChipLight}>
                    <item.Icon className="h-5 w-5" />
                  </span>
                  <h3 className="mt-5 text-lg font-semibold text-slate-900">{item.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600">{item.text}</p>
                </article>
              ))}
            </HorizontalScroll>
          </Reveal>

          <Reveal delay={160} className="mt-10">
            <p className="rounded-2xl border border-amber-300 bg-amber-50 px-5 py-4 text-sm leading-relaxed text-amber-900">
              <strong className="font-semibold">Estado actual:</strong> los pagos corren hoy en modo demostración
              con pruebas automatizadas. La integración con Open Payments está implementada, pero falta probarla
              contra la red real y contra proveedores SMS con credenciales activas.
            </p>
          </Reveal>
        </section>

        {/* ----------------------------- EMPEZAR ----------------------------- */}
        <section id="empezar" className="relative isolate scroll-mt-24 overflow-hidden bg-night-900 py-20 text-white sm:py-28">
          <div className="mesh-hero absolute inset-0 -z-10 opacity-80" aria-hidden="true" />
          <div className={container}>
            <Reveal className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">Empieza en dos minutos</h2>
              <p className="mt-4 text-slate-300">
                Crea tu cuenta, verifica el celular y envía tu primer pago. También puedes hacerlo por SMS con{" "}
                <code className="font-mono text-flag-yellow">CREAR CUENTA</code>.
              </p>
            </Reveal>

            <div className="mx-auto mt-10 grid max-w-4xl gap-4 sm:grid-cols-3">
              {[
                { href: "/accounts", title: "Crear cuenta", text: "Verifica tu celular y crea tu billetera." },
                { href: "/payments", title: "Enviar dinero", text: "Envía a otro número registrado." },
                { href: "/balance", title: "Consultar saldo", text: "Revisa el saldo de tu cuenta." },
              ].map((item, index) => (
                <Reveal key={item.href} delay={index * 90}>
                  <Link
                    href={item.href}
                    className={`group flex h-full flex-col backdrop-blur hover:-translate-y-1 ${cardDark}`}
                  >
                    <h3 className="text-base font-semibold text-white">{item.title}</h3>
                    <p className="mt-2 text-sm text-slate-300">{item.text}</p>
                    <span className="mt-5 text-sm font-medium text-flag-yellow transition group-hover:translate-x-1">
                      Abrir →
                    </span>
                  </Link>
                </Reveal>
              ))}
            </div>

            <Reveal delay={160} className="mt-12">
              <HorizontalScroll label="comandos SMS" tone="dark">
                {COMMANDS.map((command) => (
                  <div key={command.code} className="shrink-0">
                    <code className="block whitespace-nowrap rounded-full border border-white/15 bg-white/5 px-4 py-2 font-mono text-xs text-flag-yellow">
                      {command.code}
                    </code>
                  </div>
                ))}
              </HorizontalScroll>
            </Reveal>
          </div>
        </section>

        <footer className="border-t border-white/10 bg-night-950 py-8 text-slate-400">
          <div className={`${container} flex flex-col items-center justify-between gap-4 text-sm sm:flex-row`}>
            <p className="font-medium text-slate-300">Chasky · Pagos por SMS para Colombia</p>
            <nav className="flex flex-wrap justify-center gap-5">
              <Link href="/accounts" className="transition hover:text-flag-yellow">
                Cuenta
              </Link>
              <Link href="/payments" className="transition hover:text-flag-yellow">
                Enviar dinero
              </Link>
              <Link href="/balance" className="transition hover:text-flag-yellow">
                Saldo
              </Link>
            </nav>
          </div>
        </footer>
      </div>
    </>
  );
}

function HeroVisual() {
  return (
    <div className="relative mx-auto w-full max-w-md py-10">
      <span
        className="pointer-events-none absolute -top-4 left-2 h-40 w-40 animate-float rounded-full bg-flag-yellow/25 blur-3xl"
        aria-hidden="true"
      />
      <span
        className="pointer-events-none absolute -bottom-6 right-0 h-48 w-48 animate-float-slow rounded-full bg-flag-red/25 blur-3xl"
        aria-hidden="true"
      />

      <div className="relative rounded-[2rem] border border-white/15 bg-white/[0.06] p-6 shadow-2xl backdrop-blur-xl sm:p-7">
        <div className="flex items-center justify-between text-xs text-slate-300">
          <span>Billetera · +57 310 ••• 3109</span>
          <span className="rounded-full bg-emerald-400/15 px-2 py-0.5 font-medium text-emerald-300">Verificada</span>
        </div>

        <p className="mt-7 text-sm text-slate-300">Saldo disponible</p>
        <p className="mt-1 text-4xl font-semibold tracking-tight">
          30.000 <span className="text-lg text-slate-400">COP</span>
        </p>

        <div className="mt-6 space-y-2 rounded-2xl bg-night-950/70 p-4 font-mono text-xs leading-relaxed text-slate-300">
          <p>
            <span className="text-flag-yellow">&gt;</span> SALDO
          </p>
          <p className="text-emerald-300">Tu saldo disponible es 30.000 COP.</p>
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          <span className="animate-bob rounded-full border border-white/15 bg-night-900/90 px-3 py-1.5 text-xs font-medium text-slate-100">
            Sin datos móviles
          </span>
          <span className="animate-bob rounded-full border border-white/15 bg-night-900/90 px-3 py-1.5 text-xs font-medium text-slate-100 [animation-delay:900ms]">
            Confirmado con señal 2G
          </span>
        </div>
      </div>
    </div>
  );
}
