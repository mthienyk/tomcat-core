import { z } from "zod";
import type { Auditor } from "../audit/audit.js";
import {
  CoreToolNameSchema,
  type AgentContext,
  type AgentToolCall,
  type AgentToolResult,
} from "../domain/agent.js";
import type { Identity } from "../domain/identity.js";
import type {
  LlmAgentMessage,
  LlmAgentStepResult,
  LlmProvider,
  LlmStopReason,
  LlmToolResult,
} from "../llm/types.js";
import {
  AGENT_TOOL_NAMES,
  buildLlmToolDefinitions,
  executeRegisteredAgentTool,
  findAgentToolDefinition,
  type AgentToolServices,
} from "./toolRegistry.js";

const SYSTEM_PROMPT = `You are Tomcat Core, the central AI assistant for Tomcat
(a startup accelerator and venture fund). Internal team members ask you to
navigate dealflow, portfolio, documents and signals.

Operating rules:
- Use the provided tools to fetch data; never invent ids, names, numbers or titles.
- Prefer ids from "Conversation context" over guessing or asking.
- If an id is missing and the request needs one, ask one short clarifying question.
- For dangerous mass exports or exfiltration, refuse in plain text without calling tools.
- Restricted tools cannot run in this turn: explain that approval is required and stop.
- Keep final answers concise, grounded in tool results, and cite sources where relevant.

Source discipline (critical):
- Each piece of data has a source and a date. Treat them as separate facts.
- A startup's "description" field reflects the most recent known positioning.
  Notes reflect the situation at the time they were written. If they disagree,
  flag the discrepancy explicitly (likely pivot, change of strategy, etc.).
- When you cite a note or a meeting, always state its date (e.g. "note du 16/02/2021").
  Never present an old note as if it were the current state.
- Do not infer roles or titles (founder, CEO, lead, owner, etc.) when the source
  only contains a bare name. List the names verbatim and label them as "personnes
  citées" or "participants" if the source does not specify a role.
- If a field is null or missing (e.g. stage = "unknown"), say "non renseigné"
  rather than picking a default. Do not guess.`;

const MAX_LOOP_STEPS = 6;
const MAX_OUTPUT_TOKENS = 1500;

const formatContext = (context: AgentContext | undefined): string => {
  if (!context) return "No conversation context provided.";
  const entries = Object.entries(context).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return "No conversation context provided.";
  return entries.map(([k, v]) => `- ${k}: ${String(v)}`).join("\n");
};

const buildOpeningUserMessage = (
  text: string,
  context: AgentContext | undefined,
): string =>
  ["Conversation context:", formatContext(context), "", "User request:", text].join(
    "\n",
  );

const stringifyToolOutput = (output: unknown): string => {
  try {
    return JSON.stringify(output);
  } catch {
    return String(output);
  }
};

export type AgentExecutedToolCall = AgentToolCall & {
  toolUseId: string;
  durationMs: number;
};

export type AgentExecutedToolResult = AgentToolResult & {
  toolUseId: string;
};

export type AgentLoopRequest = {
  provider: LlmProvider;
  services: AgentToolServices;
  caller: Identity;
  auditor: Auditor;
  text: string;
  modelOverride?: string;
  context?: AgentContext;
};

export type AgentLoopResult = {
  finalText: string;
  steps: number;
  stopReason: LlmStopReason;
  toolCalls: AgentExecutedToolCall[];
  toolResults: AgentExecutedToolResult[];
  approvalsRequested: { toolName: string; reason: string }[];
  unknownToolsRequested: string[];
};

export const runAgentLoop = async (
  req: AgentLoopRequest,
): Promise<AgentLoopResult> => {
  const tools = buildLlmToolDefinitions();
  const messages: LlmAgentMessage[] = [
    {
      role: "user",
      content: buildOpeningUserMessage(req.text, req.context),
    },
  ];

  const toolCalls: AgentExecutedToolCall[] = [];
  const toolResults: AgentExecutedToolResult[] = [];
  const approvalsRequested: { toolName: string; reason: string }[] = [];
  const unknownToolsRequested: string[] = [];

  let lastText = "";
  let lastStop: LlmStopReason = "other";
  let steps = 0;

  for (let i = 0; i < MAX_LOOP_STEPS; i += 1) {
    steps += 1;
    const step: LlmAgentStepResult = await req.provider.runAgentStep({
      model: req.modelOverride,
      system: SYSTEM_PROMPT,
      messages,
      tools,
      maxTokens: MAX_OUTPUT_TOKENS,
    });

    lastText = step.text;
    lastStop = step.stopReason;

    if (step.toolUses.length === 0) break;

    const toolResultsForStep: LlmToolResult[] = [];

    for (const use of step.toolUses) {
      const knownName = CoreToolNameSchema.safeParse(use.name);
      if (!knownName.success) {
        unknownToolsRequested.push(use.name);
        toolResultsForStep.push({
          toolUseId: use.id,
          content:
            `Unknown tool "${use.name}". Allowed tools: `
            + AGENT_TOOL_NAMES.join(", ")
            + ". Reply to the user without retrying this tool.",
          isError: true,
        });
        continue;
      }

      const toolDef = findAgentToolDefinition(use.name);
      if (!toolDef) {
        unknownToolsRequested.push(use.name);
        toolResultsForStep.push({
          toolUseId: use.id,
          content: `Tool "${use.name}" is not registered on this server.`,
          isError: true,
        });
        continue;
      }

      if (toolDef.approvalRequired) {
        const reason = `${toolDef.access} access requires explicit human approval`;
        approvalsRequested.push({ toolName: toolDef.name, reason });
        req.auditor.record(req.caller, {
          action: "ai.tool_call",
          resource: "/ai/query",
          outcome: "denied",
          reason: "approval_required",
          meta: {
            provider: req.provider.name,
            toolName: toolDef.name,
            access: toolDef.access,
          },
        });
        toolResultsForStep.push({
          toolUseId: use.id,
          content:
            `Tool "${toolDef.name}" requires human approval (access: `
            + `${toolDef.access}). Do not retry. Inform the user that approval `
            + "is required and explain what would be requested.",
          isError: true,
        });
        continue;
      }

      const argsInput =
        use.input && typeof use.input === "object" && !Array.isArray(use.input)
          ? (use.input as Record<string, unknown>)
          : {};
      const call: AgentToolCall = {
        toolName: knownName.data,
        arguments: argsInput,
      };

      const startedAt = Date.now();
      try {
        const result = await executeRegisteredAgentTool(
          req.services,
          req.caller,
          call,
        );
        const durationMs = Date.now() - startedAt;
        toolCalls.push({ ...call, toolUseId: use.id, durationMs });
        toolResults.push({ ...result, toolUseId: use.id });
        toolResultsForStep.push({
          toolUseId: use.id,
          content: stringifyToolOutput(result.output),
          isError: false,
        });
        req.auditor.record(req.caller, {
          action: "ai.tool_call",
          resource: "/ai/query",
          outcome: "allowed",
          reason: undefined,
          meta: {
            provider: req.provider.name,
            toolName: call.toolName,
            argumentKeys: Object.keys(call.arguments),
            durationMs,
          },
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "unknown_error";
        const code =
          error instanceof Error && "code" in error
            ? String((error as { code: unknown }).code)
            : "EXEC_FAILED";
        toolResultsForStep.push({
          toolUseId: use.id,
          content: `Tool execution failed (${code}): ${message}. `
            + "Decide whether to try a different tool or inform the user.",
          isError: true,
        });
        req.auditor.record(req.caller, {
          action: "ai.tool_call",
          resource: "/ai/query",
          outcome: "error",
          reason: "tool_execution_failed",
          meta: {
            provider: req.provider.name,
            toolName: call.toolName,
            argumentKeys: Object.keys(call.arguments),
            errorMessage: message,
          },
        });
      }
    }

    messages.push({
      role: "assistant",
      content: step.text,
      toolUses: step.toolUses,
    });
    messages.push({ role: "tool", results: toolResultsForStep });
  }

  return {
    finalText: lastText,
    steps,
    stopReason: lastStop,
    toolCalls,
    toolResults,
    approvalsRequested,
    unknownToolsRequested,
  };
};

export const AgentLoopRequestSchema = z.object({
  text: z.string().min(3).max(2000),
});
