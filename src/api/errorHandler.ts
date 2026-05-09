import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";
import { CoreError } from "../errors/index.js";

export const errorHandler = (
  err: FastifyError | Error,
  req: FastifyRequest,
  reply: FastifyReply,
): void => {
  if (err instanceof CoreError) {
    req.log.warn(
      { code: err.code, status: err.status, details: err.details },
      err.message,
    );
    reply
      .status(err.status)
      .send({ error: { code: err.code, message: err.message, details: err.details } });
    return;
  }

  if (err instanceof ZodError) {
    req.log.warn({ issues: err.issues }, "validation_error");
    reply
      .status(400)
      .send({ error: { code: "BAD_REQUEST", message: "Validation failed", details: { issues: err.issues } } });
    return;
  }

  req.log.error({ err }, "unhandled_error");
  reply
    .status(500)
    .send({ error: { code: "INTERNAL", message: "Internal server error" } });
};
