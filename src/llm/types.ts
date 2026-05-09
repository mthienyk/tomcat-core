import type { z, ZodTypeAny } from "zod";

export type LlmProviderName = "anthropic" | "openai" | "google";

export type LlmMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type LlmStructuredRequest<TSchema extends ZodTypeAny> = {
  model: string | undefined;
  schemaName: string;
  schema: TSchema;
  system: string;
  user: string;
  maxTokens?: number;
};

export interface LlmProvider {
  readonly name: LlmProviderName;
  generateStructured<TSchema extends ZodTypeAny>(
    req: LlmStructuredRequest<TSchema>,
  ): Promise<z.infer<TSchema>>;
}

export type LlmRegistry = {
  defaultProvider(): LlmProvider;
  getProvider(name: LlmProviderName): LlmProvider;
  hasAnyProvider(): boolean;
  listProviders(): LlmProviderName[];
};

export const ProviderConfigSchema = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google Gemini",
} as const satisfies Record<LlmProviderName, string>;
