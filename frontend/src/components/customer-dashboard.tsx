"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { SmsAction } from "./sms-action";

type Money = { value: string; currency: string; assetScale: number };
type Transaction = { id: string; value: string | null; currency: string | null; asset_scale: number | null; state: string; direction: string; counterparty: string; created_at: string };
type Dashboard = { user: { phone: string; status: string; phoneVerified: boolean }; provider: string; history?: { status: string; message: string; authorizeUrl: string | null }; testMode: boolean; balance: (Money & { kind: string }) | null; balanceMessage: string | null; wallets: { wallet_address: string; currency: string }[]; grants: { status: string }[]; transactions: Transaction[]; demo: { funding_status: string; authorization_status: string } | null; updatedAt: string };
const states: Record<string, string> = { RECEIVING: "Recibiendo", COMPLETED: "Completado", PROCESSING: "En proceso", AWAITING_CONFIRMATION: "Por confirmar", PREPARING: "Preparando", RECEIVED: "Recibido", CANCELLED: "Cancelado", EXPIRED: "Vencido", FAILED: "Fallido", NEEDS_REVIEW: "En revisión", GRANTED: "Autorizada", PENDING_INTERACTION: "Pendiente de autorización", REVOKED: "Revocada", FUNDED: "Abonados", PENDING: "Pendiente", AUTHORIZED: "Autorizada", MISSING: "Sin autorización" };
function money(value: string | null, currency = "COP", scale = 0) {
  if (value === null) return "—";
  const amount = Number(value) / 10 ** scale;
  return Number.isFinite(amount) ? new Intl.NumberFormat("es-CO", { style: "currency", currency, maximumFractionDigits: scale }).format(amount) : "—";
}

export function CustomerDashboard() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [authorizeUrl, setAuthorizeUrl] = useState<string | null>(null);
  const [tab, setTab] = useState("all");
  const [command, setCommand] = useState("");
  async function load() {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/customer/dashboard", { cache: "no-store" });
      if (response.status === 401) { window.location.replace("/login"); return; }
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? "No pudimos cargar tu cuenta.");
      setData(result);
    } catch (e) { setError(e instanceof Error ? e.message : "No pudimos cargar tu cuenta."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (data?.history?.status !== "pending") return;
    const timer = setInterval(() => { void load(); }, 10000);
    return () => clearInterval(timer);
  }, [data?.history?.status]);
  async function connectHistory() {
    setConnecting(true); setError("");
    try {
      const response = await fetch("/api/customer/history/connect", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? "No se pudo conectar el historial.");
      setAuthorizeUrl(result.authorizeUrl);
      await load();
    } catch(e) { setError(e instanceof Error ? e.message : "No se pudo conectar el historial."); }
    finally { setConnecting(false); }
  }
  async function signOut() {
    try {
      const response = await fetch("/api/customer/logout", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      if (!response.ok) throw new Error();
      window.location.replace("/login");
    } catch { setError("No pudimos cerrar la sesión. Intenta de nuevo."); }
  }
  if (!data) return <div className="chasky-state" role="status"><div className="chasky-mark">C<span>↗︎</span></div><h1>{loading ? "Abriendo tu Chasky…" : "Tu cuenta no está disponible"}</h1>{error && <><p role="alert">{error}</p><button className="chasky-primary" onClick={load}>Intentar de nuevo</button></>}</div>;
  const transactions = data.transactions.filter(t => tab === "all" || t.direction === tab);
  return <div className="chasky-app">
    <aside className="chasky-sidebar"><Link className="chasky-wordmark" href="/">chasky<span>↗︎</span></Link><span className="chasky-eyebrow">MI ESPACIO</span><a className="chasky-nav active" href="#overview">◫ Resumen</a><a className="chasky-nav" href="#activity">⇄ Movimientos</a><a className="chasky-nav" href="#account">◎ Mi cuenta</a><Link className="chasky-nav" href="/payments">↗︎ Enviar por SMS</Link><div className="chasky-sidebar-bottom"><span className="chasky-online" /> Conectado a {data.provider}<button onClick={signOut}>Cerrar sesión ↗︎</button></div></aside>
    <div className="chasky-workspace" id="overview"><header className="chasky-dash-heading"><div><span className="chasky-eyebrow">TU DÍA, EN ORDEN</span><h1>Hola, qué bueno verte<span> 👋</span></h1><p>Todo lo que necesitas saber de tu cuenta, en un solo lugar.</p></div><button onClick={load} disabled={loading} className="chasky-refresh">{loading ? "Actualizando…" : "↻ Actualizar"}</button></header>
      {error && <p className="chasky-error" role="alert">{error}</p>}
      {data.testMode && <div className="chasky-test-banner">◈ Entorno de pruebas · Los fondos son ficticios.</div>}
      <section className="chasky-overview"><div className="chasky-balance"><div className="flex justify-between"><span>{data.balance?.kind === "budget" ? "Presupuesto autorizado disponible" : "Saldo disponible"}</span><span className="chasky-balance-symbol">↗︎</span></div><strong>{data.balance ? money(data.balance.value, data.balance.currency, data.balance.assetScale) : "No disponible"}</strong><p>{data.balance ? `${data.balance.currency} · ${data.balance.kind === "budget" ? "Límite restante de tu autorización" : "Disponible en tu cuenta Chasky"}` : data.balanceMessage}</p>{!data.balance && data.wallets.some(w => { try { return new URL(w.wallet_address).hostname === "ilp.interledger-test.dev"; } catch { return false; } }) && <a href="https://wallet.interledger-test.dev" target="_blank" rel="noopener noreferrer" className="mt-4 inline-block text-xs font-semibold text-lime-200 underline underline-offset-4">Ver saldo en Test Wallet ↗︎</a>}<div className="chasky-balance-footer"><span>•••• {data.user.phone.slice(-4)}</span><span>{data.provider}</span></div></div>
        <div className="chasky-card chasky-actions"><span className="chasky-eyebrow">A UN MENSAJE DE DISTANCIA</span><h2>¿Qué quieres hacer hoy?</h2><Link href="/payments"><span>↗︎</span><div>Enviar dinero<small>Prepara un pago desde tu celular</small></div><b>→</b></Link><button onClick={() => setCommand(command ? "" : "SALDO")}><span>▤</span><div>Consultar por SMS<small>Tu cuenta también está sin internet</small></div><b>→</b></button></div>
      </section>
      {command && <div className="mb-6"><SmsAction command={command} /></div>}
      {data.history && <section className="chasky-card mb-6" aria-label="Historial de la wallet"><h2>Pagos recibidos en tu wallet</h2><p className="chasky-small mt-2">{data.history.message}</p>
        {(data.history.status === "not_connected" || data.history.status === "unavailable") && <button onClick={connectHistory} disabled={connecting} className="chasky-primary mt-4">{connecting ? "Conectando…" : "Conectar historial de Chasky"}</button>}
        {data.history.status === "pending" && (data.history.authorizeUrl ?? authorizeUrl) && <a href={(data.history.authorizeUrl ?? authorizeUrl)!} target="_blank" rel="noopener noreferrer" className="chasky-primary mt-4">Autorizar lectura en mi wallet ↗︎</a>}
        {data.history.status === "pending" && <p className="chasky-small mt-3">Autoriza en la otra pestaña y vuelve aquí. Se comprobará cada 10 segundos. Solo se solicita lectura de ingresos.</p>}
      </section>}
      <section id="activity" className="chasky-card chasky-activity"><div className="chasky-section-heading"><div><h2>Tu actividad reciente</h2><p>Últimos 25 movimientos disponibles</p></div><div className="chasky-tabs" aria-label="Filtrar movimientos">{([["all", "Todos"], ["sent", "Enviados"], ["received", "Recibidos"]] as const).map(([value,label]) => <button key={value} aria-pressed={tab === value} onClick={() => setTab(value)}>{label}</button>)}</div></div>
        {!transactions.length ? <div className="chasky-empty"><span>⇄</span><h3>Aquí empieza tu historia</h3><p>{data.transactions.length ? "No hay movimientos para este filtro." : "Tus pagos aparecerán aquí cuando empieces a usar Chasky."}</p></div> : <div className="overflow-x-auto"><table className="chasky-table"><thead><tr><th>Movimiento</th><th>Fecha</th><th>Estado</th><th className="text-right">Monto</th></tr></thead><tbody>{transactions.map(t => <tr key={t.id}><td><div className="chasky-transaction-title"><span className={t.direction === "received" ? "received" : ""}>{t.direction === "received" ? "↙︎" : "↗︎"}</span><div><strong>{t.direction === "received" ? "Dinero recibido" : "Dinero enviado"}</strong><small title={t.counterparty}>{t.counterparty}</small></div></div></td><td className="whitespace-nowrap">{new Date(t.created_at).toLocaleDateString("es-CO", { day: "numeric", month: "short" })}</td><td><span className={`chasky-status ${t.state === "COMPLETED" ? "complete" : ""}`}>{states[t.state] ?? t.state}</span></td><td className={`whitespace-nowrap text-right font-semibold ${t.direction === "received" ? "text-emerald-700" : ""}`}>{t.direction === "received" ? "+" : "−"}{money(t.value, t.currency ?? "COP", t.asset_scale ?? 0)}</td></tr>)}</tbody></table></div>}
      </section>
      <section className="chasky-account-grid" id="account"><div className="chasky-card"><span className="chasky-eyebrow">MI CUENTA</span><h2>Tu número, tu identidad</h2><p className="chasky-phone">{data.user.phone}</p><span className="chasky-verified">{data.user.phoneVerified ? "✓ Celular verificado" : "Celular pendiente de verificación"} · {data.user.status === "active" ? "Cuenta activa" : "Cuenta de prueba pendiente"}</span>{data.wallets.length ? data.wallets.map(w => <div key={w.wallet_address} className="chasky-wallet"><span>Billetera · {w.currency}</span><p>{w.wallet_address}</p></div>) : <p className="chasky-small mt-4">Aún no hay una billetera conectada. El equipo puede ayudarte a completar el alta.</p>}</div><div className="chasky-card"><span className="chasky-eyebrow">ESTADO DEL SERVICIO</span><h2>Siempre en tus manos</h2><p className="chasky-small mt-3">Proveedor: {data.provider}</p>{data.grants.length > 0 && <p className="chasky-small mt-2">Autorización: {states[data.grants[0]!.status] ?? data.grants[0]!.status}</p>}{data.demo && <p className="chasky-small mt-2">Fondos de prueba: {states[data.demo.funding_status] ?? data.demo.funding_status}</p>}<p className="chasky-small mt-3">Última consulta: {new Date(data.updatedAt).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })}</p><div className="chasky-hint">No compartas tus códigos. Chasky verifica tu identidad antes de mostrar tu información.</div></div></section>
    </div>
  </div>;
}
