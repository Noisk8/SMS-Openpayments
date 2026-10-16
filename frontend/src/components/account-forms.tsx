"use client";
import { useState } from "react";
import { SmsAction } from "./sms-action";

export function AccountForms() {
  const [code, setCode] = useState("");
  return <div className="space-y-6">
    <SmsAction command="CREAR CUENTA" />
    <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="font-semibold">Verifica tu número</h2>
      <p className="text-sm text-slate-600">Recibirás un código de seis dígitos por SMS. Respóndelo desde el mismo celular; no necesitas crear una contraseña web.</p>
      <label className="block text-sm">Código recibido<input value={code} onChange={event => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="123456" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" /></label>
      {code.length === 6 && <SmsAction command={`VERIFICAR ${code}`} />}
    </div>
  </div>;
}
