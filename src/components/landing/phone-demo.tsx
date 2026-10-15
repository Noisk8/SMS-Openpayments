"use client";

import { useCallback, useEffect, useState } from "react";

type Message = { from: "user" | "app"; text: string };

const CONVERSATION: Message[] = [
  { from: "user", text: "CREAR carlos" },
  { from: "app", text: "Alta iniciada para «carlos». Tu código de verificación es 123456" },
  { from: "user", text: "CONFIRMAR 123456" },
  { from: "app", text: "Cuenta verificada. Billetera lista con saldo 0 COP." },
  { from: "user", text: "ENVIAR 20000 3109876543" },
  { from: "app", text: "Listo: enviaste 20.000 COP a +573109876543. Tu saldo: 30.000 COP." },
  { from: "user", text: "SALDO" },
  { from: "app", text: "Tu saldo disponible es 30.000 COP." },
];

const STEP_MS = 1600;

/** Demo interactiva de una conversación SMS real con la app. */
export function PhoneDemo() {
  const [visible, setVisible] = useState(2);
  const [playing, setPlaying] = useState(true);

  const atEnd = visible >= CONVERSATION.length;

  useEffect(() => {
    if (!playing || atEnd) return;
    const timer = setTimeout(() => setVisible((count) => count + 1), STEP_MS);
    return () => clearTimeout(timer);
  }, [playing, atEnd, visible]);

  const restart = useCallback(() => {
    setVisible(1);
    setPlaying(true);
  }, []);

  const shown = CONVERSATION.slice(0, visible);

  return (
    <div className="mx-auto w-full max-w-[340px]">
      <div className="relative rounded-[2.6rem] border border-white/15 bg-night-950/90 p-3 shadow-[0_40px_90px_-30px_rgba(15,23,42,0.75)]">
        <span className="pointer-events-none absolute -inset-3 animate-pulse-ring rounded-[3rem] border border-indigo-400/40" aria-hidden="true" />
        <div className="flex items-center justify-between px-3 pb-2 pt-1 text-[11px] text-slate-400">
          <span>+57 300 123 4567</span>
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            SMS
          </span>
        </div>

        <div className="h-[340px] space-y-3 overflow-y-auto rounded-[2rem] bg-gradient-to-b from-slate-50 to-white px-3 py-4 sm:h-[380px]" aria-live="polite">
          {shown.map((message, index) => (
            <div
              key={`${message.from}-${index}`}
              className={`bubble-in flex ${message.from === "user" ? "justify-end" : "justify-start"}`}
            >
              <p
                className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-snug ${
                  message.from === "user"
                    ? "rounded-br-md bg-indigo-600 text-white"
                    : "rounded-bl-md border border-slate-200 bg-white text-slate-800 shadow-sm"
                }`}
              >
                {message.text}
              </p>
            </div>
          ))}

          {playing && !atEnd && (
            <div className="flex justify-start" aria-hidden="true">
              <span className="flex gap-1 rounded-2xl rounded-bl-md border border-slate-200 bg-white px-3 py-3 shadow-sm">
                <span className="h-1.5 w-1.5 animate-bob rounded-full bg-slate-400" />
                <span className="h-1.5 w-1.5 animate-bob rounded-full bg-slate-400 [animation-delay:150ms]" />
                <span className="h-1.5 w-1.5 animate-bob rounded-full bg-slate-400 [animation-delay:300ms]" />
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 px-2 pb-1 pt-3">
          <button
            type="button"
            onClick={() => setVisible((count) => Math.max(1, count - 1))}
            disabled={visible <= 1}
            className="rounded-full border border-white/15 px-3 py-1.5 text-xs text-slate-300 transition hover:border-indigo-400 hover:text-white disabled:opacity-30"
          >
            Atrás
          </button>
          <button
            type="button"
            onClick={() => (atEnd ? restart() : setVisible((count) => count + 1))}
            className="rounded-full border border-white/15 px-3 py-1.5 text-xs text-slate-300 transition hover:border-indigo-400 hover:text-white"
          >
            {atEnd ? "Repetir" : "Siguiente"}
          </button>
          <button
            type="button"
            onClick={() => setPlaying((value) => !value)}
            aria-pressed={playing}
            className="ml-auto rounded-full bg-indigo-500 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-indigo-400"
          >
            {playing && !atEnd ? "Pausar" : "Reproducir"}
          </button>
        </div>
      </div>

      <p className="mt-3 text-center text-xs text-slate-400">
        Demostración con el proveedor SMS simulado: no se envían mensajes reales.
      </p>
    </div>
  );
}
