import pino, { type Logger, type LoggerOptions } from "pino";

export const REDACT_PATHS = [
  "*.password",
  "*.token",
  "*.apiKey",
  "*.api_key",
  "*.secret",
  "*.authorization",
  "req.headers.authorization",
  "req.headers.cookie",
  "req.headers['x-mock-identity']",
  "req.headers['x-service-token']",
];

export const buildPinoOptions = (
  level: NonNullable<LoggerOptions["level"]>,
  base: Record<string, unknown> = {},
): LoggerOptions => ({
  level,
  base: { service: "tomcat-core", ...base },
  redact: { paths: REDACT_PATHS, censor: "[redacted]" },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export type { Logger };
