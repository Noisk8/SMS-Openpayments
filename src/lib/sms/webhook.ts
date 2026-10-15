import type { AppContext } from "@/lib/context";
import { AppError, isAppError } from "@/lib/errors";
import { errorResponse } from "@/lib/http/responses";
import { handleIncomingSms } from "@/lib/sms/command-handler";
import type { SmsProvider } from "@/lib/sms/types";
import { NextResponse } from "next/server";

/**
 * Procesa un webhook de un proveedor SMS:
 * 1) solo si ese proveedor es el activo, 2) valida la firma antes de parsear,
 * 3) normaliza el mensaje y ejecuta el flujo común.
 */
export async function receiveSmsWebhook(
  providerName: string,
  request: Request,
  ctx: AppContext,
): Promise<NextResponse> {
  try {
    if (ctx.sms.name !== providerName) {
      throw new AppError("NOT_AVAILABLE_IN_ENVIRONMENT", "Webhook no disponible.");
    }
    const provider: SmsProvider = ctx.sms;
    if (!provider.capabilities.receive) {
      return NextResponse.json(
        { success: false, code: "PROVIDER_ERROR", message: `${providerName}: recepción de SMS no implementada.` },
        { status: 501 },
      );
    }
    const rawBody = await request.text();
    if (rawBody.length > 16_384) {
      return NextResponse.json({ success: false, code: "VALIDATION_FAILED" }, { status: 413 });
    }
    const valid = await provider.validateWebhook(request, rawBody);
    if (!valid) {
      return NextResponse.json({ success: false, code: "UNAUTHORIZED" }, { status: 401 });
    }
    const message = await provider.parseIncoming(request, rawBody);
    const result = await handleIncomingSms(message, ctx);
    return NextResponse.json({ success: true, duplicate: result.duplicate, command: result.command });
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_AVAILABLE_IN_ENVIRONMENT") {
      return NextResponse.json({ success: false, code: error.code, message: error.message }, { status: 404 });
    }
    return errorResponse(error);
  }
}
