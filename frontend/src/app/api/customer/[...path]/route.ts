import { NextRequest, NextResponse } from "next/server";

const COOKIE = "chasky_session";
const allowed = new Map([["history/connect", "POST"], ["login/options", "GET"], ["login/password", "POST"], ["login/request", "POST"], ["login/verify", "POST"], ["logout", "POST"], ["dashboard", "GET"]]);
async function handle(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const path = (await context.params).path.join("/");
  if (allowed.get(path) !== request.method) return NextResponse.json({ message: "Ruta no disponible" }, { status: 404 });
  if (request.method === "POST" && request.headers.get("origin") !== (process.env.FRONTEND_ORIGIN ?? request.nextUrl.origin)) {
    return NextResponse.json({ message: "Origen no permitido" }, { status: 403 });
  }
  try {
    const headers: Record<string, string> = { "content-type": "application/json" };
    const token = request.cookies.get(COOKIE)?.value;
    if (token) headers.authorization = `Bearer ${token}`;
    const response = await fetch(`${(process.env.BACKEND_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "")}/customer/${path}`, {
      method: request.method, headers, cache: "no-store", redirect: "error",
      ...(request.method === "POST" ? { body: await request.text() } : {}), signal: AbortSignal.timeout(20000),
    });
    const data = await response.json();
    const result = NextResponse.json((path === "login/verify" || path === "login/password") && response.ok ? { ok: true } : data, { status: response.status });
    result.headers.set("Cache-Control", "no-store");
    if ((path === "login/verify" || path === "login/password") && response.ok) {
      result.cookies.set(COOKIE, data.token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: data.maxAge });
    }
    if (path === "logout" || response.status === 401) result.cookies.set(COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 0 });
    return result;
  } catch {
    return NextResponse.json({ message: "No pudimos conectar con Chasky. Intenta de nuevo en unos instantes." }, { status: 502 });
  }
}
export { handle as GET, handle as POST };
