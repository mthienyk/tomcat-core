import { BadRequest } from "../errors/index.js";
import type { Identity } from "../domain/identity.js";
import type { AgentContext, AgentToolCall, AgentToolResult } from "../domain/agent.js";
import { runAgentLoop } from "../agent/agentLoop.js";
import type { LlmProviderName, LlmRegistry, LlmStopReason } from "../llm/types.js";
import type { Auditor } from "../audit/audit.js";
import type { StartupsService } from "./startups.js";
import type { BriefsService } from "./briefs.js";
import type { CompanyContextService } from "./companyContext.js";
import type { SocietyService } from "./society.js";

export type AiQueryResult = {
  provider: LlmProviderName;
  finalText: string;
  steps: number;
  stopReason: LlmStopReason;
  toolCalls: AgentToolCall[];
  toolResults: AgentToolResult[];
  approvalsRequested: { toolName: string; reason: string }[];
  unknownToolsRequested: string[];
};

export type AiServiceDeps = {
  llmRegistry: LlmRegistry;
  startups: StartupsService;
  briefs: BriefsService;
  society: SocietyService;
  companyContext: CompanyContextService;
  auditor: Auditor;
};

export const buildAiService = (deps: AiServiceDeps) => ({
  query: async (
    caller: Identity,
    input: {
      text: string;
      provider: LlmProviderName | undefined;
      model: string | undefined;
      context: AgentContext | undefined;
    },
  ): Promise<AiQueryResult> => {
    const { text, provider, model, context } = input;
    if (!text || text.length < 3) {
      throw BadRequest("Query text too short");
    }

    const llm = provider
      ? deps.llmRegistry.getProvider(provider)
      : deps.llmRegistry.defaultProvider();

    const result = await runAgentLoop({
      provider: llm,
      services: {
        startups: deps.startups,
        briefs: deps.briefs,
        society: deps.society,
        companyContext: deps.companyContext,
      },
      caller,
      auditor: deps.auditor,
      text,
      ...(model !== undefined ? { modelOverride: model } : {}),
      ...(context !== undefined ? { context } : {}),
    });

    deps.auditor.record(caller, {
      action: "ai.query",
      resource: "/ai/query",
      outcome: "allowed",
      reason: undefined,
      meta: {
        provider: llm.name,
        steps: result.steps,
        stopReason: result.stopReason,
        toolCallCount: result.toolCalls.length,
        approvalsRequested: result.approvalsRequested.length,
        unknownToolsRequested: result.unknownToolsRequested.length,
      },
    });

    return {
      provider: llm.name,
      finalText: result.finalText,
      steps: result.steps,
      stopReason: result.stopReason,
      toolCalls: result.toolCalls.map(({ toolName, arguments: args }) => ({
        toolName,
        arguments: args,
      })),
      toolResults: result.toolResults.map(({ toolName, output }) => ({
        toolName,
        output,
      })),
      approvalsRequested: result.approvalsRequested,
      unknownToolsRequested: result.unknownToolsRequested,
    };
  },
});

export type AiService = ReturnType<typeof buildAiService>;
