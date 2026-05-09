import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
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
  })
  .strict();

const ReadStartupNotesArgs = z
  .object({
    startupId: z.string().min(1),
  })
  .strict();

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

export const AGENT_TOOL_REGISTRY = [
  defineAgentTool({
    name: "search_startups",
    title: "Search Startups",
    description:
      "Search startups visible to the caller. Filter by sector or by exact known startupName. "
      + "Use this for broad discovery; for a single known company prefer the conversation context.",
    labels: ["startup", "crm", "search", "discovery"],
    sources: ["hubspot"],
    access: "confidential",
    approvalRequired: false,
    inputSchema: SearchStartupsArgs,
    execute: async ({ services, caller, args }) =>
      services.startups.findSimilar(caller, {
        startupId: undefined,
        startupName: args.startupName,
        sector: args.sector,
      }),
  }),
  defineAgentTool({
    name: "read_startup_notes",
    title: "Read Startup Notes",
    description:
      "Return permission-filtered notes for one startup. Requires a concrete startupId from "
      + "the conversation context or a previous tool result. Never invent ids.",
    labels: ["startup", "crm", "notes", "summary"],
    sources: ["hubspot"],
    access: "confidential",
    approvalRequired: false,
    inputSchema: ReadStartupNotesArgs,
    execute: async ({ services, caller, args }) =>
      services.startups.listAccessibleNotes(caller, args.startupId),
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
