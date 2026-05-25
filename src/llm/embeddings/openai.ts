import OpenAI from "openai";
import { LlmFailed } from "../../errors/index.js";
import type { EmbeddingProvider } from "./types.js";

const DEFAULT_MODEL = "text-embedding-3-small";
const DEFAULT_DIMENSIONS = 1536;

export const createOpenAiEmbeddingProvider = (
  apiKey: string,
  options?: { model?: string; dimensions?: number },
): EmbeddingProvider => {
  const client = new OpenAI({ apiKey });
  const model = options?.model ?? DEFAULT_MODEL;
  const dimensions = options?.dimensions ?? DEFAULT_DIMENSIONS;

  return {
    model,
    dimensions,
    embed: async (texts: string[]): Promise<number[][]> => {
      if (texts.length === 0) return [];
      try {
        const response = await client.embeddings.create({
          model,
          input: texts,
          dimensions,
        });
        return response.data
          .sort((left, right) => left.index - right.index)
          .map((row) => row.embedding);
      } catch (err) {
        throw LlmFailed("OpenAI embedding call failed", {
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
  };
};
