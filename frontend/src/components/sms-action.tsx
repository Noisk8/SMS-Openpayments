"use client";
import { useState } from "react";

export function SmsAction({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  const phone = process.env.NEXT_PUBLIC_SMS_NUMBER?.trim();
  return (
    <div className="space-y-3 rounded-lg border border-indigo-200 bg-indigo-50 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">Mensaje para enviar desde tu celular</p>
      <code className="block break-words text-lg font-semibold text-slate-900">{command}</code>
      <div className="flex flex-wrap gap-3 text-sm">
        {phone && /^\+[1-9]\d{7,14}$/.test(phone) ? <a className="rounded-md bg-slate-900 px-4 py-2 font-medium text-white" href={`sms:${phone}?body=${encodeURIComponent(command)}`}>Abrir mensajes</a> : <p className="text-slate-600">Envía este mensaje al número SMS del proyecto.</p>}
        <button type="button" className="rounded-md border border-slate-300 bg-white px-4 py-2" onClick={async () => { try { await navigator.clipboard.writeText(command); setCopied(true); } catch { setCopied(false); } }}>{copied ? "Copiado" : "Copiar mensaje"}</button>
      </div>
      <p className="text-xs text-slate-500">COP de prueba. La operación se procesa cuando envías el SMS y recibes la respuesta.</p>
    </div>
  );
}
