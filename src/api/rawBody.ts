import { Readable } from "node:stream";
import type { FastifyInstance } from "fastify";

declare module "fastify" {
  interface FastifyRequest {
    rawBody?: string;
  }

  interface FastifyContextConfig {
    rawBody?: boolean;
  }
}

export const registerRawBodyHook = (app: FastifyInstance): void => {
  app.addHook("preParsing", async (request, _reply, payload) => {
    if (!request.routeOptions.config?.rawBody) {
      return payload;
    }

    const chunks: Buffer[] = [];
    for await (const chunk of payload) {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    }
    const raw = Buffer.concat(chunks).toString("utf8");
    request.rawBody = raw;
    return Readable.from([raw]);
  });
};
