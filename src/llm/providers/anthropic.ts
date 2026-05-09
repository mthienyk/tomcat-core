import Anthropic from "@anthropic-ai/sdk";
import type { ZodTypeAny } from "zod";
import { LlmFailed } from "../../errors/index.js";
import type { LlmProvider, LlmStructuredRequest } from "../types.js";
import {
  parseStructuredOutput,
  structuredOutputInstruction,
} from "../structured.js";

const DEFAULT_MODEL = "claude-sonnet-4-6";

export const createAnthropicProvider = (apiKey: string): LlmProvider => {
  const client = new Anthropic({ apiKey });
  return {
    name: "anthropic",
    generateStructured: async <TSchema extends ZodTypeAny>(
      req: LlmStructuredRequest<TSchema>,
    ) => {
      try {
        const resp = await client.messages.create({
          model: req.model ?? DEFAULT_MODEL,
          max_tokens: req.maxTokens ?? 1024,
          system: `${req.system}\n\n${structuredOutputInstruction(req.schemaName)}`,
          messages: [{ role: "user", content: req.user }],
        });
        const text = resp.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("");
        if (!text) throw LlmFailed("Empty response from Anthropic");
        return parseStructuredOutput(req.schema, text);
      } catch (err) {
        if (err instanceof Error && err.name === "CoreError") throw err;
        throw LlmFailed("Anthropic call failed", {
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
  };
};
