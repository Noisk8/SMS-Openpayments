export type AppErrorCode =
  | "VALIDATION_FAILED"
  | "INVALID_PHONE"
  | "PHONE_ALREADY_REGISTERED"
  | "ALIAS_UNAVAILABLE"
  | "VERIFICATION_REQUIRED"
  | "VERIFICATION_INVALID"
  | "VERIFICATION_EXPIRED"
  | "ACCOUNT_NOT_FOUND"
  | "ACCOUNT_NOT_ACTIVE"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "INSUFFICIENT_FUNDS"
  | "SAME_ACCOUNT"
  | "DUPLICATE_OPERATION"
  | "AUTHORIZATION_REQUIRED"
  | "BALANCE_NOT_SUPPORTED"
  | "PROVIDER_ERROR"
  | "RATE_LIMITED"
  | "NOT_AVAILABLE_IN_ENVIRONMENT";

const HTTP_STATUS: Record<AppErrorCode, number> = {
  VALIDATION_FAILED: 400,
  INVALID_PHONE: 400,
  PHONE_ALREADY_REGISTERED: 409,
  ALIAS_UNAVAILABLE: 409,
  VERIFICATION_REQUIRED: 403,
  VERIFICATION_INVALID: 400,
  VERIFICATION_EXPIRED: 410,
  ACCOUNT_NOT_FOUND: 404,
  ACCOUNT_NOT_ACTIVE: 403,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  INSUFFICIENT_FUNDS: 422,
  SAME_ACCOUNT: 422,
  DUPLICATE_OPERATION: 409,
  AUTHORIZATION_REQUIRED: 402,
  BALANCE_NOT_SUPPORTED: 501,
  PROVIDER_ERROR: 502,
  RATE_LIMITED: 429,
  NOT_AVAILABLE_IN_ENVIRONMENT: 404,
};

/** Error controlado. El mensaje es seguro para mostrar al usuario. */
export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly status: number;

  constructor(code: AppErrorCode, message: string) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = HTTP_STATUS[code];
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
