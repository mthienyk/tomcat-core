import type { AppConfig } from "../../config/env.js";
import type {
  LlmProvider,
  LlmProviderName,
  LlmRegistry,
} from "../../llm/types.js";

export type CrmMemoryReasoningEffort = "minimal" | "low" | "medium" | "high";

export type CrmMemorySemanticLlm = {
  provider: LlmProvider;
  model: string;
  reasoningEffort: CrmMemoryReasoningEffort | undefined;
};

const defaultSemanticModel = (
  provider: LlmProviderName,
  config: AppConfig,
): string => {
  if (config.crmMemory.semanticModel) {
    return config.crmMemory.semanticModel;
  }
  if (provider === "openai") {
    return "gpt-5-mini";
  }
  return config.llm.defaultModel;
};

export const resolveCrmMemorySemanticLlm = (
  config: AppConfig,
  registry: LlmRegistry,
): CrmMemorySemanticLlm => {
  const providerName: LlmProviderName =
    config.crmMemory.semanticProvider ??
    (config.llm.openaiApiKey ? "openai" : config.llm.defaultProvider);

  const provider = registry.getProvider(providerName);
  const model = defaultSemanticModel(providerName, config);
  const reasoningEffort =
    providerName === "openai"
      ? config.crmMemory.reasoningEffort
      : undefined;

  return { provider, model, reasoningEffort };
};
