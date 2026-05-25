import OpenAI from "openai";
import type { ZodTypeAny } from "zod";
import { LlmFailed } from "../../errors/index.js";
import type {
  LlmAgentMessage,
  LlmAgentStepRequest,
  LlmAgentStepResult,
  LlmAssistantToolUse,
  LlmProvider,
  LlmStopReason,
  LlmStructuredRequest,
} from "../types.js";
import { zodResponseFormat } from "openai/helpers/zod";

const DEFAULT_MODEL = "gpt-5.5";

type OpenAIInputItem = OpenAI.Responses.ResponseInputItem;

const toResponseInput = (messages: LlmAgentMessage[]): OpenAIInputItem[] => {
  const items: OpenAIInputItem[] = [];

  for (const message of messages) {
    if (message.role === "user") {
      items.push({ role: "user", content: message.content });
      continue;
    }

    if (message.role === "assistant") {
      if (message.content.length > 0) {
        items.push({ role: "assistant", content: message.content });
      }
      for (const use of message.toolUses) {
        items.push({
          type: "function_call",
          call_id: use.id,
          name: use.name,
          arguments: JSON.stringify(use.input ?? {}),
        });
      }
      continue;
    }

    for (const result of message.results) {
      items.push({
        type: "function_call_output",
        call_id: result.toolUseId,
        output: result.content,
      });
    }
  }

  return items;
};

const STATUS_TO_STOP: Record<string, LlmStopReason> = {
  completed: "end_turn",
  incomplete: "max_tokens",
};

const deriveStopReason = (
  status: string | undefined,
  toolUses: LlmAssistantToolUse[],
): LlmStopReason => {
  if (toolUses.length > 0) return "tool_use";
  if (!status) return "other";
  return STATUS_TO_STOP[status] ?? "other";
};

const extractTextAndToolUses = (
  resp: OpenAI.Responses.Response,
): { text: string; toolUses: LlmAssistantToolUse[] } => {
  const textParts: string[] = [];
  const toolUses: LlmAssistantToolUse[] = [];

  for (const item of resp.output) {
    if (item.type === "message" && item.role === "assistant") {
      for (const part of item.content) {
        if (part.type === "output_text") {
          textParts.push(part.text);
        }
      }
    } else if (item.type === "function_call") {
      let parsed: unknown = {};
      try {
        parsed = item.arguments ? JSON.parse(item.arguments) : {};
      } catch {
        parsed = { __raw: item.arguments };
      }
      toolUses.push({
        id: item.call_id,
        name: item.name,
        input: parsed,
      });
    }
  }

  return { text: textParts.join("").trim(), toolUses };
};

export const createOpenAIProvider = (apiKey: string): LlmProvider => {
  const client = new OpenAI({ apiKey });

  return {
    name: "openai",
    generateStructured: async <TSchema extends ZodTypeAny>(
      req: LlmStructuredRequest<TSchema>,
    ) => {
      try {
        const params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
          model: req.model ?? DEFAULT_MODEL,
          response_format: zodResponseFormat(req.schema, req.schemaName),
          max_completion_tokens: req.maxTokens ?? 1024,
          messages: [
            { role: "system", content: req.system },
            { role: "user", content: req.user },
          ],
        };
        if (req.reasoningEffort !== undefined) {
          // gpt-5* models accept "minimal"; OpenAI SDK types may lag the API.
          (params as { reasoning_effort?: string }).reasoning_effort =
            req.reasoningEffort;
        }

        const resp = await client.beta.chat.completions.parse(params);
        const parsed = resp.choices[0]?.message?.parsed;
        if (parsed) {
          return parsed;
        }
        const refusal = resp.choices[0]?.message?.refusal;
        throw LlmFailed(
          refusal ?? "OpenAI structured output did not match schema",
        );
      } catch (err) {
        if (err instanceof Error && err.name === "CoreError") throw err;
        throw LlmFailed("OpenAI call failed", {
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
    runAgentStep: async (
      req: LlmAgentStepRequest,
    ): Promise<LlmAgentStepResult> => {
      try {
        const resp = await client.responses.create({
          model: req.model ?? DEFAULT_MODEL,
          instructions: req.system,
          input: toResponseInput(req.messages),
          max_output_tokens: req.maxTokens ?? 1500,
          tools: req.tools.map((tool) => ({
            type: "function",
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema,
            strict: false,
          })),
          tool_choice: "auto",
          parallel_tool_calls: true,
        });

        const { text, toolUses } = extractTextAndToolUses(resp);
        const stopReason = deriveStopReason(resp.status, toolUses);

        return { text, toolUses, stopReason };
      } catch (err) {
        if (err instanceof Error && err.name === "CoreError") throw err;
        throw LlmFailed("OpenAI agent step failed", {
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
  };
};
