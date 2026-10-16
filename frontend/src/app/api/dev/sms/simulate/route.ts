import { NextResponse } from "next/server";
export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") return NextResponse.json({ message: "No disponible" }, { status: 404 });
  try {
    const body = await request.json();
    if (typeof body.from !== "string" || typeof body.body !== "string" || body.body.length > 1600) return NextResponse.json({ message: "Teléfono y mensaje requeridos" }, { status: 400 });
    const base = (process.env.BACKEND_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
    const getOutbox = async () => {
      const response = await fetch(`${base}/dev/sms/outbox`, { cache: "no-store", signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error("Outbox no disponible");
      const data = await response.json() as { messages: Array<{ to: string; text: string }> };
      return data.messages.filter(message => message.to === body.from);
    };
    const previous = await getOutbox();
    const response = await fetch(`${base}/dev/sms/simulate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ from: body.from, text: body.body }), signal: AbortSignal.timeout(15000) });
    const result = await response.json();
    if (!response.ok) return NextResponse.json({ message: result.message ?? "El backend rechazó la simulación" }, { status: response.status });
    let messages = await getOutbox();
    for (let attempt = 0; result.queued && messages.length <= previous.length && attempt < 20; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 250));
      messages = await getOutbox();
    }
    return NextResponse.json({ success: true, incoming: { from: body.from, body: body.body }, command: body.body.split(/\s+/)[0], operation: { queued: Boolean(result.queued), processed: messages.length > previous.length }, outbound: messages.slice(previous.length).map(item => ({ to: item.to, body: item.text })) });
  } catch {
    return NextResponse.json({ message: "No se pudo conectar con el backend local. Comprueba BACKEND_URL y SMS_PROVIDER=mock." }, { status: 502 });
  }
}
