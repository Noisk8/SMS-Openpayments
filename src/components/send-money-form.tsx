"use client";

import { useState } from "react";
import { requestJson } from "@/components/post-json";

interface TransferResponse {
  success: boolean;
  transaction?: { estado: string; monto: string; moneda: string; destino: string; reference: string; redirectUrl?: string; failureReason?: string };
}

export function SendMoneyForm() {
  const [message, setMessage] = useState<string | null>(null);
  const [redirectUrl, setRedirectUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(formData: FormData) {
    setBusy(true);
    setMessage(null);
    setRedirectUrl(null);
    const idempotencyKey = `web-${crypto.randomUUID()}`;
    const result = await requestJson<TransferResponse>("/api/payments", {
      method: "POST",
      body: JSON.stringify({
        destino: String(formData.get("destino") ?? ""),
        monto: String(formData.get("monto") ?? ""),
        idempotencyKey,
      }),
    });
    setBusy(false);
    const tx = result.data.transaction;
    if (!tx) {
      setMessage(result.data.message ?? "No se pudo completar la transferencia.");
      return;
    }
    const labels: Record<string, string> = {
      COMPLETED: "Transferencia exitosa",
      PROCESSING: "Transferencia en proceso",
      REQUIRES_AUTHORIZATION: "Se requiere autorización segura para completar el pago",
      FAILED: "No se pudo completar la transferencia",
    };
    setMessage(
      `${labels[tx.estado] ?? tx.estado}. Monto: ${tx.monto} ${tx.moneda}. Destino: ${tx.destino}. Referencia: ${tx.reference}.`,
    );
    if (tx.redirectUrl) {
      setRedirectUrl(tx.redirectUrl);
    }
  }

  return (
    <div className="space-y-4">
      <form action={handleSubmit} className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
        <label className="block text-sm">
          Destinatario (celular)
          <input name="destino" required placeholder="3109876543" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
        </label>
        <label className="block text-sm">
          Monto (COP, sin decimales)
          <input name="monto" required inputMode="numeric" placeholder="20000" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
        </label>
        <button disabled={busy} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50">
          ENVIAR DINERO
        </button>
      </form>
      {message ? <p className="text-sm text-slate-700">{message}</p> : null}
      {redirectUrl ? (
        <a href={redirectUrl} className="inline-block rounded-md border border-slate-900 px-4 py-2 text-sm font-medium">
          Completar consentimiento
        </a>
      ) : null}
    </div>
  );
}
