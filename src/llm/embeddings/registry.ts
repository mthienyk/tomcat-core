import type { AppConfig } from "../../config/env.js";
import { createOpenAiEmbeddingProvider } from "./openai.js";
import type { EmbeddingRegistry } from "./types.js";

export const buildEmbeddingRegistry = (config: AppConfig): EmbeddingRegistry => {
  const provider = config.llm.openaiApiKey
    ? createOpenAiEmbeddingProvider(config.llm.openaiApiKey, {
        model: config.crmMemory.embeddingModel,
        dimensions: config.crmMemory.embeddingDimensions,
      })
    : undefined;

  return {
    defaultProvider: () => provider,
  };
};
