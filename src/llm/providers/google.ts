import type { ZodTypeAny } from "zod";
import { LlmFailed } from "../../errors/index.js";
import type {
  LlmAgentMessage,
  LlmAgentStepRequest,
  LlmAgentStepResult,
  LlmAssistantToolUse,
  LlmJsonSchema,
  LlmProvider,
  LlmStopReason,
  LlmStructuredRequest,
} from "../types.js";
import {
  parseStructuredOutput,
  structuredOutputInstruction,
} from "../structured.js";

const DEFAULT_MODEL = "gemini-3.1-pro-preview";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

const FINISH_TO_STOP: Record<string, LlmStopReason> = {
  STOP: "end_turn",
  MAX_TOKENS: "max_tokens",
};

type GeminiFunctionCallPart = {
  functionCall: { id?: string; name: string; args: Record<string, unknown> };
  thoughtSignature?: string;
};

type GeminiTextPart = { text: string; thoughtSignature?: string };

type GeminiFunctionResponsePart = {
  functionResponse: {
    id?: string;
    name: string;
    response: Record<string, unknown>;
  };
};

type GeminiPart =
  | GeminiTextPart
  | GeminiFunctionCallPart
  | GeminiFunctionResponsePart;

type GeminiContent = {
  role: "user" | "model";
  parts: GeminiPart[];
};

type GeminiCandidate = {
  content?: { role?: string; parts?: GeminiPart[] };
  finishReason?: string;
};

type GeminiResponse = {
  candidates?: GeminiCandidate[];
  promptFeedback?: { blockReason?: string };
};

const sanitizeForGemini = (schema: LlmJsonSchema): Record<string, unknown> => {
  const drop = new Set([
    "$schema",
    "additionalProperties",
    "$ref",
    "definitions",
    "$defs",
  ]);
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(visit);
    if (value && typeof value === "object") {
      const src = value as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      const isInteger = src["type"] === "integer";
      for (const [k, v] of Object.entries(src)) {
        if (drop.has(k)) continue;
        if (k === "exclusiveMinimum" && typeof v === "number") {
          if (out["minimum"] === undefined) {
            out["minimum"] = isInteger ? v + 1 : v;
          }
          continue;
        }
        if (k === "exclusiveMaximum" && typeof v === "number") {
          if (out["maximum"] === undefined) {
            out["maximum"] = isInteger ? v - 1 : v;
          }
          continue;
        }
        out[k] = visit(v);
      }
      return out;
    }
    return value;
  };
  return visit(schema) as Record<string, unknown>;
};

const toGeminiContents = (
  messages: LlmAgentMessage[],
): GeminiContent[] => {
  const toolNameByUseId = new Map<string, string>();
  const contents: GeminiContent[] = [];

  for (const message of messages) {
    if (message.role === "user") {
      contents.push({ role: "user", parts: [{ text: message.content }] });
      continue;
    }

    if (message.role === "assistant") {
      const parts: GeminiPart[] = [];
      if (message.content.length > 0) parts.push({ text: message.content });
      for (const use of message.toolUses) {
        toolNameByUseId.set(use.id, use.name);
        const args =
          use.input && typeof use.input === "object" && !Array.isArray(use.input)
            ? (use.input as Record<string, unknown>)
            : {};
        const part: GeminiFunctionCallPart = {
          functionCall: { id: use.id, name: use.name, args },
        };
        const sig = use.providerMetadata?.["thoughtSignature"];
        if (typeof sig === "string" && sig.length > 0) {
          part.thoughtSignature = sig;
        }
        parts.push(part);
      }
      if (parts.length > 0) contents.push({ role: "model", parts });
      continue;
    }

    const parts: GeminiPart[] = message.results.map((result) => {
      const name = toolNameByUseId.get(result.toolUseId) ?? "unknown_tool";
      let payload: Record<string, unknown>;
      try {
        const parsed = JSON.parse(result.content) as unknown;
        payload =
          parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : { result: parsed };
      } catch {
        payload = { result: result.content };
      }
      if (result.isError) payload = { error: payload };
      return {
        functionResponse: { id: result.toolUseId, name, response: payload },
      };
    });
    contents.push({ role: "user", parts });
  }

  return contents;
};

const extractFromResponse = (
  body: GeminiResponse,
): { text: string; toolUses: LlmAssistantToolUse[]; finishReason?: string } => {
  const candidate = body.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];
  const textParts: string[] = [];
  const toolUses: LlmAssistantToolUse[] = [];

  for (const part of parts) {
    if ("text" in part && part.text) textParts.push(part.text);
    else if ("functionCall" in part) {
      const id =
        part.functionCall.id ??
        `call_${Math.random().toString(36).slice(2, 10)}`;
      const sig = (part as GeminiFunctionCallPart).thoughtSignature;
      const use: LlmAssistantToolUse = {
        id,
        name: part.functionCall.name,
        input: part.functionCall.args ?? {},
      };
      if (typeof sig === "string" && sig.length > 0) {
        use.providerMetadata = { thoughtSignature: sig };
      }
      toolUses.push(use);
    }
  }

  return {
    text: textParts.join("").trim(),
    toolUses,
    ...(candidate?.finishReason !== undefined
      ? { finishReason: candidate.finishReason }
      : {}),
  };
};

export const createGoogleProvider = (apiKey: string): LlmProvider => ({
  name: "google",
  generateStructured: async <TSchema extends ZodTypeAny>(
    req: LlmStructuredRequest<TSchema>,
  ) => {
    const model = req.model ?? DEFAULT_MODEL;
    const endpoint = new URL(`${GEMINI_BASE}/models/${model}:generateContent`);
    endpoint.searchParams.set("key", apiKey);

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          generationConfig: {
            maxOutputTokens: req.maxTokens ?? 1024,
            responseMimeType: "application/json",
          },
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: `${req.system}\n\n${structuredOutputInstruction(
                    req.schemaName,
                  )}\n\n${req.user}`,
                },
              ],
            },
          ],
        }),
      });

      if (!response.ok) {
        throw LlmFailed("Google Gemini call failed", {
          status: response.status,
          statusText: response.statusText,
        });
      }

      const body = (await response.json()) as GeminiResponse;
      const text =
        body.candidates?.[0]?.content?.parts
          ?.map((part) => ("text" in part ? (part.text ?? "") : ""))
          .join("") ?? "";
      if (!text) throw LlmFailed("Empty response from Google Gemini");
      return parseStructuredOutput(req.schema, text);
    } catch (err) {
      if (err instanceof Error && err.name === "CoreError") throw err;
      throw LlmFailed("Google Gemini call failed", {
        message: err instanceof Error ? err.message : String(err),
      });
    }
  },
  runAgentStep: async (
    req: LlmAgentStepRequest,
  ): Promise<LlmAgentStepResult> => {
    const model = req.model ?? DEFAULT_MODEL;
    const endpoint = new URL(`${GEMINI_BASE}/models/${model}:generateContent`);
    endpoint.searchParams.set("key", apiKey);

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { role: "system", parts: [{ text: req.system }] },
          generationConfig: { maxOutputTokens: req.maxTokens ?? 1500 },
          contents: toGeminiContents(req.messages),
          tools: [
            {
              functionDeclarations: req.tools.map((tool) => ({
                name: tool.name,
                description: tool.description,
                parameters: sanitizeForGemini(tool.inputSchema),
              })),
            },
          ],
          toolConfig: { functionCallingConfig: { mode: "AUTO" } },
        }),
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw LlmFailed("Google Gemini agent step failed", {
          status: response.status,
          statusText: response.statusText,
          body: detail.slice(0, 500),
        });
      }

      const body = (await response.json()) as GeminiResponse;
      const { text, toolUses, finishReason } = extractFromResponse(body);
      const mapped = finishReason ? FINISH_TO_STOP[finishReason] : undefined;
      const stopReason: LlmStopReason =
        toolUses.length > 0 ? "tool_use" : mapped ?? "other";

      return { text, toolUses, stopReason };
    } catch (err) {
      if (err instanceof Error && err.name === "CoreError") throw err;
      throw LlmFailed("Google Gemini agent step failed", {
        message: err instanceof Error ? err.message : String(err),
      });
    }
  },
});
