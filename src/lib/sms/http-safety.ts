import { AppError } from "@/lib/errors";

const PRIVATE_IPV4 = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^0\./,
];

/**
 * Valida una URL configurada por el operador antes de hacer una petición saliente (anti-SSRF).
 * Solo HTTPS y sin destinos literales privados o locales. Las URLs vienen de variables de entorno,
 * nunca de datos enviados por usuarios.
 */
export function assertSafeOutboundUrl(value: string, allowLocalhost: boolean): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AppError("VALIDATION_FAILED", "La URL del proveedor no es válida.");
  }
  const host = url.hostname.toLowerCase();
  const isLocal = host === "localhost" || host === "[::1]";
  if (url.protocol === "https:") {
    if (isLocal || PRIVATE_IPV4.some((pattern) => pattern.test(host))) {
      throw new AppError("VALIDATION_FAILED", "La URL del proveedor apunta a un destino no permitido.");
    }
    return url;
  }
  if (url.protocol === "http:" && allowLocalhost && isLocal) {
    return url;
  }
  throw new AppError("VALIDATION_FAILED", "La URL del proveedor debe usar HTTPS.");
}
