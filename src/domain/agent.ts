import { z } from "zod";

export const AgentContextSchema = z
  .object({
    currentStartupId: z.string().min(1).optional(),
    currentStartupName: z.string().min(1).optional(),
    currentPortfolioCompanyId: z.string().min(1).optional(),
    currentDealId: z.string().min(1).optional(),
    currentBoardId: z.string().min(1).optional(),
    selectedDocumentId: z.string().min(1).optional(),
  })
  .strict();

export type AgentContext = z.infer<typeof AgentContextSchema>;

export const CoreToolNameSchema = z.enum([
  "search_startups",
  "read_startup_notes",
  "list_portfolio_signals",
  "build_board_prep_context",
]);

export type CoreToolName = z.infer<typeof CoreToolNameSchema>;

export type AgentToolCall = {
  toolName: CoreToolName;
  arguments: Record<string, unknown>;
};

export type AgentToolResult = {
  toolName: CoreToolName;
  output: unknown;
};
