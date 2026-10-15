import { NextResponse } from "next/server";
import { isAppError } from "@/lib/errors";
import { ZodError } from "zod";

/** Convierte cualquier error en una respuesta JSON segura (sin trazas ni detalles internos). */
export function errorResponse(error: unknown): NextResponse {
  if (isAppError(error)) {
    return NextResponse.json({ success: false, code: error.code, message: error.message }, { status: error.status });
  }
  if (error instanceof ZodError) {
    const first = error.issues[0]?.message ?? "Datos no válidos.";
    return NextResponse.json({ success: false, code: "VALIDATION_FAILED", message: first }, { status: 400 });
  }
  console.error("[api] error inesperado", error instanceof Error ? error.name : "desconocido");
  return NextResponse.json(
    { success: false, code: "INTERNAL", message: "Error interno. Intenta de nuevo más tarde." },
    { status: 500 },
  );
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return {};
  }
}
