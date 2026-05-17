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
import type { CompanyContextService } from "../services/companyContext.js";
import type { SocietyService } from "../services/society.js";
import type { StartupsService } from "../services/startups.js";
import type { SignalHubService } from "../services/signalHub/index.js";

export type AgentToolAccess = "internal" | "confidential" | "restricted";

export type AgentToolServices = {
  startups: StartupsService;
  briefs: BriefsService;
  society: SocietyService;
  companyContext: CompanyContextService;
  signalHub: SignalHubService;
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

const ResolveEntityArgs = z
  .object({
    query: z.string().min(1),
    limit: z.number().int().positive().max(50).optional(),
  })
  .strict();

const ListCompanyCrmActivityArgs = z
  .object({
    startupId: z.string().min(1).optional(),
    startupName: z.string().min(1).optional(),
    portfolioCompanyId: z.string().min(1).optional(),
    includeNotes: z.boolean().optional().default(true),
    includeDeals: z.boolean().optional().default(true),
    includeMeetings: z.boolean().optional().default(true),
    notesLimit: z.number().int().positive().max(200).optional(),
    dealsLimit: z.number().int().positive().max(200).optional(),
    meetingsLimit: z.number().int().positive().max(200).optional(),
  })
  .strict();

const ListCompanyDocumentsArgs = z
  .object({
    portfolioCompanyId: z.string().min(1),
    titleContains: z.string().min(1).optional(),
    limit: z.number().int().positive().max(100).optional(),
  })
  .strict();

const ReadCompanyDocumentExcerptArgs = z
  .object({
    portfolioCompanyId: z.string().min(1),
    driveFileId: z.string().min(1),
    maxChars: z.number().int().positive().max(120_000).optional(),
    charOffset: z.number().int().min(0).max(2_000_000).optional(),
  })
  .strict();

const ListPortfolioContextArgs = z
  .object({
    portfolioCompanyId: z.string().min(1),
    sinceDaysSignals: z.number().int().positive().max(365).optional(),
    eventsLimit: z.number().int().positive().max(100).optional(),
  })
  .strict();

const Company360SectionEnum = z.enum([
  "profile",
  "crm_activity",
  "documents",
  "portfolio_signals",
  "events",
]);

const BuildCompany360Args = z
  .object({
    sections: z.array(Company360SectionEnum).min(1).max(12),
    portfolioCompanyId: z.string().min(1).optional(),
    startupId: z.string().min(1).optional(),
    startupName: z.string().min(1).optional(),
    notesLimit: z.number().int().positive().max(200).optional(),
    dealsLimit: z.number().int().positive().max(200).optional(),
    meetingsLimit: z.number().int().positive().max(200).optional(),
    documentsLimit: z.number().int().positive().max(100).optional(),
    sinceDaysSignals: z.number().int().positive().max(365).optional(),
    eventsLimit: z.number().int().positive().max(100).optional(),
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
      "Look up startups visible to the caller. Returns the startup(s) matching the query. "
      + "Use startupId for exact id lookup, startupName for case-insensitive substring match, "
      + "or sector to list every startup in that sector. With no argument, returns a bounded "
      + "list of visible startups. This is the primary tool to confirm a startup exists and "
      + "obtain its canonical id before reading notes, deals or meetings.",
    labels: ["startup", "crm", "search", "discovery"],
    sources: ["hubspot"],
    access: "confidential",
    approvalRequired: false,
    inputSchema: SearchStartupsArgs,
    execute: async ({ services, caller, args }) =>
      services.startups.searchStartups(caller, {
        ...(args.startupId !== undefined ? { startupId: args.startupId } : {}),
        ...(args.startupName !== undefined ? { startupName: args.startupName } : {}),
        ...(args.sector !== undefined ? { sector: args.sector } : {}),
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
  defineAgentTool({
    name: "resolve_entity",
    title: "Resolve Entity",
    description:
      "Normalize a user fragment into HubSpot startup ids and Monday portfolio company ids visible to the caller. "
      + "Returns multiple candidates plus needsClarification when ambiguous. Call this before narrow reads when the user "
      + "gives a loose company name. Pair with list_company_crm_activity, list_company_documents or list_portfolio_context.",
    labels: ["discovery", "routing", "crm", "portfolio"],
    sources: ["hubspot", "monday"],
    access: "confidential",
    approvalRequired: false,
    inputSchema: ResolveEntityArgs,
    execute: async ({ services, caller, args }) =>
      services.companyContext.resolveEntity(
        caller,
        args.query,
        args.limit !== undefined ? { limit: args.limit } : undefined,
      ),
  }),
  defineAgentTool({
    name: "list_company_crm_activity",
    title: "List Company CRM Activity",
    description:
      "Batch HubSpot notes/deals/meetings for one company. Toggle include* flags to shrink payloads. "
      + "portfolioCompanyId is resolved through the Monday board name token, so pass the same string you use for Drive. "
      + "Prefer startupId from resolve_entity when ambiguity is possible.",
    labels: ["crm", "hubspot", "batch"],
    sources: ["hubspot"],
    access: "confidential",
    approvalRequired: false,
    inputSchema: ListCompanyCrmActivityArgs,
    execute: async ({ services, caller, args }) =>
      services.companyContext.listCompanyCrmActivity(caller, args),
  }),
  defineAgentTool({
    name: "list_company_documents",
    title: "List Company Documents",
    description:
      "List Drive files whose names contain portfolioCompanyId. Optional titleContains narrows filenames. "
      + "Scoped by investor portfolio ACLs enforced in Society.",
    labels: ["drive", "documents", "portfolio"],
    sources: ["drive"],
    access: "confidential",
    approvalRequired: false,
    inputSchema: ListCompanyDocumentsArgs,
    execute: async ({ services, caller, args }) => {
      const docOptions: { titleContains?: string; limit?: number } = {};
      if (args.titleContains !== undefined) {
        docOptions.titleContains = args.titleContains;
      }
      if (args.limit !== undefined) {
        docOptions.limit = args.limit;
      }
      return services.companyContext.listCompanyDocuments(
        caller,
        args.portfolioCompanyId,
        docOptions,
      );
    },
  }),
  defineAgentTool({
    name: "read_company_document_excerpt",
    title: "Read Company Document Excerpt",
    description:
      "Fetch plain text excerpts from Google-native files indexed by list_company_documents. "
      + "Reject random driveFileId values outside that listing.",
    labels: ["drive", "documents", "excerpt"],
    sources: ["drive"],
    access: "confidential",
    approvalRequired: false,
    inputSchema: ReadCompanyDocumentExcerptArgs,
    execute: async ({ services, caller, args }) =>
      services.companyContext.readCompanyDocumentExcerpt(caller, {
        portfolioCompanyId: args.portfolioCompanyId,
        driveFileId: args.driveFileId,
        maxChars: args.maxChars ?? 8_000,
        charOffset: args.charOffset,
      }),
  }),
  defineAgentTool({
    name: "list_portfolio_context",
    title: "List Portfolio Context",
    description:
      "Return Monday portfolio row metadata plus permission-filtered signals and upcoming workspace events "
      + "currently exposed by connectors. Signals may be empty if Monday has no ingestion board wired yet.",
    labels: ["portfolio", "monday", "signals"],
    sources: ["monday"],
    access: "confidential",
    approvalRequired: false,
    inputSchema: ListPortfolioContextArgs,
    execute: async ({ services, caller, args }) => {
      const ctxOptions: {
        sinceDaysSignals: number;
        eventsLimit?: number;
      } = { sinceDaysSignals: args.sinceDaysSignals ?? 30 };
      if (args.eventsLimit !== undefined) {
        ctxOptions.eventsLimit = args.eventsLimit;
      }
      return services.companyContext.listPortfolioContext(
        caller,
        args.portfolioCompanyId,
        ctxOptions,
      );
    },
  }),
  defineAgentTool({
    name: "build_company_360_context",
    title: "Build Company 360 Context",
    description:
      "Optional multi-section assembler for board prep or internal digests. Prefer atomic tools when you only need one slice. "
      + "Provide portfolioCompanyId or startup selectors; missing Monday linkage yields warnings instead of failing outright.",
    labels: ["portfolio", "brief", "cross_source"],
    sources: ["hubspot", "monday", "drive"],
    access: "confidential",
    approvalRequired: false,
    inputSchema: BuildCompany360Args,
    execute: async ({ services, caller, args }) => {
      const hasSelector = args.portfolioCompanyId !== undefined ||
        args.startupId !== undefined ||
        args.startupName !== undefined;
      if (!hasSelector) {
        throw BadRequest(
          "Provide portfolioCompanyId or at least one startup selector (startupId/startupName).",
        );
      }
      return services.companyContext.buildCompany360Context(caller, args);
    },
  }),
  // --- Signal Hub tools ---

  defineAgentTool({
    name: "signal_hub_list_watched",
    title: "Signal Hub: List Watched Entities",
    description:
      "List all entities (founders, companies) currently on the Signal Hub watchlist. "
      + "Optional priority filter: 'hot', 'warm', or 'cold'. "
      + "Returns id, displayName, linkedinUrl, linkedinIdentifier, priority, startupId.",
    labels: ["signal_hub", "watchlist", "linkedin"],
    sources: ["signal_hub"],
    access: "confidential",
    approvalRequired: false,
    inputSchema: z.object({
      priority: z.enum(["hot", "warm", "cold"]).optional(),
    }).strict(),
    execute: async ({ services, caller, args }) =>
      services.signalHub.listWatched(caller, args.priority),
  }),

  defineAgentTool({
    name: "signal_hub_add_watched",
    title: "Signal Hub: Add Watched Entity",
    description:
      "Add a founder or company to the Signal Hub watchlist. "
      + "Provide displayName and optionally linkedinUrl or linkedinIdentifier. "
      + "Link to an existing HubSpot startup via startupId. "
      + "Requires internal_team role.",
    labels: ["signal_hub", "watchlist", "linkedin"],
    sources: ["signal_hub"],
    access: "confidential",
    approvalRequired: false,
    inputSchema: z.object({
      displayName: z.string().min(1),
      linkedinUrl: z.string().url().optional(),
      linkedinIdentifier: z.string().min(1).optional(),
      startupId: z.string().min(1).optional(),
      kind: z.enum(["person", "company"]).optional(),
      priority: z.enum(["hot", "warm", "cold"]).optional(),
    }).strict(),
    execute: async ({ services, caller, args }) =>
      services.signalHub.addWatched(caller, {
        displayName: args.displayName,
        ...(args.linkedinUrl !== undefined ? { linkedinUrl: args.linkedinUrl } : {}),
        ...(args.linkedinIdentifier !== undefined ? { linkedinIdentifier: args.linkedinIdentifier } : {}),
        ...(args.startupId !== undefined ? { startupId: args.startupId } : {}),
        ...(args.kind !== undefined ? { kind: args.kind } : {}),
        ...(args.priority !== undefined ? { priority: args.priority } : {}),
      }),
  }),

  defineAgentTool({
    name: "signal_hub_set_priority",
    title: "Signal Hub: Set Entity Priority",
    description:
      "Update the polling priority of a watched entity. "
      + "hot = polled first, warm = default, cold = rarely polled. "
      + "Requires internal_team role.",
    labels: ["signal_hub", "watchlist"],
    sources: ["signal_hub"],
    access: "confidential",
    approvalRequired: false,
    inputSchema: z.object({
      watchedId: z.string().min(1),
      priority: z.enum(["hot", "warm", "cold"]),
    }).strict(),
    execute: async ({ services, caller, args }) => {
      await services.signalHub.setPriority(caller, args.watchedId, args.priority);
      return { updated: true };
    },
  }),

  defineAgentTool({
    name: "signal_hub_recent_signals",
    title: "Signal Hub: Recent Signals",
    description:
      "Return recent LinkedIn signals for a watched entity or HubSpot startup. "
      + "Provide watchedId or startupId. Optionally filter by source ('serper_public' or 'unipile'), "
      + "signalType ('post', 'reaction', 'comment'), sinceIso (ISO-8601 datetime), "
      + "textContains (substring), and limit (max 200, default 50).",
    labels: ["signal_hub", "linkedin", "signals"],
    sources: ["signal_hub"],
    access: "confidential",
    approvalRequired: false,
    inputSchema: z.object({
      watchedId: z.string().min(1).optional(),
      startupId: z.string().min(1).optional(),
      source: z.enum(["serper_public", "unipile"]).optional(),
      signalType: z.enum(["post", "reaction", "comment", "profile_change"]).optional(),
      sinceIso: z.string().min(1).optional(),
      textContains: z.string().min(1).optional(),
      limit: z.number().int().positive().max(200).optional(),
    }).strict(),
    execute: async ({ services, caller, args }) => {
      if (!args.watchedId && !args.startupId) {
        throw BadRequest("Provide watchedId or startupId");
      }
      const filter: Parameters<typeof services.signalHub.listEvents>[1] = {
        limit: args.limit ?? 50,
      };
      if (args.watchedId) filter.watchedId = args.watchedId;
      if (args.startupId) filter.startupId = args.startupId;
      if (args.source) filter.source = args.source;
      if (args.signalType) filter.signalType = args.signalType;
      if (args.sinceIso) filter.sinceIso = args.sinceIso;
      if (args.textContains) filter.textContains = args.textContains;
      return services.signalHub.listEvents(caller, filter);
    },
  }),

  defineAgentTool({
    name: "signal_hub_search_signals",
    title: "Signal Hub: Search Signals",
    description:
      "Search all ingested signals with combined filters. "
      + "Unlike recent_signals, does not require a specific entity — useful for cross-entity queries. "
      + "Filters: source, signalType, sinceIso, textContains. Returns up to 100 events.",
    labels: ["signal_hub", "linkedin", "search"],
    sources: ["signal_hub"],
    access: "confidential",
    approvalRequired: false,
    inputSchema: z.object({
      source: z.enum(["serper_public", "unipile"]).optional(),
      signalType: z.enum(["post", "reaction", "comment", "profile_change"]).optional(),
      sinceIso: z.string().min(1).optional(),
      textContains: z.string().min(1).optional(),
      limit: z.number().int().positive().max(100).optional(),
    }).strict(),
    execute: async ({ services, caller, args }) => {
      const filter: Parameters<typeof services.signalHub.listEvents>[1] = {
        limit: args.limit ?? 50,
      };
      if (args.source) filter.source = args.source;
      if (args.signalType) filter.signalType = args.signalType;
      if (args.sinceIso) filter.sinceIso = args.sinceIso;
      if (args.textContains) filter.textContains = args.textContains;
      return services.signalHub.listEvents(caller, filter);
    },
  }),

  defineAgentTool({
    name: "signal_hub_resolve_entity",
    title: "Signal Hub: Resolve Entity",
    description:
      "Resolve a free-text query (founder name, company name, LinkedIn URL or identifier) "
      + "to a watched entity. Returns watchedId and startupId when unambiguous. "
      + "Returns candidates + needsClarification when ambiguous. "
      + "Call this before recent_signals when the caller gives a loose name.",
    labels: ["signal_hub", "discovery"],
    sources: ["signal_hub", "hubspot"],
    access: "confidential",
    approvalRequired: false,
    inputSchema: z.object({
      query: z.string().min(1),
    }).strict(),
    execute: async ({ services, caller, args }) =>
      services.signalHub.resolveEntity(caller, args.query),
  }),

  defineAgentTool({
    name: "signal_hub_list_accounts",
    title: "Signal Hub: List Unipile Accounts",
    description:
      "Return the status of all registered Unipile LinkedIn accounts used for Signal Hub. "
      + "Shows guardian state: active/frozen/killed, quota used today, last error, next allowed call time. "
      + "Use this to monitor account health before requesting a refresh.",
    labels: ["signal_hub", "unipile", "admin"],
    sources: ["signal_hub"],
    access: "internal",
    approvalRequired: false,
    inputSchema: z.object({}).strict(),
    execute: async ({ services, caller }) =>
      services.signalHub.listUnipileAccounts(caller),
  }),

  defineAgentTool({
    name: "signal_hub_request_refresh",
    title: "Signal Hub: Request Refresh (async)",
    description:
      "Enqueue a signal refresh for a watched entity. ALWAYS async — returns immediately with jobId. "
      + "The actual LinkedIn call happens later, rate-limited by the queue and guardian. "
      + "source defaults to 'serper_public' (no LinkedIn account needed). "
      + "Use 'unipile' for private feed access — requires unipileAccountId and an active account.",
    labels: ["signal_hub", "linkedin", "refresh"],
    sources: ["signal_hub"],
    access: "confidential",
    approvalRequired: false,
    inputSchema: z.object({
      watchedId: z.string().min(1),
      source: z.enum(["serper_public", "unipile"]).optional(),
      unipileAccountId: z.string().min(1).optional(),
    }).strict(),
    execute: async ({ services, caller, args }) =>
      services.signalHub.requestRefresh(caller, {
        watchedId: args.watchedId,
        ...(args.source !== undefined ? { source: args.source } : {}),
        ...(args.unipileAccountId !== undefined ? { unipileAccountId: args.unipileAccountId } : {}),
      }),
  }),

  defineAgentTool({
    name: "signal_hub_freeze_account",
    title: "Signal Hub: Freeze Unipile Account",
    description:
      "Immediately freeze a Unipile LinkedIn account to stop all calls from Signal Hub. "
      + "Use as a kill-switch when suspicious LinkedIn activity is observed. "
      + "durationHours defaults to 24. Account can be unfrozen via the API. "
      + "Requires internal_team role.",
    labels: ["signal_hub", "unipile", "admin", "safety"],
    sources: ["signal_hub"],
    access: "internal",
    approvalRequired: true,
    inputSchema: z.object({
      accountId: z.string().min(1),
      reason: z.string().min(1),
      durationHours: z.number().int().positive().max(168).optional(),
    }).strict(),
    execute: async ({ services, caller, args }) => {
      await services.signalHub.freezeUnipileAccount(
        caller,
        args.accountId,
        args.reason,
        args.durationHours ? args.durationHours * 3_600_000 : undefined,
      );
      return { frozen: true, accountId: args.accountId };
    },
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
