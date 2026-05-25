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
import type { CompanyContextService } from "../services/companyContext.js";
import type { SocietyService } from "../services/society.js";
import type { StartupsService } from "../services/startups.js";
import type { SignalHubService } from "../services/signalHub/index.js";
import type { CompetitiveHistoryService } from "../services/competitiveHistory.js";
import type { CompanyDriveFolderService } from "../services/companyDriveFolder.js";
import type { BoardBriefService } from "../services/boardBrief.js";
import type { PortfolioSignalDigestService } from "../services/portfolioSignalDigest.js";
import type { FindLatestDeckService } from "../services/findLatestDeck.js";
import type { CompanyActivitySummaryService } from "../services/companyActivitySummary.js";
import type { AgentToolAccess } from "../domain/agentTools.js";
import { formatToolDescription } from "../mcp/toolMeta.js";
import { TOOL_DESCRIPTIONS } from "./toolCopy.js";
import type { BpWorkflowService } from "../services/bpWorkflow.js";
import type { PortfolioCompaniesService } from "../services/portfolioCompanies.js";
import type { SimilarCasesService } from "../services/crmMemory/similarCases.js";
import { readBpPlaybook } from "../services/bpPlaybook.js";

export type AgentToolServices = {
  startups: StartupsService;
  society: SocietyService;
  companyContext: CompanyContextService;
  signalHub: SignalHubService;
  competitiveHistory: CompetitiveHistoryService;
  companyDriveFolder: CompanyDriveFolderService;
  boardBrief: BoardBriefService;
  portfolioSignalDigest: PortfolioSignalDigestService;
  companyActivitySummary: CompanyActivitySummaryService;
  findLatestDeck: FindLatestDeckService;
  bpWorkflow: BpWorkflowService;
  portfolioCompanies: PortfolioCompaniesService;
  similarCases: SimilarCasesService | undefined;
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

export type { RegisteredAgentToolDefinition };

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
  authorEmail: z.string().email().optional(),
  sinceDays: z.number().int().positive().max(3650).optional(),
  minBodyLength: z.number().int().positive().max(50_000).optional(),
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

const GeneratePortfolioSignalDigestArgs = z
  .object({
    sinceDays: z.number().int().positive().max(30).optional(),
    portfolioCompanyId: z.string().min(1).optional(),
    priority: z.enum(["hot", "warm", "cold"]).optional(),
    signalsPerCompany: z.number().int().positive().max(25).optional(),
    includeCrmNotes: z.boolean().optional(),
    notesPerCompany: z.number().int().positive().max(5).optional(),
    includeQuietCompanies: z.boolean().optional(),
  })
  .strict();

const BoardPrepArgs = z
  .object({
    portfolioCompanyId: z.string().min(1),
  })
  .strict();

const PrepareBoardBriefArgs = z
  .object({
    portfolioCompanyId: z.string().min(1).optional(),
    startupId: z.string().min(1).optional(),
    startupName: z.string().min(1).optional(),
    sinceDaysMonday: z.number().int().positive().max(180).optional(),
    sinceDaysLinkedIn: z.number().int().positive().max(90).optional(),
    notesLimit: z.number().int().positive().max(20).optional(),
    dealsLimit: z.number().int().positive().max(20).optional(),
    meetingsLimit: z.number().int().positive().max(20).optional(),
    driveDocsLimit: z.number().int().positive().max(25).optional(),
    linkedInLimit: z.number().int().positive().max(25).optional(),
  })
  .strict();

const ResolveEntityArgs = z
  .object({
    query: z.string().min(1),
    limit: z.number().int().positive().max(50).optional(),
  })
  .strict();

const FindLatestDeckArgs = z
  .object({
    portfolioCompanyId: z.string().min(1).optional(),
    startupId: z.string().min(1).optional(),
    startupName: z.string().min(1).optional(),
    driveTokens: z
      .array(
        z.object({
          token: z.string().min(1),
          source: z.enum([
            "hubspot_name",
            "monday_portfolio",
            "name_token",
            "parenthetical_alias",
          ]),
          confidence: z.number(),
          matchReason: z.string(),
        }),
      )
      .optional(),
    maxExcerptChars: z.number().int().positive().max(12_000).optional(),
    alternateLimit: z.number().int().positive().max(8).optional(),
  })
  .strict();

const DriveTokenCandidatesArg = z
  .array(
    z.object({
      token: z.string().min(1),
      source: z.enum([
        "hubspot_name",
        "monday_portfolio",
        "name_token",
        "parenthetical_alias",
      ]),
      confidence: z.number(),
      matchReason: z.string(),
    }),
  )
  .optional();

const SummarizeCompanyActivityArgs = z
  .object({
    startupId: z.string().min(1).optional(),
    startupName: z.string().min(1).optional(),
    portfolioCompanyId: z.string().min(1).optional(),
    factLimit: z.number().int().positive().max(25).optional(),
    notesLimit: z.number().int().positive().max(50).optional(),
    dealsLimit: z.number().int().positive().max(50).optional(),
    meetingsLimit: z.number().int().positive().max(50).optional(),
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
    driveTokens: DriveTokenCandidatesArg,
    titleContains: z.string().min(1).optional(),
    limit: z.number().int().positive().max(100).optional(),
    includeBinaries: z.boolean().optional(),
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

const ListPortfolioCompaniesArgs = z.object({}).strict();

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

const FindCompetitiveHistoryArgs = z
  .object({
    startupId: z.string().min(1).optional(),
    startupName: z.string().min(1).optional(),
    sector: z.string().min(1).optional(),
    limit: z.number().int().positive().max(25).optional(),
    notesPerMatch: z.number().int().positive().max(10).optional(),
    authorEmail: z.string().email().optional(),
  })
  .strict();

const FindSimilarCasesArgs = z
  .object({
    startupId: z.string().min(1).optional(),
    startupName: z.string().min(1).optional(),
    query: z.string().min(1).optional(),
    noteId: z.string().min(1).optional(),
    authorEmail: z.string().email().optional(),
    sector: z.string().min(1).optional(),
    sinceDays: z.number().int().positive().max(3650).optional(),
    chunkKind: z.enum(["recap", "investment_lens"]).optional(),
    limit: z.number().int().positive().max(25).optional(),
  })
  .strict();

const ResolveCompanyDriveFolderArgs = z
  .object({
    portfolioCompanyId: z.string().min(1).optional(),
    startupId: z.string().min(1).optional(),
    startupName: z.string().min(1).optional(),
    driveTokens: DriveTokenCandidatesArg,
    purpose: z
      .enum([
        "company_root",
        "series_a",
        "pre_round",
        "m2_financial",
        "bp_inputs",
        "reporting",
      ])
      .optional(),
    folderLimit: z.number().int().positive().max(25).optional(),
    inventoryLimit: z.number().int().positive().max(100).optional(),
  })
  .strict();

const AssembleCompanyFinancePackArgs = z
  .object({
    portfolioCompanyId: z.string().min(1).optional(),
    driveTokens: DriveTokenCandidatesArg,
    titleContains: z.string().min(1).optional(),
    documentLimit: z.number().int().positive().max(80).optional(),
    peekFounderBpSheets: z.boolean().optional(),
  })
  .strict();

const DraftBpTabDebtArgs = z
  .object({
    portfolioCompanyId: z.string().min(1).optional(),
    founderBpFileId: z.string().min(1),
    sourceTab: z.string().min(1).optional(),
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

type NoteListOptionsArgs = {
  limit?: number | undefined;
  authorEmail?: string | undefined;
  sinceDays?: number | undefined;
  minBodyLength?: number | undefined;
};

const buildNoteListOptions = (
  args: NoteListOptionsArgs,
): {
  limit?: number;
  authorEmail?: string;
  sinceDays?: number;
  minBodyLength?: number;
} => ({
  ...(args.limit !== undefined ? { limit: args.limit } : {}),
  ...(args.authorEmail !== undefined ? { authorEmail: args.authorEmail } : {}),
  ...(args.sinceDays !== undefined ? { sinceDays: args.sinceDays } : {}),
  ...(args.minBodyLength !== undefined
    ? { minBodyLength: args.minBodyLength }
    : {}),
});

export const AGENT_TOOL_REGISTRY = [
  defineAgentTool({
    name: "search_startups",
    title: "Search Startups",
    description: formatToolDescription(TOOL_DESCRIPTIONS.search_startups),

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
    description: formatToolDescription(TOOL_DESCRIPTIONS.read_startup_notes),

    labels: ["startup", "crm", "notes", "summary"],
    sources: ["hubspot"],
    access: "confidential",
    approvalRequired: false,
    inputSchema: ReadStartupNotesArgs,
    execute: async ({ services, caller, args }) =>
      services.startups.listAccessibleNotes(
        caller,
        buildStartupLookup(args),
        buildNoteListOptions(args),
      ),
  }),
  defineAgentTool({
    name: "read_startup_deals",
    title: "Read Startup Deals",
    description: formatToolDescription(TOOL_DESCRIPTIONS.read_startup_deals),

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
    description: formatToolDescription(TOOL_DESCRIPTIONS.read_startup_meetings),

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
    description: formatToolDescription(TOOL_DESCRIPTIONS.list_portfolio_signals),

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
    description: formatToolDescription(TOOL_DESCRIPTIONS.build_board_prep_context),

    labels: ["portfolio", "brief", "board", "legacy"],
    sources: ["hubspot", "monday", "drive", "signal_hub"],
    access: "confidential",
    approvalRequired: false,
    inputSchema: BoardPrepArgs,
    execute: async ({ services, caller, args }) =>
      services.boardBrief.prepareLegacyBoardPrepContext(
        caller,
        args.portfolioCompanyId,
      ),
  }),
  defineAgentTool({
    name: "prepare_board_brief",
    title: "Prepare Board Brief",
    description: formatToolDescription(TOOL_DESCRIPTIONS.prepare_board_brief),

    labels: ["brief", "portfolio", "board", "cross_source"],
    sources: ["hubspot", "monday", "drive", "signal_hub"],
    access: "confidential",
    approvalRequired: false,
    inputSchema: PrepareBoardBriefArgs,
    execute: async ({ services, caller, args }) => {
      const hasSelector = args.portfolioCompanyId !== undefined ||
        args.startupId !== undefined ||
        args.startupName !== undefined;
      if (!hasSelector) {
        throw BadRequest(
          "Provide portfolioCompanyId or at least one startup selector (startupId/startupName).",
        );
      }
      return services.boardBrief.prepareBoardBrief(caller, {
        ...(args.portfolioCompanyId !== undefined
          ? { portfolioCompanyId: args.portfolioCompanyId }
          : {}),
        ...(args.startupId !== undefined ? { startupId: args.startupId } : {}),
        ...(args.startupName !== undefined
          ? { startupName: args.startupName }
          : {}),
        ...(args.sinceDaysMonday !== undefined
          ? { sinceDaysMonday: args.sinceDaysMonday }
          : {}),
        ...(args.sinceDaysLinkedIn !== undefined
          ? { sinceDaysLinkedIn: args.sinceDaysLinkedIn }
          : {}),
        ...(args.notesLimit !== undefined ? { notesLimit: args.notesLimit } : {}),
        ...(args.dealsLimit !== undefined ? { dealsLimit: args.dealsLimit } : {}),
        ...(args.meetingsLimit !== undefined
          ? { meetingsLimit: args.meetingsLimit }
          : {}),
        ...(args.driveDocsLimit !== undefined
          ? { driveDocsLimit: args.driveDocsLimit }
          : {}),
        ...(args.linkedInLimit !== undefined
          ? { linkedInLimit: args.linkedInLimit }
          : {}),
      });
    },
  }),
  defineAgentTool({
    name: "generate_portfolio_signal_digest",
    title: "Generate Portfolio Signal Digest",
    description: formatToolDescription(
      TOOL_DESCRIPTIONS.generate_portfolio_signal_digest,
    ),

    labels: ["portfolio", "signals", "digest", "communication"],
    sources: ["monday", "signal_hub", "hubspot"],
    access: "confidential",
    approvalRequired: false,
    inputSchema: GeneratePortfolioSignalDigestArgs,
    execute: async ({ services, caller, args }) =>
      services.portfolioSignalDigest.generatePortfolioSignalDigest(caller, {
        ...(args.sinceDays !== undefined ? { sinceDays: args.sinceDays } : {}),
        ...(args.portfolioCompanyId !== undefined
          ? { portfolioCompanyId: args.portfolioCompanyId }
          : {}),
        ...(args.priority !== undefined ? { priority: args.priority } : {}),
        ...(args.signalsPerCompany !== undefined
          ? { signalsPerCompany: args.signalsPerCompany }
          : {}),
        ...(args.includeCrmNotes !== undefined
          ? { includeCrmNotes: args.includeCrmNotes }
          : {}),
        ...(args.notesPerCompany !== undefined
          ? { notesPerCompany: args.notesPerCompany }
          : {}),
        ...(args.includeQuietCompanies !== undefined
          ? { includeQuietCompanies: args.includeQuietCompanies }
          : {}),
      }),
  }),
  defineAgentTool({
    name: "resolve_entity",
    title: "Resolve Entity",
    description: formatToolDescription(TOOL_DESCRIPTIONS.resolve_entity),

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
    name: "find_latest_deck",
    title: "Find Latest Deck",
    description: formatToolDescription(TOOL_DESCRIPTIONS.find_latest_deck),

    labels: ["drive", "documents", "deck"],
    sources: ["drive"],
    access: "confidential",
    approvalRequired: false,
    inputSchema: FindLatestDeckArgs,
    execute: async ({ services, caller, args }) => {
      const hasSelector = args.portfolioCompanyId !== undefined ||
        args.startupId !== undefined ||
        args.startupName !== undefined;
      if (!hasSelector) {
        throw BadRequest(
          "Provide portfolioCompanyId or startupId/startupName after resolve_entity.",
        );
      }
      return services.findLatestDeck.findLatestDeck(caller, {
        ...(args.portfolioCompanyId !== undefined
          ? { portfolioCompanyId: args.portfolioCompanyId }
          : {}),
        ...(args.startupId !== undefined ? { startupId: args.startupId } : {}),
        ...(args.startupName !== undefined
          ? { startupName: args.startupName }
          : {}),
        ...(args.driveTokens !== undefined ? { driveTokens: args.driveTokens } : {}),
        ...(args.maxExcerptChars !== undefined
          ? { maxExcerptChars: args.maxExcerptChars }
          : {}),
        ...(args.alternateLimit !== undefined
          ? { alternateLimit: args.alternateLimit }
          : {}),
      });
    },
  }),
  defineAgentTool({
    name: "summarize_company_activity",
    title: "Summarize Company Activity",
    description: formatToolDescription(TOOL_DESCRIPTIONS.summarize_company_activity),

    labels: ["crm", "hubspot", "summary"],
    sources: ["hubspot"],
    access: "confidential",
    approvalRequired: false,
    inputSchema: SummarizeCompanyActivityArgs,
    execute: async ({ services, caller, args }) => {
      const hasSelector = args.startupId !== undefined ||
        args.startupName !== undefined ||
        args.portfolioCompanyId !== undefined;
      if (!hasSelector) {
        throw BadRequest(
          "Provide startupId, startupName, or portfolioCompanyId after resolve_entity.",
        );
      }
      return services.companyActivitySummary.summarizeCompanyActivity(caller, {
        ...(args.startupId !== undefined ? { startupId: args.startupId } : {}),
        ...(args.startupName !== undefined
          ? { startupName: args.startupName }
          : {}),
        ...(args.portfolioCompanyId !== undefined
          ? { portfolioCompanyId: args.portfolioCompanyId }
          : {}),
        ...(args.factLimit !== undefined ? { factLimit: args.factLimit } : {}),
        ...(args.notesLimit !== undefined ? { notesLimit: args.notesLimit } : {}),
        ...(args.dealsLimit !== undefined ? { dealsLimit: args.dealsLimit } : {}),
        ...(args.meetingsLimit !== undefined
          ? { meetingsLimit: args.meetingsLimit }
          : {}),
      });
    },
  }),
  defineAgentTool({
    name: "list_company_crm_activity",
    title: "List Company CRM Activity",
    description: formatToolDescription(TOOL_DESCRIPTIONS.list_company_crm_activity),

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
    description: formatToolDescription(TOOL_DESCRIPTIONS.list_company_documents),

    labels: ["drive", "documents", "portfolio"],
    sources: ["drive"],
    access: "confidential",
    approvalRequired: false,
    inputSchema: ListCompanyDocumentsArgs,
    execute: async ({ services, caller, args }) => {
      const docOptions: {
        titleContains?: string;
        limit?: number;
        includeBinaries?: boolean;
        driveTokens?: z.infer<typeof DriveTokenCandidatesArg>;
      } = {};
      if (args.titleContains !== undefined) {
        docOptions.titleContains = args.titleContains;
      }
      if (args.limit !== undefined) {
        docOptions.limit = args.limit;
      }
      if (args.includeBinaries !== undefined) {
        docOptions.includeBinaries = args.includeBinaries;
      }
      if (args.driveTokens !== undefined) {
        docOptions.driveTokens = args.driveTokens;
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
    description: formatToolDescription(TOOL_DESCRIPTIONS.read_company_document_excerpt),

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
    description: formatToolDescription(TOOL_DESCRIPTIONS.list_portfolio_context),

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
    name: "list_portfolio_companies",
    title: "List Portfolio Companies",
    description: formatToolDescription(TOOL_DESCRIPTIONS.list_portfolio_companies),

    labels: ["portfolio", "monday", "directory"],
    sources: ["monday", "hubspot", "drive"],
    access: "confidential",
    approvalRequired: false,
    inputSchema: ListPortfolioCompaniesArgs,
    execute: async ({ services, caller }) =>
      services.portfolioCompanies.listPortfolioCompanies(caller),
  }),
  defineAgentTool({
    name: "build_company_360_context",
    title: "Build Company 360 Context",
    description: formatToolDescription(TOOL_DESCRIPTIONS.build_company_360_context),

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
  defineAgentTool({
    name: "find_competitive_history",
    title: "Find Competitive History",
    description: formatToolDescription(TOOL_DESCRIPTIONS.find_competitive_history),

    labels: ["startup", "crm", "memory", "competitive"],
    sources: ["hubspot"],
    access: "confidential",
    approvalRequired: false,
    inputSchema: FindCompetitiveHistoryArgs,
    execute: async ({ services, caller, args }) =>
      services.competitiveHistory.findCompetitiveHistory(caller, {
        ...(args.startupId !== undefined ? { startupId: args.startupId } : {}),
        ...(args.startupName !== undefined ? { startupName: args.startupName } : {}),
        ...(args.sector !== undefined ? { sector: args.sector } : {}),
        ...(args.limit !== undefined ? { limit: args.limit } : {}),
        ...(args.notesPerMatch !== undefined ? { notesPerMatch: args.notesPerMatch } : {}),
        ...(args.authorEmail !== undefined ? { authorEmail: args.authorEmail } : {}),
      }),
  }),
  defineAgentTool({
    name: "find_similar_cases",
    title: "Find Similar Cases",
    description: formatToolDescription(TOOL_DESCRIPTIONS.find_similar_cases),

    labels: ["startup", "crm", "memory", "semantic"],
    sources: ["hubspot"],
    access: "confidential",
    approvalRequired: false,
    inputSchema: FindSimilarCasesArgs,
    execute: async ({ services, caller, args }) => {
      if (!services.similarCases) {
        throw BadRequest(
          "Semantic CRM memory is unavailable. Requires Postgres read model and embedding provider.",
        );
      }
      return services.similarCases.findSimilarCases(caller, {
        ...(args.startupId !== undefined ? { startupId: args.startupId } : {}),
        ...(args.startupName !== undefined ? { startupName: args.startupName } : {}),
        ...(args.query !== undefined ? { query: args.query } : {}),
        ...(args.noteId !== undefined ? { noteId: args.noteId } : {}),
        ...(args.authorEmail !== undefined ? { authorEmail: args.authorEmail } : {}),
        ...(args.sector !== undefined ? { sector: args.sector } : {}),
        ...(args.sinceDays !== undefined ? { sinceDays: args.sinceDays } : {}),
        ...(args.chunkKind !== undefined ? { chunkKind: args.chunkKind } : {}),
        ...(args.limit !== undefined ? { limit: args.limit } : {}),
      });
    },
  }),
  defineAgentTool({
    name: "resolve_company_drive_folder",
    title: "Resolve Company Drive Folder",
    description: formatToolDescription(
      TOOL_DESCRIPTIONS.resolve_company_drive_folder,
    ),

    labels: ["drive", "documents", "portfolio", "routing"],
    sources: ["drive", "monday"],
    access: "confidential",
    approvalRequired: false,
    inputSchema: ResolveCompanyDriveFolderArgs,
    execute: async ({ services, caller, args }) =>
      services.companyDriveFolder.resolveCompanyDriveFolder(caller, {
        ...(args.portfolioCompanyId !== undefined
          ? { portfolioCompanyId: args.portfolioCompanyId }
          : {}),
        ...(args.startupId !== undefined ? { startupId: args.startupId } : {}),
        ...(args.startupName !== undefined
          ? { startupName: args.startupName }
          : {}),
        ...(args.purpose !== undefined ? { purpose: args.purpose } : {}),
        ...(args.folderLimit !== undefined
          ? { folderLimit: args.folderLimit }
          : {}),
        ...(args.inventoryLimit !== undefined
          ? { inventoryLimit: args.inventoryLimit }
          : {}),
        ...(args.driveTokens !== undefined
          ? { driveTokens: args.driveTokens }
          : {}),
      }),
  }),
  defineAgentTool({
    name: "read_bp_playbook",
    title: "Read BP Playbook",
    description: formatToolDescription(TOOL_DESCRIPTIONS.read_bp_playbook),

    labels: ["playbook", "finance", "bp", "methodology"],
    sources: ["playbook"],
    access: "confidential",
    approvalRequired: false,
    inputSchema: z
      .object({
        section: z
          .enum([
            "goal",
            "template",
            "modes",
            "tools",
            "mapping",
            "revenue",
            "payroll",
            "debt",
            "benchmark",
            "confidentiality",
            "mistakes",
          ])
          .optional(),
      })
      .strict(),
    execute: async ({ args }) => readBpPlaybook(args.section),
  }),
  defineAgentTool({
    name: "assemble_company_finance_pack",
    title: "Assemble Company Finance Pack",
    description: formatToolDescription(
      TOOL_DESCRIPTIONS.assemble_company_finance_pack,
    ),

    labels: ["drive", "finance", "bp", "classification"],
    sources: ["drive"],
    access: "confidential",
    approvalRequired: false,
    inputSchema: AssembleCompanyFinancePackArgs,
    execute: async ({ services, caller, args }) =>
      services.bpWorkflow.assembleCompanyFinancePack(caller, {
        ...(args.portfolioCompanyId !== undefined
          ? { portfolioCompanyId: args.portfolioCompanyId }
          : {}),
        ...(args.driveTokens !== undefined ? { driveTokens: args.driveTokens } : {}),
        ...(args.titleContains !== undefined ? { titleContains: args.titleContains } : {}),
        ...(args.documentLimit !== undefined ? { documentLimit: args.documentLimit } : {}),
        ...(args.peekFounderBpSheets !== undefined
          ? { peekFounderBpSheets: args.peekFounderBpSheets }
          : {}),
      }),
  }),
  defineAgentTool({
    name: "draft_bp_tab_debt",
    title: "Draft BP Financement Tab",
    description: formatToolDescription(TOOL_DESCRIPTIONS.draft_bp_tab_debt),

    labels: ["drive", "finance", "bp", "draft"],
    sources: ["drive"],
    access: "confidential",
    approvalRequired: false,
    inputSchema: DraftBpTabDebtArgs,
    execute: async ({ services, caller, args }) =>
      services.bpWorkflow.draftBpTabDebt(caller, {
        ...(args.portfolioCompanyId !== undefined
          ? { portfolioCompanyId: args.portfolioCompanyId }
          : {}),
        founderBpFileId: args.founderBpFileId,
        ...(args.sourceTab !== undefined ? { sourceTab: args.sourceTab } : {}),
      }),
  }),
  // --- Signal Hub tools ---

  defineAgentTool({
    name: "signal_hub_list_watched",
    title: "Signal Hub: List Watched Entities",
    description: formatToolDescription(TOOL_DESCRIPTIONS.signal_hub_list_watched),

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
    description: formatToolDescription(TOOL_DESCRIPTIONS.signal_hub_add_watched),

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
    description: formatToolDescription(TOOL_DESCRIPTIONS.signal_hub_set_priority),

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
    description: formatToolDescription(TOOL_DESCRIPTIONS.signal_hub_recent_signals),

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
    description: formatToolDescription(TOOL_DESCRIPTIONS.signal_hub_search_signals),

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
    description: formatToolDescription(TOOL_DESCRIPTIONS.signal_hub_resolve_entity),

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
    description: formatToolDescription(TOOL_DESCRIPTIONS.signal_hub_list_accounts),

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
    description: formatToolDescription(TOOL_DESCRIPTIONS.signal_hub_request_refresh),

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
    description: formatToolDescription(TOOL_DESCRIPTIONS.signal_hub_freeze_account),

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
