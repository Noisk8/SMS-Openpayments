import { NextResponse } from "next/server";
import { z } from "zod";
import { getAppContext } from "@/lib/context";
import { assertSimulatorEnabled } from "@/lib/dev/simulator-guard";
import { errorResponse, readJson } from "@/lib/http/responses";
import { getMockSmsProvider } from "@/lib/sms/provider-factory";
import { handleIncomingSms } from "@/lib/sms/command-handler";
import { AppError } from "@/lib/errors";

export const runtime = "nodejs";

const simulateSchema = z.object({
  from: z.string().min(1).max(20),
  body: z.string().min(1).max(320),
});

/** Bandeja de SMS salientes simulados (solo desarrollo). */
export async function GET() {
  try {
    assertSimulatorEnabled();
    const outbox = getMockSmsProvider().listOutbox().slice(-50);
    return NextResponse.json({
      success: true,
      outbox: outbox.map((item) => ({ id: item.id, to: item.to, body: item.body, createdAt: item.createdAt })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * Simula un SMS entrante con el mismo procesador que los proveedores reales.
 * Usa el proveedor mock para las respuestas: nunca envía SMS a la red.
 */
export async function POST(request: Request) {
  try {
    assertSimulatorEnabled();
    const parsed = simulateSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      throw new AppError("VALIDATION_FAILED", "Número o mensaje no válidos.");
    }
    const mock = getMockSmsProvider();
    const ctx = { ...getAppContext(), sms: mock };
    const incoming = mock.buildIncoming(parsed.data.from, parsed.data.body);
    const startIndex = mock.outboxLength();
    const result = await handleIncomingSms(incoming, ctx);
    const outbound = mock.takeOutboxSince(startIndex).map((item) => ({ to: item.to, body: item.body }));
    return NextResponse.json({
      success: true,
      incoming: { id: incoming.id, from: incoming.from, body: incoming.body, provider: incoming.provider },
      command: result.command,
      duplicate: result.duplicate,
      operation: result.operation ?? null,
      outbound,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
