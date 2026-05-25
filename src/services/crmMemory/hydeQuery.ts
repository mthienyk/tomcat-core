import type { Startup } from "../../domain/entities.js";
import type { CrmMemorySemanticLlm } from "./semanticLlm.js";
import { buildHydeSystemPrompt } from "../../prompts/crmMemory/prompts.js";
import {
  CrmMemoryHydeQuerySchema,
  type CrmMemoryHydeQueryOutput,
} from "../../prompts/crmMemory/semanticCardSchema.js";

export type HydeInput =
  | {
      mode: "startup_profile";
      startup: Startup;
      recentNoteExcerpt?: string | undefined;
    }
  | {
      mode: "free_text";
      query: string;
    };

export const buildHydeQueryGenerator = (deps: { llm: CrmMemorySemanticLlm }) => {
  const { llm } = deps;

  return {
    generateHydeQueries: async (
      input: HydeInput,
    ): Promise<CrmMemoryHydeQueryOutput> => {
      const userPayload =
        input.mode === "startup_profile"
          ? {
              referenceStartup: {
                id: input.startup.id,
                name: input.startup.name,
                sectors: input.startup.sectors,
                stage: input.startup.stage,
                country: input.startup.country,
                description: input.startup.description,
              },
              recentNoteExcerpt: input.recentNoteExcerpt,
            }
          : { query: input.query };

      return llm.provider.generateStructured({
        model: llm.model,
        ...(llm.reasoningEffort !== undefined
          ? { reasoningEffort: llm.reasoningEffort }
          : {}),
        schemaName: "CrmMemoryHydeQuery",
        schema: CrmMemoryHydeQuerySchema,
        system: buildHydeSystemPrompt(),
        user: JSON.stringify(userPayload, null, 2),
        maxTokens: 900,
      });
    },
  };
};

export type HydeQueryGenerator = ReturnType<typeof buildHydeQueryGenerator>;
