import { z } from "zod";

export const CoreToolNameSchema = z.enum([
  "search_startups",
  "read_startup_notes",
  "list_portfolio_signals",
  "build_board_prep_context",
]);

export type CoreToolName = z.infer<typeof CoreToolNameSchema>;

export const AgentToolCallSchema = z.object({
  toolName: CoreToolNameSchema,
  arguments: z.record(z.unknown()).default({}),
});

export type AgentToolCall = z.infer<typeof AgentToolCallSchema>;

export const AgentPlanSchema = z.object({
  reasoning: z.string().min(1).max(800),
  toolCalls: z.array(AgentToolCallSchema).max(4),
});

export type AgentPlan = z.infer<typeof AgentPlanSchema>;

export type AgentToolResult = {
  toolName: CoreToolName;
  output: unknown;
};
