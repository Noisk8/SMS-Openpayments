"use client";
import { useState } from "react";
import { SmsAction } from "./sms-action";

export function SendMoneyForm() {
  const [command, setCommand] = useState("");
  const [message, setMessage] = useState("");
  return <div className="space-y-4">
    <form action={(data: FormData) => {
      const raw = String(data.get("destino") ?? "").replace(/[\s()-]/g, "");
      const phone = /^3\d{9}$/.test(raw) ? `+57${raw}` : raw;
      const amount = String(data.get("monto") ?? "");
      if (!/^\+[1-9]\d{7,14}$/.test(phone) || !/^\d+$/.test(amount) || Number(amount) <= 0 || Number(amount) > 1_000_000_000) { setMessage("Revisa el celular y el monto en pesos enteros."); setCommand(""); return; }
      setMessage(""); setCommand(`PAGAR ${Number(amount)} A ${phone}`);
    }} className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <label className="block text-sm">Destinatario (celular)<input name="destino" required placeholder="3109876543" autoComplete="tel" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" /></label>
      <label className="block text-sm">Monto (COP de prueba, sin decimales)<input name="monto" required inputMode="numeric" pattern="[0-9]+" placeholder="20000" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" /></label>
      <button className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700">PREPARAR MENSAJE</button>
    </form>
    {message && <p role="alert" className="text-sm text-red-700">{message}</p>}
    {command && <SmsAction command={command} />}
    <p className="text-sm text-slate-600">Después de enviar el SMS, recibirás la cotización y el comando CONFIRMAR con la referencia y el código. Confirma únicamente desde tu teléfono.</p>
  </div>;
}
