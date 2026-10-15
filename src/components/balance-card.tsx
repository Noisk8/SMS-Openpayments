"use client";

import { useEffect, useState } from "react";
import { requestJson } from "@/components/post-json";

interface BalanceResponse {
  success: boolean;
  alias?: string;
  telefono?: string;
  saldo?: string;
  moneda?: string;
  billetera?: string;
  code?: string;
}

export function BalanceCard() {
  const [data, setData] = useState<BalanceResponse | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function loadBalance() {
    const result = await requestJson<BalanceResponse>("/api/accounts/me/balance");
    if (!result.ok) {
      return { data: null, message: result.data.message ?? "No se pudo consultar el saldo." };
    }
    return { data: result.data as BalanceResponse, message: null };
  }

  function applyResult(result: Awaited<ReturnType<typeof loadBalance>>) {
    setData(result.data);
    setMessage(result.message);
  }

  async function refresh() {
    setBusy(true);
    applyResult(await loadBalance());
    setBusy(false);
  }

  useEffect(() => {
    let active = true;
    loadBalance().then((result) => {
      if (active) {
        applyResult(result);
      }
    });
    return () => {
      active = false;
    };
    // La carga inicial se ejecuta una sola vez al montar el componente.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        {data?.success ? (
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <dt className="text-slate-500">Alias</dt>
            <dd>{data.alias}</dd>
            <dt className="text-slate-500">Teléfono</dt>
            <dd>{data.telefono}</dd>
            <dt className="text-slate-500">Billetera</dt>
            <dd className="break-all">{data.billetera}</dd>
            <dt className="text-slate-500">Saldo</dt>
            <dd className="text-xl font-semibold">{data.saldo} {data.moneda}</dd>
          </dl>
        ) : (
          <p className="text-sm text-slate-600">{message ?? (busy ? "Consultando…" : "Sin datos.")}</p>
        )}
      </div>
      <button onClick={refresh} disabled={busy} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50">
        ACTUALIZAR SALDO
      </button>
    </div>
  );
}
