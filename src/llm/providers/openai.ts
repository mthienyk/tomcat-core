import OpenAI from "openai";
import type { ZodTypeAny } from "zod";
import { LlmFailed } from "../../errors/index.js";
import type { LlmProvider, LlmStructuredRequest } from "../types.js";
import {
  parseStructuredOutput,
  structuredOutputInstruction,
} from "../structured.js";

const DEFAULT_MODEL = "gpt-5.5";

export const createOpenAIProvider = (apiKey: string): LlmProvider => {
  const client = new OpenAI({ apiKey });
  return {
    name: "openai",
    generateStructured: async <TSchema extends ZodTypeAny>(
      req: LlmStructuredRequest<TSchema>,
    ) => {
      try {
        const resp = await client.chat.completions.create({
          model: req.model ?? DEFAULT_MODEL,
          response_format: { type: "json_object" },
          max_tokens: req.maxTokens ?? 1024,
          messages: [
            {
              role: "system",
              content: `${req.system}\n\n${structuredOutputInstruction(req.schemaName)}`,
            },
            { role: "user", content: req.user },
          ],
        });
        const text = resp.choices[0]?.message?.content ?? "";
        if (!text) throw LlmFailed("Empty response from OpenAI");
        return parseStructuredOutput(req.schema, text);
      } catch (err) {
        if (err instanceof Error && err.name === "CoreError") throw err;
        throw LlmFailed("OpenAI call failed", {
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
  };
};
