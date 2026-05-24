export type ErrorCode =
  | "CONFIG_INVALID"
  | "AUTH_REQUIRED"
  | "AUTH_INVALID"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "BAD_REQUEST"
  | "LLM_FAILED"
  | "CONNECTOR_NOT_CONFIGURED"
  | "CONNECTOR_FAILED"
  | "INTERNAL";

export class CoreError extends Error {
  public readonly code: ErrorCode;
  public readonly status: number;
  public readonly details: Record<string, unknown> | undefined;

  constructor(
    code: ErrorCode,
    message: string,
    status: number,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "CoreError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export const AuthRequired = (msg = "Authentication required"): CoreError =>
  new CoreError("AUTH_REQUIRED", msg, 401);

export const AuthInvalid = (
  msg = "Invalid credentials",
  details?: Record<string, unknown>,
): CoreError => new CoreError("AUTH_INVALID", msg, 401, details);

export const Forbidden = (
  msg = "Forbidden",
  details?: Record<string, unknown>,
): CoreError => new CoreError("FORBIDDEN", msg, 403, details);

export const NotFound = (msg = "Not found"): CoreError =>
  new CoreError("NOT_FOUND", msg, 404);

export const BadRequest = (
  msg: string,
  details?: Record<string, unknown>,
): CoreError => new CoreError("BAD_REQUEST", msg, 400, details);

export const LlmFailed = (
  msg: string,
  details?: Record<string, unknown>,
): CoreError => new CoreError("LLM_FAILED", msg, 502, details);

export const ConnectorNotConfigured = (
  connector: string,
  operation: string,
): CoreError =>
  new CoreError(
    "CONNECTOR_NOT_CONFIGURED",
    `Connector "${connector}" is not configured for operation "${operation}"`,
    503,
    { connector, operation },
  );

export const ConnectorFailed = (
  msg: string,
  details?: Record<string, unknown>,
): CoreError => new CoreError("CONNECTOR_FAILED", msg, 502, details);
