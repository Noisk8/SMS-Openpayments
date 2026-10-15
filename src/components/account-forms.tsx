"use client";

import { useState } from "react";
import { requestJson } from "@/components/post-json";

interface VerificationState {
  telefono: string;
  expiresAt: string;
}

const inputClass = "mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm";
const buttonClass =
  "rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50";

export function AccountForms() {
  const [mode, setMode] = useState<"create" | "login">("create");
  const [verification, setVerification] = useState<VerificationState | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function handleCreate(formData: FormData) {
    setBusy(true);
    setMessage(null);
    const body = {
      telefono: String(formData.get("telefono") ?? ""),
      alias: String(formData.get("alias") ?? ""),
      clave: String(formData.get("clave") ?? "") || undefined,
      walletAddress: String(formData.get("walletAddress") ?? "") || undefined,
    };
    const result = await requestJson<{ verification?: { telefono: string; expiresAt: string } }>("/api/accounts", {
      method: "POST",
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (!result.ok || !result.data.verification) {
      setMessage(result.data.message ?? "No se pudo crear la cuenta.");
      return;
    }
    setVerification({ telefono: result.data.verification.telefono, expiresAt: result.data.verification.expiresAt });
    setMessage("Te enviamos un código por SMS. Escríbelo abajo para confirmar tu número.");
  }

  async function handleVerify(formData: FormData) {
    if (!verification) return;
    setBusy(true);
    setMessage(null);
    const result = await requestJson("/api/accounts/verify", {
      method: "POST",
      body: JSON.stringify({ telefono: verification.telefono, codigo: String(formData.get("codigo") ?? "") }),
    });
    setBusy(false);
    if (!result.ok) {
      setMessage(result.data.message ?? "El código no es válido.");
      return;
    }
    setDone(true);
    setMessage("Cuenta creada y sesión iniciada.");
  }

  async function handleLogin(formData: FormData) {
    setBusy(true);
    setMessage(null);
    const result = await requestJson("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        telefono: String(formData.get("telefono") ?? ""),
        clave: String(formData.get("clave") ?? ""),
      }),
    });
    setBusy(false);
    if (!result.ok) {
      setMessage(result.data.message ?? "No se pudo iniciar sesión.");
      return;
    }
    setDone(true);
    setMessage("Sesión iniciada.");
  }

  if (done) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
        <p>{message}</p>
        <div className="mt-3 flex gap-3">
          <a href="/payments" className="underline">Enviar dinero</a>
          <a href="/balance" className="underline">Ver saldo</a>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex gap-2 text-sm">
        <button className={mode === "create" ? buttonClass : "rounded-md border px-4 py-2"} onClick={() => setMode("create")}>
          Crear cuenta
        </button>
        <button className={mode === "login" ? buttonClass : "rounded-md border px-4 py-2"} onClick={() => setMode("login")}>
          Iniciar sesión
        </button>
      </div>

      {mode === "login" ? (
        <form action={handleLogin} className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
          <label className="block text-sm">
            Número celular
            <input name="telefono" required placeholder="3001234567" className={inputClass} />
          </label>
          <label className="block text-sm">
            Clave
            <input name="clave" type="password" required className={inputClass} />
          </label>
          <button className={buttonClass} disabled={busy}>INICIAR SESIÓN</button>
        </form>
      ) : verification ? (
        <form action={handleVerify} className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-600">
            Código enviado a {verification.telefono}. Vence: {new Date(verification.expiresAt).toLocaleTimeString("es-CO")}.
          </p>
          <label className="block text-sm">
            Código de 6 dígitos
            <input name="codigo" inputMode="numeric" pattern="\d{6}" required className={inputClass} />
          </label>
          <button className={buttonClass} disabled={busy}>CONFIRMAR NÚMERO</button>
        </form>
      ) : (
        <form action={handleCreate} className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
          <label className="block text-sm">
            Número celular
            <input name="telefono" required placeholder="3001234567" className={inputClass} />
          </label>
          <label className="block text-sm">
            Alias
            <input name="alias" required placeholder="carlos" className={inputClass} />
          </label>
          <label className="block text-sm">
            Clave (opcional, para iniciar sesión en la web)
            <input name="clave" type="password" minLength={8} className={inputClass} />
          </label>
          <label className="block text-sm">
            Wallet address (solo con proveedor Open Payments)
            <input name="walletAddress" placeholder="https://ilp.example/tu-cuenta" className={inputClass} />
          </label>
          <button className={buttonClass} disabled={busy}>CREAR CUENTA</button>
        </form>
      )}

      {message ? <p className="text-sm text-slate-700">{message}</p> : null}
    </div>
  );
}
