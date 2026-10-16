/** Códigos de error estables para respuestas HTTP y logs. */
export type ErrorCode =
  | "VALIDATION_FAILED"
  | "NOT_FOUND"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "CONFLICT"
  | "DUPLICATE_MESSAGE"
  | "INSUFFICIENT_GRANT_BUDGET"
  | "INSUFFICIENT_FUNDS"
  | "QUOTE_EXPIRED"
  | "CONFIRMATION_INVALID"
  | "CONFIRMATION_EXPIRED"
  | "PAYMENT_NOT_CANCELLABLE"
  | "PROVIDER_ERROR"
  | "NEEDS_REVIEW"
  | "DEMO_ASSIGNMENT_DISABLED"
  | "DEMO_WALLET_POOL_EXHAUSTED"
  | "DEMO_WALLET_ALREADY_ASSIGNED"
  | "DEMO_WALLET_INCOMPATIBLE"
  | "INTERNAL";

export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/** Mapea un código de error a un status HTTP sensato. */
export function httpStatusFor(code: ErrorCode): number {
  switch (code) {
    case "VALIDATION_FAILED":
      return 400;
    case "UNAUTHORIZED":
      return 401;
    case "FORBIDDEN":
      return 403;
    case "NOT_FOUND":
      return 404;
    case "DEMO_ASSIGNMENT_DISABLED":
      return 403;
    case "CONFLICT":
    case "DUPLICATE_MESSAGE":
    case "QUOTE_EXPIRED":
    case "CONFIRMATION_EXPIRED":
    case "PAYMENT_NOT_CANCELLABLE":
    case "DEMO_WALLET_ALREADY_ASSIGNED":
    case "DEMO_WALLET_INCOMPATIBLE":
      return 409;
    case "DEMO_WALLET_POOL_EXHAUSTED":
      return 503;
    case "INSUFFICIENT_GRANT_BUDGET":
    case "INSUFFICIENT_FUNDS":
      return 402;
    case "PROVIDER_ERROR":
    case "NEEDS_REVIEW":
      return 502;
    default:
      return 500;
  }
}
