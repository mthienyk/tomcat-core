import { BadRequest } from "../errors/index.js";
import type { Identity } from "../domain/identity.js";
import type { AgentToolResult } from "../domain/agent.js";
import { planToolCalls } from "../agent/toolPlanner.js";
import { executeAgentTool } from "../agent/tools.js";
import type { LlmProviderName, LlmRegistry } from "../llm/types.js";
import type { Auditor } from "../audit/audit.js";
import type { StartupsService } from "./startups.js";
import type { BriefsService } from "./briefs.js";
import type { SocietyService } from "./society.js";

export type AiQueryResult = {
  provider: LlmProviderName;
  toolCalls: { toolName: string }[];
  toolResults: AgentToolResult[];
};

export type AiServiceDeps = {
  llmRegistry: LlmRegistry;
  startups: StartupsService;
  briefs: BriefsService;
  society: SocietyService;
  auditor: Auditor;
};

export const buildAiService = (deps: AiServiceDeps) => ({
  query: async (
    caller: Identity,
    input: {
      text: string;
      provider: LlmProviderName | undefined;
      model: string | undefined;
    },
  ): Promise<AiQueryResult> => {
    const { text, provider, model } = input;
    if (!text || text.length < 3) {
      throw BadRequest("Query text too short");
    }

    const llm = provider
      ? deps.llmRegistry.getProvider(provider)
      : deps.llmRegistry.defaultProvider();
    const plan = await planToolCalls(llm, text, model);
    deps.auditor.record(caller, {
      action: "ai.plan",
      resource: "/ai/query",
      outcome: "allowed",
      reason: undefined,
      meta: {
        provider: llm.name,
        toolCount: plan.toolCalls.length,
      },
    });

    const toolResults: AgentToolResult[] = [];
    for (const call of plan.toolCalls) {
      try {
        const result = await executeAgentTool(
          {
            startups: deps.startups,
            briefs: deps.briefs,
            society: deps.society,
          },
          caller,
          call,
        );
        toolResults.push(result);
        deps.auditor.record(caller, {
          action: "ai.tool_call",
          resource: "/ai/query",
          outcome: "allowed",
          reason: undefined,
          meta: {
            provider: llm.name,
            toolName: call.toolName,
            argumentKeys: Object.keys(call.arguments),
          },
        });
      } catch (error) {
        deps.auditor.record(caller, {
          action: "ai.tool_call",
          resource: "/ai/query",
          outcome: "error",
          reason: "tool_execution_failed",
          meta: {
            provider: llm.name,
            toolName: call.toolName,
            argumentKeys: Object.keys(call.arguments),
            errorMessage:
              error instanceof Error ? error.message : "unknown_error",
          },
        });
        throw error;
      }
    }

    return {
      provider: llm.name,
      toolCalls: plan.toolCalls.map((call) => ({ toolName: call.toolName })),
      toolResults,
    };
  },
});

export type AiService = ReturnType<typeof buildAiService>;
