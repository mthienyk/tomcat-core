import { BadRequest, NotFound } from "../errors/index.js";
import type { Connectors } from "../connectors/registry.js";
import type { Identity } from "../domain/identity.js";
import type { Citation, Deal, Meeting, Note, PortfolioSignal, Startup } from "../domain/entities.js";
import type { SignalEvent } from "../domain/signalHub.js";
import {
  ToolWarningCodes,
  wrapToolOutput,
  type SuggestedToolCall,
  type ToolRunEnvelope,
  type ToolWarning,
} from "../domain/mcpToolOutput.js";
import { canSeeSignal } from "../permissions/policies.js";
import type { SocietyService } from "./society.js";
import type { StartupsService } from "./startups.js";
import type { SignalHubService } from "./signalHub/index.js";
import { filterSignalHubSuggestions } from "../agent/toolCatalog.js";
import { prepareDriveDocumentList } from "./driveDocuments.js";

export type PrepChecklistStatus = "ready" | "missing" | "review";

export type PrepChecklistItem = {
  id: string;
  label: string;
  status: PrepChecklistStatus;
  detail: string | undefined;
};

export type BoardBriefData = {
  portfolioCompanyId: string;
  startupId: string;
  canonicalName: string;
  executiveSnapshot: {
    headlineHighlights: string[];
    headlineRisks: string[];
    openQuestions: string[];
  };
  mondaySignals: {
    highlights: string[];
    risks: string[];
    signalCount: number;
  };
  crmTimeline: {
    recentNotes: Array<{
      id: string;
      excerpt: string;
      sensitivity: string;
      createdAt: string;
    }>;
    activeDeals: Array<{
      id: string;
      status: string;
      amountEur: number | undefined;
      updatedAt: string;
    }>;
    recentMeetings: Array<{
      id: string;
      subject: string;
      occurredAt: string;
    }>;
  };
  driveDocuments: {
    latestBoardPack: {
      driveFileId: string;
      title: string;
      createdAt: string;
    } | null;
    recentDocuments: Array<{
      driveFileId: string;
      title: string;
      createdAt: string;
    }>;
  };
  linkedInSignals: {
    signalCount: number;
    recentSignals: Array<{
      id: string;
      excerpt: string;
      source: string;
      ingestedAt: string;
    }>;
  };
  prepChecklist: PrepChecklistItem[];
};

/** Flat shape kept for HTTP `/internal/briefs/board-prep` and deprecated MCP tool. */
export type BoardPrepBrief = {
  portfolioCompanyId: string;
  startupId: string;
  highlights: string[];
  risks: string[];
  citations: Citation[];
};

export type BoardBriefSelector = {
  portfolioCompanyId?: string;
  startupId?: string;
  startupName?: string;
};

export type BoardBriefOptions = BoardBriefSelector & {
  sinceDaysMonday?: number;
  sinceDaysLinkedIn?: number;
  notesLimit?: number;
  dealsLimit?: number;
  meetingsLimit?: number;
  driveDocsLimit?: number;
  linkedInLimit?: number;
};

const NOTE_EXCERPT_MAX = 320;
const SIGNAL_EXCERPT_MAX = 240;
const BOARD_KEYWORD = "board";
const MS_PER_DAY = 86_400_000;

const normalizeKey = (value: string): string => value.trim().toLowerCase();

const excerpt = (text: string, maxChars: number): string =>
  text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;

const isBoardPackTitle = (title: string): boolean =>
  normalizeKey(title).includes(BOARD_KEYWORD);

const daysSince = (isoDate: string, nowMs: number): number => {
  const parsed = Date.parse(isoDate);
  if (Number.isNaN(parsed)) return Number.POSITIVE_INFINITY;
  return (nowMs - parsed) / MS_PER_DAY;
};

const buildOpenQuestions = (input: {
  latestBoardPack: BoardBriefData["driveDocuments"]["latestBoardPack"];
  recentNotes: BoardBriefData["crmTimeline"]["recentNotes"];
  recentMeetings: BoardBriefData["crmTimeline"]["recentMeetings"];
  mondayRisks: string[];
  linkedInCount: number;
  mondayCount: number;
  activeDeals: Deal[];
  nowMs: number;
}): string[] => {
  const questions: string[] = [];

  if (!input.latestBoardPack) {
    questions.push(
      "Where is the latest board deck? No recent board pack matched in Drive.",
    );
  } else if (daysSince(input.latestBoardPack.createdAt, input.nowMs) > 120) {
    questions.push(
      "Is the indexed board deck still current? Latest match is older than 120 days.",
    );
  }

  if (input.recentNotes.length === 0) {
    questions.push(
      "What changed since the last CRM update? No recent HubSpot notes are indexed.",
    );
  }

  if (input.recentMeetings.length === 0) {
    questions.push(
      "What is on the founder agenda? No recent HubSpot meetings are indexed.",
    );
  }

  if (input.mondayRisks.length > 0 && input.recentNotes.length === 0) {
    questions.push(
      `Do Monday risk flags still hold? ${String(input.mondayRisks.length)} risk signal(s) with no matching CRM notes.`,
    );
  }

  if (input.linkedInCount > 0 && input.mondayCount === 0) {
    questions.push(
      "Does LinkedIn activity explain gaps in Monday portfolio signals?",
    );
  }

  const activeDeals = input.activeDeals.filter(
    (deal) => deal.status === "diligence" || deal.status === "screening",
  );
  if (activeDeals.length > 0) {
    questions.push(
      `Should active pipeline stage (${activeDeals[0]!.status}) appear in the board narrative?`,
    );
  }

  return questions;
};

const buildPrepChecklist = (input: {
  mondayHighlights: string[];
  mondayRisks: string[];
  recentNotes: BoardBriefData["crmTimeline"]["recentNotes"];
  latestBoardPack: BoardBriefData["driveDocuments"]["latestBoardPack"];
  recentMeetings: BoardBriefData["crmTimeline"]["recentMeetings"];
  linkedInCount: number;
}): PrepChecklistItem[] => {
  const mondayCount = input.mondayHighlights.length + input.mondayRisks.length;
  const mondayStatus: PrepChecklistStatus =
    mondayCount === 0 ? "missing" : input.mondayRisks.length > 0 ? "review" : "ready";

  const linkedInStatus: PrepChecklistStatus =
    input.linkedInCount === 0
      ? "missing"
      : mondayCount === 0
        ? "review"
        : "ready";

  return [
    {
      id: "monday_signals",
      label: "Monday portfolio signals",
      status: mondayStatus,
      detail:
        mondayCount === 0
          ? "No Monday highlights or risks indexed."
          : `${String(mondayCount)} signal(s) indexed.`,
    },
    {
      id: "crm_notes",
      label: "Recent HubSpot notes",
      status: input.recentNotes.length > 0 ? "ready" : "missing",
      detail:
        input.recentNotes.length > 0
          ? `${String(input.recentNotes.length)} note excerpt(s) attached.`
          : "No recent CRM notes visible to this caller.",
    },
    {
      id: "board_deck",
      label: "Latest board deck in Drive",
      status: input.latestBoardPack ? "ready" : "missing",
      detail: input.latestBoardPack?.title,
    },
    {
      id: "recent_meetings",
      label: "Recent HubSpot meetings",
      status: input.recentMeetings.length > 0 ? "ready" : "missing",
      detail:
        input.recentMeetings.length > 0
          ? `Last meeting: ${input.recentMeetings[0]!.subject}.`
          : "No recent meetings indexed.",
    },
    {
      id: "linkedin_signals",
      label: "Signal Hub LinkedIn activity",
      status: linkedInStatus,
      detail:
        input.linkedInCount > 0
          ? `${String(input.linkedInCount)} recent signal(s) indexed.`
          : "No recent LinkedIn signals for this startup.",
    },
  ];
};

export const toLegacyBoardPrepBody = (
  data: BoardBriefData,
  citations: Citation[],
): BoardPrepBrief => ({
  portfolioCompanyId: data.portfolioCompanyId,
  startupId: data.startupId,
  highlights: data.mondaySignals.highlights,
  risks: data.mondaySignals.risks,
  citations,
});

export const projectLegacyBoardPrepEnvelope = (
  envelope: ToolRunEnvelope<BoardBriefData>,
): ToolRunEnvelope<BoardPrepBrief> => {
  const deprecationWarning: ToolWarning = {
    code: ToolWarningCodes.DEPRECATED_TOOL,
    message:
      "build_board_prep_context is deprecated. Use prepare_board_brief instead.",
    mitigation:
      "Call prepare_board_brief for checklist, open questions, and LinkedIn signals.",
  };

  const upgradeHint: SuggestedToolCall = {
    toolName: "prepare_board_brief",
    reason: "Actionable board prep with checklist and open questions",
    arguments: { portfolioCompanyId: envelope.data.portfolioCompanyId },
  };

  const nextSuggestedTools = [
    upgradeHint,
    ...(envelope.nextSuggestedTools ?? []),
  ];

  return {
    data: toLegacyBoardPrepBody(envelope.data, envelope.citations),
    citations: envelope.citations,
    warnings: [deprecationWarning, ...envelope.warnings],
    nextSuggestedTools,
  };
};

export const buildBoardBriefService = (deps: {
  connectors: Connectors;
  startups: StartupsService;
  society: SocietyService;
  signalHub: SignalHubService;
  signalHubEnabled: boolean;
}) => {
  const { connectors, startups, society, signalHub, signalHubEnabled } = deps;

  const resolveCompany = async (
    caller: Identity,
    args: BoardBriefSelector,
  ): Promise<{
    portfolioCompanyId: string;
    startupId: string;
    canonicalName: string;
    mondayLinked: boolean;
  }> => {
    const portfolio = await connectors.monday.listPortfolio();

    const resolveHubspotFromPortfolioToken = async (
      token: string,
    ): Promise<Startup | undefined> => {
      const matches = await startups.searchStartups(
        caller,
        { startupName: token },
        { limit: 5 },
      );
      if (matches.length === 1) return matches[0];
      const exact = matches.filter(
        (item) => normalizeKey(item.name) === normalizeKey(token),
      );
      return exact.length === 1 ? exact[0] : undefined;
    };

    if (args.portfolioCompanyId) {
      const row = portfolio.find((item) => item.id === args.portfolioCompanyId);
      if (row) {
        const hubspotMatches = await startups.searchStartups(
          caller,
          { startupName: row.startupId },
          { limit: 2 },
        );
        const hubspotStartup = hubspotMatches.length === 1 ? hubspotMatches[0] : undefined;
        return {
          portfolioCompanyId: row.id,
          startupId: hubspotStartup?.id ?? row.startupId,
          canonicalName: hubspotStartup?.name ?? row.startupId,
          mondayLinked: true,
        };
      }

      const hubspotStartup = await resolveHubspotFromPortfolioToken(
        args.portfolioCompanyId,
      );
      if (!hubspotStartup) {
        throw NotFound(`Portfolio company ${args.portfolioCompanyId} not found`);
      }
      return {
        portfolioCompanyId: args.portfolioCompanyId,
        startupId: hubspotStartup.id,
        canonicalName: hubspotStartup.name,
        mondayLinked: false,
      };
    }

    if (args.startupId || args.startupName) {
      const matches = await startups.searchStartups(
        caller,
        {
          ...(args.startupId ? { startupId: args.startupId } : {}),
          ...(args.startupName ? { startupName: args.startupName } : {}),
        },
        { limit: 5 },
      );
      if (matches.length === 0) {
        throw BadRequest(
          "Startup selector did not resolve to a visible CRM record.",
        );
      }
      if (matches.length > 1) {
        throw BadRequest(
          "Startup selector matched multiple startups. Prefer startupId or call resolve_entity.",
          {
            matches: matches.map((item) => ({
              startupId: item.id,
              name: item.name,
            })),
          },
        );
      }
      const hubspotStartup = matches[0]!;
      const row = portfolio.find(
        (item) => normalizeKey(item.startupId) === normalizeKey(hubspotStartup.name),
      );
      return {
        portfolioCompanyId: row?.id ?? hubspotStartup.name,
        startupId: hubspotStartup.id,
        canonicalName: hubspotStartup.name,
        mondayLinked: row !== undefined,
      };
    }

    throw BadRequest(
      "Provide portfolioCompanyId or at least one startup selector (startupId/startupName).",
    );
  };

  const prepareBoardBrief = async (
    caller: Identity,
    args: BoardBriefOptions,
  ): Promise<ToolRunEnvelope<BoardBriefData>> => {
      const sinceDaysMonday = Math.min(args.sinceDaysMonday ?? 90, 180);
      const sinceDaysLinkedIn = Math.min(args.sinceDaysLinkedIn ?? 30, 90);
      const notesLimit = Math.min(args.notesLimit ?? 5, 20);
      const dealsLimit = Math.min(args.dealsLimit ?? 5, 20);
      const meetingsLimit = Math.min(args.meetingsLimit ?? 5, 20);
      const driveDocsLimit = Math.min(args.driveDocsLimit ?? 10, 25);
      const linkedInLimit = Math.min(args.linkedInLimit ?? 8, 25);

      const company = await resolveCompany(caller, args);
      await society.ensurePortfolioCompanyInScope(
        caller,
        company.portfolioCompanyId,
      );

      const nowMs = Date.now();
      const linkedInSinceIso = new Date(
        nowMs - sinceDaysLinkedIn * MS_PER_DAY,
      ).toISOString();

      const [
        mondaySignalsRaw,
        notes,
        deals,
        meetings,
        driveFiles,
        linkedInEvents,
      ] = await Promise.all([
        connectors.monday.listSignals(sinceDaysMonday),
        startups.listAccessibleNotes(
          caller,
          { startupId: company.startupId },
          { limit: notesLimit },
        ),
        startups.listAccessibleDeals(
          caller,
          { startupId: company.startupId },
          { limit: dealsLimit },
        ),
        startups.listAccessibleMeetings(
          caller,
          { startupId: company.startupId },
          { limit: meetingsLimit },
        ),
        connectors.drive.listBoardPacksForCompany(company.portfolioCompanyId),
        signalHubEnabled
          ? signalHub.listEvents(caller, {
              startupId: company.startupId,
              sinceIso: linkedInSinceIso,
              limit: linkedInLimit,
            })
          : Promise.resolve([]),
      ]);

      const visibleSignals = mondaySignalsRaw
        .filter((signal) => signal.portfolioCompanyId === company.portfolioCompanyId)
        .filter((signal) => canSeeSignal(caller, signal));

      const mondayHighlights = visibleSignals
        .filter((signal: PortfolioSignal) => signal.kind !== "risk")
        .map((signal) => signal.summary);
      const mondayRisks = visibleSignals
        .filter((signal: PortfolioSignal) => signal.kind === "risk")
        .map((signal) => signal.summary);

      const sortedDriveFiles = prepareDriveDocumentList(driveFiles, {
        includeBinaries: true,
        limit: driveDocsLimit,
      }).documents;
      const boardPacks = sortedDriveFiles.filter((file) =>
        isBoardPackTitle(file.title),
      );
      const latestBoardPack = boardPacks[0]
        ? {
            driveFileId: boardPacks[0].driveFileId,
            title: boardPacks[0].title,
            createdAt: boardPacks[0].createdAt,
          }
        : null;

      const recentDocuments = sortedDriveFiles.slice(0, driveDocsLimit).map(
        (file) => ({
          driveFileId: file.driveFileId,
          title: file.title,
          createdAt: file.createdAt,
        }),
      );

      const recentNotes = notes.map((note: Note) => ({
        id: note.id,
        excerpt: excerpt(note.body, NOTE_EXCERPT_MAX),
        sensitivity: note.sensitivity,
        createdAt: note.createdAt,
      }));

      const activeDeals = deals
        .filter(
          (deal: Deal) =>
            deal.status !== "passed" &&
            deal.status !== "lost" &&
            deal.status !== "invested",
        )
        .map((deal) => ({
          id: deal.id,
          status: deal.status,
          amountEur: deal.amountEur,
          updatedAt: deal.updatedAt,
        }));

      const recentMeetings = [...meetings]
        .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
        .slice(0, meetingsLimit)
        .map((meeting: Meeting) => ({
          id: meeting.id,
          subject: meeting.subject,
          occurredAt: meeting.occurredAt,
        }));

      const recentLinkedInSignals = linkedInEvents.map((event: SignalEvent) => ({
        id: event.id,
        excerpt: excerpt(event.rawText ?? event.url ?? event.signalType, SIGNAL_EXCERPT_MAX),
        source: event.source,
        ingestedAt: event.ingestedAt,
      }));

      const openQuestions = buildOpenQuestions({
        latestBoardPack,
        recentNotes,
        recentMeetings,
        mondayRisks,
        linkedInCount: recentLinkedInSignals.length,
        mondayCount: visibleSignals.length,
        activeDeals: deals,
        nowMs,
      });

      const prepChecklist = buildPrepChecklist({
        mondayHighlights,
        mondayRisks,
        recentNotes,
        latestBoardPack,
        recentMeetings,
        linkedInCount: recentLinkedInSignals.length,
      });

      const headlineHighlights = [
        ...mondayHighlights.slice(0, 3),
        ...recentNotes.slice(0, 2).map(
          (note) => `CRM: ${note.excerpt}`,
        ),
        ...recentLinkedInSignals.slice(0, 2).map(
          (signal) => `LinkedIn: ${signal.excerpt}`,
        ),
      ].slice(0, 6);

      const headlineRisks = mondayRisks.slice(0, 5);

      const citations: Citation[] = [
        ...notes.map((note: Note) => ({
          label: `Note ${note.id} (${note.sensitivity})`,
          source: note.source,
        })),
        ...boardPacks.slice(0, 3).map((pack) => ({
          label: pack.title,
          source: {
            system: "drive" as const,
            externalId: pack.driveFileId,
            url: undefined,
          },
        })),
        ...visibleSignals.slice(0, 5).map((signal: PortfolioSignal) => ({
          label: `Monday signal ${signal.id} (${signal.kind})`,
          source: {
            system: "monday" as const,
            externalId: signal.id,
            url: signal.sourceUrl,
          },
        })),
      ];

      const warnings: ToolWarning[] = [];
      if (!company.mondayLinked) {
        warnings.push({
          code: ToolWarningCodes.PORTFOLIO_LINK_MISSING,
          message:
            "No Monday portfolio row linked; brief uses HubSpot + Drive with the startup name as the Drive token.",
          mitigation:
            "Call resolve_entity once Monday linkage is restored, or pass portfolioCompanyId explicitly.",
        });
      }

      const mondayEmpty = mondayHighlights.length === 0 && mondayRisks.length === 0;
      const hasOtherSources =
        recentNotes.length > 0 ||
        latestBoardPack !== null ||
        recentLinkedInSignals.length > 0;

      if (mondayEmpty && !hasOtherSources) {
        warnings.push({
          code: ToolWarningCodes.MONDAY_SIGNALS_EMPTY,
          message:
            "No Monday portfolio signals, CRM notes, Drive board packs, or LinkedIn signals for this company.",
          mitigation: signalHubEnabled
            ? "Call signal_hub_recent_signals or resolve_company_drive_folder."
            : "Call resolve_company_drive_folder or list_company_documents.",
        });
      } else if (mondayEmpty) {
        warnings.push({
          code: ToolWarningCodes.MONDAY_SIGNALS_EMPTY,
          message:
            "Monday portfolio signals are empty; brief relies on CRM, Drive, and Signal Hub sources.",
          mitigation: signalHubEnabled
            ? "Prefer signal_hub_recent_signals for LinkedIn-native activity."
            : "Use CRM notes and Drive documents for board prep.",
        });
      }

      if (!latestBoardPack && sortedDriveFiles.length > 0) {
        warnings.push({
          code: ToolWarningCodes.BOARD_PACK_NOT_INDEXED,
          message:
            "Drive files exist but none match a board-pack filename pattern.",
          mitigation:
            "Call list_company_documents or resolve_company_drive_folder.",
        });
      }

      const nextSuggestedTools: SuggestedToolCall[] = [];
      if (latestBoardPack) {
        nextSuggestedTools.push({
          toolName: "read_company_document_excerpt",
          reason: "Read the latest board deck text for divergence checks",
          arguments: {
            portfolioCompanyId: company.portfolioCompanyId,
            driveFileId: latestBoardPack.driveFileId,
          },
        });
      } else {
        nextSuggestedTools.push({
          toolName: "list_company_documents",
          reason: "Locate board materials when no board pack matched",
          arguments: {
            portfolioCompanyId: company.portfolioCompanyId,
            titleContains: "board",
          },
        });
      }

      if (signalHubEnabled && (mondayEmpty || recentLinkedInSignals.length === 0)) {
        nextSuggestedTools.push({
          toolName: "signal_hub_recent_signals",
          reason: "Refresh LinkedIn-native signals for board prep",
          arguments: { startupId: company.startupId },
        });
      }

      if (prepChecklist.some((item) => item.id === "board_deck" && item.status === "missing")) {
        nextSuggestedTools.push({
          toolName: "resolve_company_drive_folder",
          reason: "Locate the conventional Drive folder for board inputs",
          arguments: {
            portfolioCompanyId: company.portfolioCompanyId,
            purpose: "reporting",
          },
        });
      }

      const data: BoardBriefData = {
        portfolioCompanyId: company.portfolioCompanyId,
        startupId: company.startupId,
        canonicalName: company.canonicalName,
        executiveSnapshot: {
          headlineHighlights,
          headlineRisks,
          openQuestions,
        },
        mondaySignals: {
          highlights: mondayHighlights,
          risks: mondayRisks,
          signalCount: visibleSignals.length,
        },
        crmTimeline: {
          recentNotes,
          activeDeals,
          recentMeetings,
        },
        driveDocuments: {
          latestBoardPack,
          recentDocuments,
        },
        linkedInSignals: {
          signalCount: recentLinkedInSignals.length,
          recentSignals: recentLinkedInSignals,
        },
        prepChecklist,
      };

      return wrapToolOutput(data, {
        citations,
        warnings,
        nextSuggestedTools: filterSignalHubSuggestions(
          nextSuggestedTools,
          signalHubEnabled,
        ),
      });
  };

  return {
    prepareBoardBrief,
    prepareLegacyBoardPrepContext: async (
      caller: Identity,
      portfolioCompanyId: string,
    ): Promise<ToolRunEnvelope<BoardPrepBrief>> => {
      const envelope = await prepareBoardBrief(caller, { portfolioCompanyId });
      return projectLegacyBoardPrepEnvelope(envelope);
    },
    legacyBoardPrepBody: async (
      caller: Identity,
      portfolioCompanyId: string,
    ): Promise<BoardPrepBrief> => {
      const envelope = await prepareBoardBrief(caller, { portfolioCompanyId });
      return toLegacyBoardPrepBody(envelope.data, envelope.citations);
    },
  };
};

export type BoardBriefService = ReturnType<typeof buildBoardBriefService>;
