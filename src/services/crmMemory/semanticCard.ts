import type { CrmMemorySemanticLlm } from "./semanticLlm.js";
import type { NoteIndexingContext } from "../../domain/crmMemory.js";
import { buildSemanticCardSystemPrompt } from "../../prompts/crmMemory/prompts.js";
import {
  CrmMemorySemanticCardSchema,
  type CrmMemorySemanticCardOutput,
} from "../../prompts/crmMemory/semanticCardSchema.js";

export const buildSemanticCardGenerator = (deps: {
  llm: CrmMemorySemanticLlm;
}) => {
  const { llm } = deps;
  const system = buildSemanticCardSystemPrompt();

  return {
    generateSemanticCard: async (
      context: NoteIndexingContext,
    ): Promise<CrmMemorySemanticCardOutput> => {
      const userPayload = {
        startup: context.startup,
        note: {
          id: context.note.id,
          authorEmail: context.note.authorEmail,
          createdAt: context.note.createdAt,
          sensitivity: context.note.sensitivity,
          body: context.note.body,
        },
      };

      return llm.provider.generateStructured({
        model: llm.model,
        ...(llm.reasoningEffort !== undefined
          ? { reasoningEffort: llm.reasoningEffort }
          : {}),
        schemaName: "CrmMemorySemanticCard",
        schema: CrmMemorySemanticCardSchema,
        system,
        user: JSON.stringify(userPayload, null, 2),
        maxTokens: 1800,
      });
    },
  };
};

export type SemanticCardGenerator = ReturnType<typeof buildSemanticCardGenerator>;
