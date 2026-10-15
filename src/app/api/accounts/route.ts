import { NextResponse } from "next/server";
import { crearCuenta } from "@/lib/accounts/create-account";
import { getAppContext } from "@/lib/context";
import { errorResponse, readJson } from "@/lib/http/responses";

export const runtime = "nodejs";

/** Crea la solicitud de cuenta y envía el código de verificación al celular. */
export async function POST(request: Request) {
  try {
    const result = await crearCuenta(await readJson(request) as Parameters<typeof crearCuenta>[0], getAppContext());
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
