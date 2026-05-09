import Anthropic from "@anthropic-ai/sdk";
import type { ZodTypeAny } from "zod";
import { LlmFailed } from "../../errors/index.js";
import type {
  LlmAgentMessage,
  LlmAgentStepRequest,
  LlmAgentStepResult,
  LlmProvider,
  LlmStopReason,
  LlmStructuredRequest,
} from "../types.js";
import {
  parseStructuredOutput,
  structuredOutputInstruction,
} from "../structured.js";

const DEFAULT_MODEL = "claude-sonnet-4-6";

const STOP_REASON_MAP: Record<string, LlmStopReason> = {
  end_turn: "end_turn",
  tool_use: "tool_use",
  max_tokens: "max_tokens",
};

const toAnthropicMessage = (
  message: LlmAgentMessage,
): Anthropic.MessageParam => {
  if (message.role === "user") {
    return { role: "user", content: message.content };
  }

  if (message.role === "assistant") {
    const blocks: Array<Anthropic.TextBlockParam | Anthropic.ToolUseBlockParam> = [];
    if (message.content.length > 0) {
      blocks.push({ type: "text", text: message.content });
    }
    for (const use of message.toolUses) {
      blocks.push({
        type: "tool_use",
        id: use.id,
        name: use.name,
        input: (use.input ?? {}) as Record<string, unknown>,
      });
    }
    return { role: "assistant", content: blocks };
  }

  return {
    role: "user",
    content: message.results.map((result) => ({
      type: "tool_result",
      tool_use_id: result.toolUseId,
      content: result.content,
      is_error: result.isError,
    })),
  };
};

export const createAnthropicProvider = (apiKey: string): LlmProvider => {
  const client = new Anthropic({ apiKey });
  return {
    name: "anthropic",
    generateStructured: async <TSchema extends ZodTypeAny>(
      req: LlmStructuredRequest<TSchema>,
    ) => {
      try {
        const resp = await client.messages.create({
          model: req.model ?? DEFAULT_MODEL,
          max_tokens: req.maxTokens ?? 1024,
          system: `${req.system}\n\n${structuredOutputInstruction(req.schemaName)}`,
          messages: [{ role: "user", content: req.user }],
        });
        const text = resp.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("");
        if (!text) throw LlmFailed("Empty response from Anthropic");
        return parseStructuredOutput(req.schema, text);
      } catch (err) {
        if (err instanceof Error && err.name === "CoreError") throw err;
        throw LlmFailed("Anthropic call failed", {
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
    runAgentStep: async (
      req: LlmAgentStepRequest,
    ): Promise<LlmAgentStepResult> => {
      try {
        const resp = await client.messages.create({
          model: req.model ?? DEFAULT_MODEL,
          max_tokens: req.maxTokens ?? 1500,
          system: req.system,
          tools: req.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
          })),
          messages: req.messages.map(toAnthropicMessage),
        });

        const text = resp.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("");

        const toolUses = resp.content
          .filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
          .map((b) => ({ id: b.id, name: b.name, input: b.input }));

        const stopReason: LlmStopReason =
          (resp.stop_reason && STOP_REASON_MAP[resp.stop_reason]) ?? "other";

        return { text, toolUses, stopReason };
      } catch (err) {
        if (err instanceof Error && err.name === "CoreError") throw err;
        throw LlmFailed("Anthropic agent step failed", {
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
  };
};
