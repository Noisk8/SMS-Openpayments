"use client";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

export function PhoneLogin() {
  const [testAvailable, setTestAvailable] = useState(false);
  const [passwordMode, setPasswordMode] = useState(false);
  const [password, setPassword] = useState("");
  useEffect(() => { fetch("/api/customer/login/options").then(r => r.ok ? r.json() : null).then(data => { const enabled = Boolean(data?.testPassword); setTestAvailable(enabled); setPasswordMode(enabled); }).catch(() => {}); }, []);
  const [phone, setPhone] = useState("");
  const [challenge, setChallenge] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sentAt, setSentAt] = useState(0);
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(""); setBusy(true);
    try {
      const response = await fetch(`/api/customer/login/${passwordMode ? "password" : challenge ? "verify" : "request"}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(challenge ? { challengeId: challenge, code } : { phone: phone.startsWith("+") ? phone : `+57${phone}`, ...(passwordMode ? { password } : {}) }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message ?? "Revisa el número y el código e intenta de nuevo.");
      if (challenge || passwordMode) window.location.assign("/dashboard");
      else { setChallenge(data.challengeId); setSentAt(Date.now()); }
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo iniciar sesión"); }
    finally { setBusy(false); }
  }
  return <div className="chasky-login">
    <section className="chasky-login-story"><span className="chasky-eyebrow">TU DINERO, MÁS CERCA</span><div className="chasky-mark">C<span>↗︎</span></div><h1>Tu celular.<br />Tu cuenta.<br /><em>Tu Chasky.</em></h1><p>Una forma más simple de estar al día con tu dinero. Entra con el número que ya usas para pagar por SMS.</p><div className="chasky-security">◈ Sin contraseñas que recordar<br /><span>Un código privado, directo a tu celular.</span></div></section>
    <section className="chasky-login-form"><span className="chasky-pill">BIENVENIDO A CHASKY</span><h2>{challenge ? "Revisa tus mensajes" : "Entra a tu cuenta"}</h2><p>{challenge ? `Si ${phone} tiene una cuenta activa, recibirá un código de 6 dígitos. Vence en 5 minutos.` : passwordMode ? "Ingresa con tu número de celular y tu contraseña de prueba." : "Tu número es la llave. Te enviaremos un código para verificar que eres tú."}</p>
      {testAvailable && !challenge && <div className="mb-5 flex gap-4 text-sm"><button type="button" aria-pressed={!passwordMode} onClick={() => { setPasswordMode(false); setError(""); }}>Código SMS</button><button type="button" aria-pressed={passwordMode} onClick={() => { setPasswordMode(true); setError(""); }}>Contraseña de prueba</button></div>}
      {passwordMode && <p className="chasky-test-banner">Acceso de desarrollo. No verifica el teléfono ni autoriza pagos.</p>}
      <form onSubmit={submit} className="space-y-5">
        {challenge ? <label className="chasky-field">Código de verificación<input autoFocus value={code} onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0,6))} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" required maxLength={6} placeholder="000000" /></label> : <label className="chasky-field">Número de celular<input autoFocus type="tel" value={phone} onChange={e => setPhone(e.target.value.replace(/[\s()-]/g, ""))} autoComplete="tel" placeholder="300 123 4567" required pattern="(\+[1-9][0-9]{7,14}|3[0-9]{9})" /><span>Colombia: 10 dígitos. Otros países: incluye + y el indicativo.</span></label>}
        {passwordMode && <label className="chasky-field">Contraseña<input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} minLength={7} maxLength={128} required /></label>}
        {error && <p className="chasky-error" role="alert">{error}</p>}
        <button className="chasky-primary w-full" disabled={busy}>{busy ? "Un momento…" : passwordMode ? "Ingresar →" : challenge ? "Verificar e ingresar →" : "Recibir código por SMS →"}</button>
      </form>
      {challenge && <button className="mt-5 text-sm font-semibold text-indigo-700" disabled={busy} onClick={() => { if (Date.now() - sentAt < 60000) { setError("Espera un minuto antes de solicitar otro código."); return; } setChallenge(""); setCode(""); setError(""); }}>Cambiar número o solicitar otro código</button>}
      <div className="chasky-login-note">¿Aún no tienes cuenta? <Link href="/accounts">Crea tu cuenta por SMS ↗︎</Link></div><p className="chasky-small">Nunca te pediremos que compartas tu código. Iniciar sesión no autoriza pagos.</p>
    </section>
  </div>;
}
