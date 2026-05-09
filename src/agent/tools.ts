import { z } from "zod";
import { BadRequest } from "../errors/index.js";
import type { AgentToolCall, AgentToolResult, CoreToolName } from "../domain/agent.js";
import type { Identity } from "../domain/identity.js";
import type { BriefsService } from "../services/briefs.js";
import type { SocietyService } from "../services/society.js";
import type { StartupsService } from "../services/startups.js";

const SearchStartupsArgs = z.object({
  sector: z.string().min(1).optional(),
  startupName: z.string().min(1).optional(),
});

const ReadStartupNotesArgs = z.object({
  startupId: z.string().min(1),
});

const ListPortfolioSignalsArgs = z.object({
  portfolioCompanyId: z.string().min(1),
  sinceDays: z.number().int().positive().max(365).optional(),
});

const BoardPrepArgs = z.object({
  portfolioCompanyId: z.string().min(1),
});

export type AgentToolServices = {
  startups: StartupsService;
  briefs: BriefsService;
  society: SocietyService;
};

const parseArgs = <TSchema extends z.ZodTypeAny>(
  toolName: CoreToolName,
  schema: TSchema,
  input: unknown,
): z.infer<TSchema> => {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw BadRequest(`Invalid arguments for tool "${toolName}"`, {
      issues: result.error.issues,
    });
  }
  return result.data;
};

export const executeAgentTool = async (
  services: AgentToolServices,
  caller: Identity,
  call: AgentToolCall,
): Promise<AgentToolResult> => {
  switch (call.toolName) {
    case "search_startups": {
      const args = parseArgs(call.toolName, SearchStartupsArgs, call.arguments);
      const output = await services.startups.findSimilar(caller, {
        startupId: undefined,
        startupName: args.startupName,
        sector: args.sector,
      });
      return { toolName: call.toolName, output };
    }
    case "read_startup_notes": {
      const args = parseArgs(call.toolName, ReadStartupNotesArgs, call.arguments);
      const output = await services.startups.listAccessibleNotes(
        caller,
        args.startupId,
      );
      return { toolName: call.toolName, output };
    }
    case "list_portfolio_signals": {
      const args = parseArgs(
        call.toolName,
        ListPortfolioSignalsArgs,
        call.arguments,
      );
      const output = await services.society.getPortfolioSignals(
        caller,
        args.portfolioCompanyId,
        args.sinceDays ?? 30,
      );
      return { toolName: call.toolName, output };
    }
    case "build_board_prep_context": {
      const args = parseArgs(call.toolName, BoardPrepArgs, call.arguments);
      const output = await services.briefs.boardPrep(
        caller,
        args.portfolioCompanyId,
      );
      return { toolName: call.toolName, output };
    }
  }
};
