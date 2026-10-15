/**
 * Prueba de quién invoca una operación. La construye cada canal (web o SMS),
 * nunca el cliente a partir de un número de teléfono proporcionado libremente.
 */
export interface AuthorizationContext {
  userId: string;
  channel: "web" | "sms";
}
