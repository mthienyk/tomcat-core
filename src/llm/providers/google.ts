import type { ZodTypeAny } from "zod";
import { LlmFailed } from "../../errors/index.js";
import type { LlmProvider, LlmStructuredRequest } from "../types.js";
import {
  parseStructuredOutput,
  structuredOutputInstruction,
} from "../structured.js";

const DEFAULT_MODEL = "gemini-3.1-pro";

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
};

export const createGoogleProvider = (apiKey: string): LlmProvider => ({
  name: "google",
  generateStructured: async <TSchema extends ZodTypeAny>(
    req: LlmStructuredRequest<TSchema>,
  ) => {
    const model = req.model ?? DEFAULT_MODEL;
    const endpoint = new URL(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    );
    endpoint.searchParams.set("key", apiKey);

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          generationConfig: {
            maxOutputTokens: req.maxTokens ?? 1024,
            responseMimeType: "application/json",
          },
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: `${req.system}\n\n${structuredOutputInstruction(
                    req.schemaName,
                  )}\n\n${req.user}`,
                },
              ],
            },
          ],
        }),
      });

      if (!response.ok) {
        throw LlmFailed("Google Gemini call failed", {
          status: response.status,
          statusText: response.statusText,
        });
      }

      const body = (await response.json()) as GeminiResponse;
      const text =
        body.candidates?.[0]?.content?.parts
          ?.map((part) => part.text ?? "")
          .join("") ?? "";
      if (!text) throw LlmFailed("Empty response from Google Gemini");
      return parseStructuredOutput(req.schema, text);
    } catch (err) {
      if (err instanceof Error && err.name === "CoreError") throw err;
      throw LlmFailed("Google Gemini call failed", {
        message: err instanceof Error ? err.message : String(err),
      });
    }
  },
});
