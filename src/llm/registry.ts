import type { AppConfig } from "../config/env.js";
import { LlmFailed } from "../errors/index.js";
import { createAnthropicProvider } from "./providers/anthropic.js";
import { createGoogleProvider } from "./providers/google.js";
import { createOpenAIProvider } from "./providers/openai.js";
import type { LlmProvider, LlmProviderName, LlmRegistry } from "./types.js";

export const buildLlmRegistry = (config: AppConfig): LlmRegistry => {
  const providers = new Map<LlmProviderName, LlmProvider>();

  if (config.llm.anthropicApiKey) {
    providers.set("anthropic", createAnthropicProvider(config.llm.anthropicApiKey));
  }
  if (config.llm.openaiApiKey) {
    providers.set("openai", createOpenAIProvider(config.llm.openaiApiKey));
  }
  if (config.llm.googleGenerativeAiApiKey) {
    providers.set("google", createGoogleProvider(config.llm.googleGenerativeAiApiKey));
  }

  return {
    defaultProvider: () => {
      const provider = providers.get(config.llm.defaultProvider);
      if (!provider) {
        throw LlmFailed(
          `Default LLM provider "${config.llm.defaultProvider}" is not configured`,
        );
      }
      return provider;
    },
    getProvider: (name) => {
      const provider = providers.get(name);
      if (!provider) throw LlmFailed(`LLM provider "${name}" is not configured`);
      return provider;
    },
    hasAnyProvider: () => providers.size > 0,
    listProviders: () => [...providers.keys()],
  };
};
