import type { FastifyRequest } from "fastify";
import type { Identity } from "../domain/identity.js";

export interface IdentityResolver {
  readonly name: string;
  resolve(req: FastifyRequest): Promise<Identity | undefined>;
}
