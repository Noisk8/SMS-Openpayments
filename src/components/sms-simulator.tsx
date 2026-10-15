"use client";

import { useState } from "react";
import { requestJson } from "@/components/post-json";

interface SimulationResponse {
  success: boolean;
  incoming?: { from: string; body: string };
  command?: string;
  operation?: unknown;
  outbound?: Array<{ to: string; body: string }>;
  message?: string;
}

export function SmsSimulator() {
  const [result, setResult] = useState<SimulationResponse | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(formData: FormData) {
    setBusy(true);
    const response = await requestJson<SimulationResponse>("/api/dev/sms/simulate", {
      method: "POST",
      body: JSON.stringify({
        from: String(formData.get("from") ?? ""),
        body: String(formData.get("body") ?? ""),
      }),
    });
    setBusy(false);
    setResult(response.ok ? (response.data as SimulationResponse) : { success: false, message: response.data.message });
  }

  return (
    <div className="space-y-6">
      <form action={handleSubmit} className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-amber-800">Proveedor: Mock (sin envíos reales)</p>
        <label className="block text-sm">
          Número de origen
          <input name="from" defaultValue="+573001234567" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
        </label>
        <label className="block text-sm">
          Mensaje
          <input name="body" defaultValue="ENVIAR 20000 3109876543" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
        </label>
        <button disabled={busy} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50">
          ENVIAR SMS SIMULADO
        </button>
      </form>

      {result ? (
        <div className="space-y-3 text-sm">
          {result.success ? (
            <>
              <Block title="SMS recibido">{`${result.incoming?.from}: ${result.incoming?.body}`}</Block>
              <Block title="Comando interpretado">{result.command ?? "—"}</Block>
              <Block title="Resultado de la función">{JSON.stringify(result.operation, null, 2) ?? "—"}</Block>
              <Block title="Respuesta SMS">
                {(result.outbound ?? []).map((item) => `→ ${item.to}: ${item.body}`).join("\n") || "—"}
              </Block>
            </>
          ) : (
            <p className="text-red-700">{result.message ?? "Error en la simulación."}</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function Block({ title, children }: { title: string; children: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <p className="text-xs font-semibold uppercase text-slate-500">{title}</p>
      <pre className="mt-1 whitespace-pre-wrap break-words font-sans">{children}</pre>
    </div>
  );
}
