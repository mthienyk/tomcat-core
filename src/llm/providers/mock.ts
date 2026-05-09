import type { ZodTypeAny } from "zod";
import type { LlmProvider, LlmStructuredRequest } from "../types.js";
import { parseStructuredOutput } from "../structured.js";

export type MockResponder = <TSchema extends ZodTypeAny>(
  req: LlmStructuredRequest<TSchema>,
) => string;

export const createMockProvider = (responder: MockResponder): LlmProvider => ({
  name: "anthropic",
  generateStructured: async (req) =>
    parseStructuredOutput(req.schema, responder(req)),
});
