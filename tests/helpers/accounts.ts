import { confirmarCuenta, crearCuenta } from "@/lib/accounts/create-account";
import { getMockSmsProvider } from "@/lib/sms/provider-factory";
import type { AppContext } from "@/lib/context";

/** Obtiene el último código de verificación enviado al número en la bandeja simulada. */
export function lastCodeFor(telefono: string): string {
  const message = getMockSmsProvider()
    .listOutbox()
    .filter((item) => item.to === telefono)
    .at(-1);
  const match = message?.body.match(/\b(\d{6})\b/);
  if (!match) {
    throw new Error(`No hay código para ${telefono}`);
  }
  return match[1]!;
}

/** Crea y verifica una cuenta completa a través del flujo real (crearCuenta + confirmarCuenta). */
export async function createAccountFor(ctx: AppContext, telefono: string, alias: string) {
  await crearCuenta({ telefono, alias }, ctx);
  const code = lastCodeFor(telefono);
  const result = await confirmarCuenta({ telefono, codigo: code }, ctx);
  return result.account;
}
