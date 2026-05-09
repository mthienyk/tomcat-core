import type { ZodTypeAny } from "zod";
import type {
  LlmAgentStepRequest,
  LlmAgentStepResult,
  LlmProvider,
  LlmProviderName,
  LlmStructuredRequest,
} from "../types.js";
import { parseStructuredOutput } from "../structured.js";

export type MockStructuredResponder = <TSchema extends ZodTypeAny>(
  req: LlmStructuredRequest<TSchema>,
) => string;

export type MockAgentResponder = (
  req: LlmAgentStepRequest,
  callIndex: number,
) => LlmAgentStepResult;

export type MockProviderOptions = {
  name?: LlmProviderName;
  structured?: MockStructuredResponder;
  agent?: MockAgentResponder;
};

export const createMockProvider = (
  options: MockProviderOptions = {},
): LlmProvider => {
  let agentCallIndex = 0;
  return {
    name: options.name ?? "anthropic",
    generateStructured: async (req) => {
      if (!options.structured) {
        throw new Error("MockProvider: no structured responder configured");
      }
      return parseStructuredOutput(req.schema, options.structured(req));
    },
    runAgentStep: async (req) => {
      if (!options.agent) {
        throw new Error("MockProvider: no agent responder configured");
      }
      const result = options.agent(req, agentCallIndex);
      agentCallIndex += 1;
      return result;
    },
  };
};
