import type { z, ZodTypeAny } from "zod";

export type LlmProviderName = "anthropic" | "openai" | "google";

export type LlmMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type LlmReasoningEffort = "minimal" | "low" | "medium" | "high";

export type LlmStructuredRequest<TSchema extends ZodTypeAny> = {
  model: string | undefined;
  schemaName: string;
  schema: TSchema;
  system: string;
  user: string;
  maxTokens?: number;
  reasoningEffort?: LlmReasoningEffort;
};

export type LlmJsonSchema = Record<string, unknown>;

export type LlmTool = {
  name: string;
  description: string;
  inputSchema: LlmJsonSchema;
};

export type LlmAssistantToolUse = {
  id: string;
  name: string;
  input: unknown;
  providerMetadata?: Record<string, unknown>;
};

export type LlmToolResult = {
  toolUseId: string;
  content: string;
  isError: boolean;
};

export type LlmAgentMessage =
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content: string;
      toolUses: LlmAssistantToolUse[];
    }
  | { role: "tool"; results: LlmToolResult[] };

export type LlmStopReason = "end_turn" | "tool_use" | "max_tokens" | "other";

export type LlmAgentStepRequest = {
  model: string | undefined;
  system: string;
  messages: LlmAgentMessage[];
  tools: LlmTool[];
  maxTokens?: number;
};

export type LlmAgentStepResult = {
  text: string;
  toolUses: LlmAssistantToolUse[];
  stopReason: LlmStopReason;
};

export interface LlmProvider {
  readonly name: LlmProviderName;
  generateStructured<TSchema extends ZodTypeAny>(
    req: LlmStructuredRequest<TSchema>,
  ): Promise<z.infer<TSchema>>;
  runAgentStep(req: LlmAgentStepRequest): Promise<LlmAgentStepResult>;
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
