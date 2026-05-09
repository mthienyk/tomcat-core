import type { z, ZodTypeAny } from "zod";
import { LlmFailed } from "../errors/index.js";

export const extractJsonObject = (raw: string): unknown => {
  const trimmed = raw.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw LlmFailed("LLM did not return a JSON object");
  }

  try {
    return JSON.parse(trimmed.slice(start, end + 1));
  } catch (err) {
    throw LlmFailed("LLM returned malformed JSON", {
      message: err instanceof Error ? err.message : String(err),
    });
  }
};

export const parseStructuredOutput = <TSchema extends ZodTypeAny>(
  schema: TSchema,
  raw: string,
): z.infer<TSchema> => {
  const parsed = extractJsonObject(raw);
  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw LlmFailed("LLM output failed schema validation", {
      issues: result.error.issues,
    });
  }
  return result.data;
};

export const structuredOutputInstruction = (schemaName: string): string =>
  `Return only one JSON object matching the requested schema "${schemaName}". No prose, no markdown, no code fences.`;
