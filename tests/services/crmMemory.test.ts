import { describe, expect, it } from "vitest";
import { noteContentHash } from "../../src/services/crmMemory/contentHash.js";
import { buildSemanticCardSystemPrompt } from "../../src/prompts/crmMemory/prompts.js";
import { resolveCrmMemorySemanticLlm } from "../../src/services/crmMemory/semanticLlm.js";
import { buildLlmRegistry } from "../../src/llm/registry.js";
import type { AppConfig } from "../../src/config/env.js";

const baseConfig = (overrides?: Partial<AppConfig["crmMemory"]>): AppConfig =>
  ({
    llm: {
      openaiApiKey: "test-openai",
      anthropicApiKey: undefined,
      googleGenerativeAiApiKey: undefined,
      defaultProvider: "openai",
      defaultModel: "claude-sonnet-4-6",
    },
    crmMemory: {
      indexEnabled: true,
      indexBatchSize: 20,
      indexConcurrency: 20,
      indexIntervalMs: 30_000,
      embeddingModel: "text-embedding-3-small",
      embeddingDimensions: 1536,
      semanticProvider: undefined,
      semanticModel: undefined,
      reasoningEffort: "minimal",
      ...overrides,
    },
  }) as AppConfig;

describe("crmMemory contentHash", () => {
  it("is stable for the same body and changes when body changes", () => {
    const first = noteContentHash("M1 — strong team");
    const second = noteContentHash("M1 — strong team");
    const third = noteContentHash("M1 — weak team");

    expect(first).toBe(second);
    expect(first).not.toBe(third);
  });
});

describe("crmMemory prompt", () => {
  it("builds a semantic card system prompt with the inline Favikon example", () => {
    const prompt = buildSemanticCardSystemPrompt();
    expect(prompt).toContain("Tomcat CRM memory context");
    expect(prompt).toContain("Favikon");
    expect(prompt).toContain("investmentLens");
  });
});

describe("resolveCrmMemorySemanticLlm", () => {
  it("defaults to gpt-5-mini on OpenAI with minimal reasoning", () => {
    const registry = buildLlmRegistry(baseConfig());
    const llm = resolveCrmMemorySemanticLlm(baseConfig(), registry);
    expect(llm.provider.name).toBe("openai");
    expect(llm.model).toBe("gpt-5-mini");
    expect(llm.reasoningEffort).toBe("minimal");
  });

  it("honors explicit semantic model override", () => {
    const config = baseConfig({ semanticModel: "gpt-5.4-nano" });
    const registry = buildLlmRegistry(config);
    const llm = resolveCrmMemorySemanticLlm(config, registry);
    expect(llm.model).toBe("gpt-5.4-nano");
  });
});
