import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { BadRequest } from "../errors/index.js";
import type {
  AgentToolCall,
  AgentToolResult,
  CoreToolName,
} from "../domain/agent.js";
import type { Identity } from "../domain/identity.js";
import type { LlmJsonSchema, LlmTool } from "../llm/types.js";
import type { BriefsService } from "../services/briefs.js";
import type { SocietyService } from "../services/society.js";
import type { StartupsService } from "../services/startups.js";

export type AgentToolAccess = "internal" | "confidential" | "restricted";

export type AgentToolServices = {
  startups: StartupsService;
  briefs: BriefsService;
  society: SocietyService;
};

type ToolHandler<TArgs> = (deps: {
  services: AgentToolServices;
  caller: Identity;
  args: TArgs;
}) => Promise<unknown>;

export type AgentToolDefinition<TArgs = unknown> = {
  name: CoreToolName;
  title: string;
  description: string;
  labels: readonly string[];
  sources: readonly string[];
  access: AgentToolAccess;
  approvalRequired: boolean;
  inputSchema: z.ZodType<TArgs>;
  execute: ToolHandler<TArgs>;
};

type RegisteredAgentToolDefinition = Omit<
  AgentToolDefinition<unknown>,
  "execute" | "inputSchema"
> & {
  inputSchema: z.ZodTypeAny;
  execute: ToolHandler<unknown>;
};

const defineAgentTool = <TSchema extends z.ZodTypeAny>(
  tool: Omit<AgentToolDefinition<z.infer<TSchema>>, "inputSchema"> & {
    inputSchema: TSchema;
  },
): RegisteredAgentToolDefinition => ({
  ...tool,
  execute: async ({ services, caller, args }) =>
    tool.execute({
      services,
      caller,
      args: tool.inputSchema.parse(args),
    }),
});

const SearchStartupsArgs = z
  .object({
    sector: z.string().min(1).optional(),
    startupName: z.string().min(1).optional(),
    startupId: z.string().min(1).optional(),
    limit: z.number().int().positive().max(200).optional(),
  })
  .strict();

const StartupSelectorBase = z
  .object({
    startupId: z.string().min(1).optional(),
    startupName: z.string().min(1).optional(),
  })
  .strict();

const ReadStartupNotesArgs = StartupSelectorBase.extend({
  limit: z.number().int().positive().max(200).optional(),
}).strict();

const ReadStartupDealsArgs = StartupSelectorBase.extend({
  limit: z.number().int().positive().max(200).optional(),
}).strict();

const ReadStartupMeetingsArgs = StartupSelectorBase.extend({
  limit: z.number().int().positive().max(200).optional(),
}).strict();

const ListPortfolioSignalsArgs = z
  .object({
    portfolioCompanyId: z.string().min(1),
    sinceDays: z.number().int().positive().max(365).optional(),
  })
  .strict();

const BoardPrepArgs = z
  .object({
    portfolioCompanyId: z.string().min(1),
  })
  .strict();

type StartupSelectionArgs = {
  startupId?: string | undefined;
  startupName?: string | undefined;
};

const buildStartupLookup = (args: StartupSelectionArgs): StartupSelectionArgs => {
  const startup = {
    ...(args.startupId !== undefined ? { startupId: args.startupId } : {}),
    ...(args.startupName !== undefined ? { startupName: args.startupName } : {}),
  };
  if (startup.startupId === undefined && startup.startupName === undefined) {
    throw BadRequest("Either startupId or startupName is required.");
  }
  return startup;
};

const buildListOptions = (
  limit: number | undefined,
): { limit: number } | undefined =>
  limit !== undefined ? { limit } : undefined;

export const AGENT_TOOL_REGISTRY = [
  defineAgentTool({
    name: "search_startups",
    title: "Search Startups",
    description:
      "Search startups visible to the caller. Supports startupId, exact startupName, or sector. "
      + "Defaults to a bounded result window; use limit for larger structured backend reads.",
    labels: ["startup", "crm", "search", "discovery"],
    sources: ["hubspot"],
    access: "confidential",
    approvalRequired: false,
    inputSchema: SearchStartupsArgs,
    execute: async ({ services, caller, args }) =>
      services.startups.findSimilar(caller, {
        startupId: args.startupId,
        startupName: args.startupName,
        sector: args.sector,
      }, buildListOptions(args.limit)),
  }),
  defineAgentTool({
    name: "read_startup_notes",
    title: "Read Startup Notes",
    description:
      "Return permission-filtered notes for one startup selected by startupId or exact "
      + "startupName. Output is sorted by recency and supports limit for structured consumers.",
    labels: ["startup", "crm", "notes", "summary"],
    sources: ["hubspot"],
    access: "confidential",
    approvalRequired: false,
    inputSchema: ReadStartupNotesArgs,
    execute: async ({ services, caller, args }) =>
      services.startups.listAccessibleNotes(
        caller,
        buildStartupLookup(args),
        buildListOptions(args.limit),
      ),
  }),
  defineAgentTool({
    name: "read_startup_deals",
    title: "Read Startup Deals",
    description:
      "Return permission-filtered HubSpot deals for one startup, sorted by latest update. "
      + "Use startupId when available to avoid ambiguity; limit controls payload size.",
    labels: ["startup", "crm", "deals", "pipeline"],
    sources: ["hubspot"],
    access: "confidential",
    approvalRequired: false,
    inputSchema: ReadStartupDealsArgs,
    execute: async ({ services, caller, args }) =>
      services.startups.listAccessibleDeals(
        caller,
        buildStartupLookup(args),
        buildListOptions(args.limit),
      ),
  }),
  defineAgentTool({
    name: "read_startup_meetings",
    title: "Read Startup Meetings",
    description:
      "Return HubSpot meetings for one startup, sorted by most recent occurrence. "
      + "Useful for timeline reconstruction and pre-call context.",
    labels: ["startup", "crm", "meetings", "timeline"],
    sources: ["hubspot"],
    access: "confidential",
    approvalRequired: false,
    inputSchema: ReadStartupMeetingsArgs,
    execute: async ({ services, caller, args }) =>
      services.startups.listAccessibleMeetings(
        caller,
        buildStartupLookup(args),
        buildListOptions(args.limit),
      ),
  }),
  defineAgentTool({
    name: "list_portfolio_signals",
    title: "List Portfolio Signals",
    description:
      "List recent portfolio signals (hires, risks, funding, press) for one portfolio company. "
      + "sinceDays defaults to 30 if omitted.",
    labels: ["portfolio", "monday", "signals", "risk"],
    sources: ["monday"],
    access: "confidential",
    approvalRequired: false,
    inputSchema: ListPortfolioSignalsArgs,
    execute: async ({ services, caller, args }) =>
      services.society.getPortfolioSignals(
        caller,
        args.portfolioCompanyId,
        args.sinceDays ?? 30,
      ),
  }),
  defineAgentTool({
    name: "build_board_prep_context",
    title: "Build Board Prep Context",
    description:
      "Assemble a cited multi-source brief (CRM + Monday + Drive) for one portfolio company. "
      + "Use for board prep, company 360 or pre-call briefings.",
    labels: ["portfolio", "brief", "board", "cross_source"],
    sources: ["hubspot", "monday", "drive"],
    access: "confidential",
    approvalRequired: false,
    inputSchema: BoardPrepArgs,
    execute: async ({ services, caller, args }) =>
      services.briefs.boardPrep(caller, args.portfolioCompanyId),
  }),
] as const;

export const AGENT_TOOL_NAMES = AGENT_TOOL_REGISTRY.map((tool) => tool.name);

const TOOL_REGISTRY_BY_NAME = new Map<CoreToolName, RegisteredAgentToolDefinition>(
  AGENT_TOOL_REGISTRY.map((tool) => [tool.name, tool]),
);

export const getAgentToolDefinition = (
  toolName: CoreToolName,
): RegisteredAgentToolDefinition => {
  const tool = TOOL_REGISTRY_BY_NAME.get(toolName);
  if (!tool) {
    throw new Error(`Unknown registered agent tool: ${toolName}`);
  }
  return tool;
};

export const findAgentToolDefinition = (
  toolName: string,
): RegisteredAgentToolDefinition | undefined =>
  TOOL_REGISTRY_BY_NAME.get(toolName as CoreToolName);

const toToolInputSchema = (schema: z.ZodTypeAny): LlmJsonSchema => {
  const json = zodToJsonSchema(schema, {
    target: "jsonSchema7",
    $refStrategy: "none",
  }) as LlmJsonSchema;
  delete json["$schema"];
  return json;
};

export const buildLlmToolDefinitions = (): LlmTool[] =>
  AGENT_TOOL_REGISTRY.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: toToolInputSchema(tool.inputSchema),
  }));

export const executeRegisteredAgentTool = async (
  services: AgentToolServices,
  caller: Identity,
  call: AgentToolCall,
): Promise<AgentToolResult> => {
  const tool = getAgentToolDefinition(call.toolName);
  const args = tool.inputSchema.parse(call.arguments);
  const output = await tool.execute({ services, caller, args });
  return { toolName: call.toolName, output };
};
