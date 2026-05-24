import { BadRequest } from "../errors/index.js";
import type { Connectors } from "../connectors/registry.js";
import type { Identity } from "../domain/identity.js";
import type {
  Deal,
  Event,
  Meeting,
  Note,
  PortfolioCompany,
  PortfolioSignal,
  Startup,
} from "../domain/entities.js";
import type { StartupsService } from "./startups.js";
import type { SocietyService } from "./society.js";
import {
  CRM_ACTIVITY_DEFAULT_LIMITS,
  clampCrmLimit,
} from "./crmActivityLimits.js";
import { prepareDriveDocumentList } from "./driveDocuments.js";

const normalizeKey = (value: string): string => value.trim().toLowerCase();

export type ResolvedEntityCandidate = {
  canonicalName: string;
  startupId: string | undefined;
  portfolioCompanyId: string | undefined;
  matchedSources: ("hubspot" | "monday")[];
};

export type ResolveEntityOutput = {
  query: string;
  candidates: ResolvedEntityCandidate[];
  needsClarification: boolean;
  warnings: string[];
};

export type ListCompanyDocumentsOutput = {
  portfolioCompanyId: string;
  documents: Array<{
    driveFileId: string;
    title: string;
    createdAt: string;
    relevance: string;
    relevanceScore: number;
    textExtractable: boolean;
    citation: { system: "drive"; externalId: string; url: undefined };
  }>;
  warnings: string[];
};

export type ReadCompanyDocumentExcerptOutput = {
  portfolioCompanyId: string;
  driveFileId: string;
  title: string;
  excerpt: string;
  truncated: boolean;
  warnings: string[];
};

export type ListPortfolioContextOutput = {
  portfolioCompanyId: string;
  portfolioRow: PortfolioCompany | undefined;
  signals: PortfolioSignal[];
  upcomingEvents: Event[];
  warnings: string[];
};

export type BuildCompany360Section =
  | "profile"
  | "crm_activity"
  | "documents"
  | "portfolio_signals"
  | "events";

export type Company360Output = {
  portfolioCompanyId: string | undefined;
  startupId: string | undefined;
  startupProfile: Startup | undefined;
  sectionsIncluded: BuildCompany360Section[];
  startup: Startup | undefined;
  notes: Note[];
  deals: Deal[];
  meetings: Meeting[];
  documents: ListCompanyDocumentsOutput["documents"];
  signals: PortfolioSignal[];
  upcomingEvents: Event[];
  warnings: string[];
};

export type ListCompanyCrmActivityOutput = {
  selector: Record<string, string | undefined>;
  notes: Note[];
  deals: Deal[];
  meetings: Meeting[];
  warnings: string[];
};

export const buildCompanyContextService = (deps: {
  connectors: Connectors;
  startups: StartupsService;
  society: SocietyService;
}) => {
  const { connectors, startups, society } = deps;

  const derivePortfolioCompanyIdFromStartup = (
    startup: Startup,
    portfolio: PortfolioCompany[],
  ): string | undefined =>
    portfolio.find((p) =>
      normalizeKey(p.startupId) === normalizeKey(startup.name),
    )?.id;

  const listCompanyDocuments = async (
    caller: Identity,
    portfolioCompanyId: string,
    options?: {
      titleContains?: string | undefined;
      limit?: number | undefined;
      includeBinaries?: boolean | undefined;
    },
  ): Promise<ListCompanyDocumentsOutput> => {
    const warnings: string[] = [];
    await society.ensurePortfolioCompanyInScope(caller, portfolioCompanyId);

    const raw = await connectors.drive.listBoardPacksForCompany(portfolioCompanyId);
    let filtered = [...raw];
    const needle = options?.titleContains?.trim();
    if (needle) {
      const k = needle.toLowerCase();
      filtered = filtered.filter((f) => f.title.toLowerCase().includes(k));
    }

    const prepared = prepareDriveDocumentList(
      filtered.map((file) => ({
        driveFileId: file.driveFileId,
        title: file.title,
        createdAt: file.createdAt,
        ...(file.mimeType !== undefined ? { mimeType: file.mimeType } : {}),
      })),
      {
        includeBinaries: options?.includeBinaries ?? false,
        limit: options?.limit ?? 25,
      },
    );
    warnings.push(...prepared.warnings);

    const documents = prepared.documents.map((file) => ({
      driveFileId: file.driveFileId,
      title: file.title,
      createdAt: file.createdAt,
      relevance: file.relevance,
      relevanceScore: file.relevanceScore,
      textExtractable: file.textExtractable,
      citation: {
        system: "drive" as const,
        externalId: file.driveFileId,
        url: undefined as undefined,
      },
    }));

    if (documents.length === 0) {
      warnings.push(
        "No Drive files matched. Drive search relies on substring matches on the portfolio company identifier.",
      );
    }

    return { portfolioCompanyId, documents, warnings };
  };

  const listPortfolioContext = async (
    caller: Identity,
    portfolioCompanyId: string,
    options?: { sinceDaysSignals?: number; eventsLimit?: number },
  ): Promise<ListPortfolioContextOutput> => {
    const warnings: string[] = [];

    await society.ensurePortfolioCompanyInScope(caller, portfolioCompanyId);

    const portfolio = await connectors.monday.listPortfolio();
    const row = portfolio.find((p) =>
      p.id === portfolioCompanyId,
    );

    if (!row) {
      warnings.push(
        "This identifier is permitted by caller scope but not present in Monday portfolio boards.",
      );
    }

    const sinceDays = options?.sinceDaysSignals ?? 30;
    const signals = await society.getPortfolioSignals(caller, portfolioCompanyId, sinceDays);

    const events = await connectors.monday.listUpcomingEvents();

    let upcomingEvents =
      [...events].sort((left, right) => left.startsAt.localeCompare(right.startsAt));
    const eventLimit = options?.eventsLimit ?? 25;
    if (upcomingEvents.length > eventLimit) {
      upcomingEvents = upcomingEvents.slice(0, eventLimit);
      warnings.push(`Upcoming events truncated to ${String(eventLimit)}.`);
    }

    if (signals.length === 0) {
      warnings.push(
        "No portfolio signals indexed for this horizon. Monday connector may return an empty stub until signals exist.",
      );
    }

    return {
      portfolioCompanyId,
      portfolioRow: row,
      signals,
      upcomingEvents,
      warnings,
    };
  };

  return {
    resolveEntity: async (
      caller: Identity,
      query: string,
      options?: { limit?: number },
    ): Promise<ResolveEntityOutput> => {
      const warnings: string[] = [];
      const trimmed = query.trim();
      const needle = normalizeKey(query);
      if (!needle) {
        throw BadRequest(
          "Query must contain at least one non-space character.",
        );
      }

      if (needle.length < 2) {
        warnings.push(
          "Query is too short; substring matching will be noisy. Provide at least 2 characters.",
        );
      }

      const limitMatches = Math.max(1, Math.min(options?.limit ?? 20, 50));

      const [hubSpotMatches, portfolio] = await Promise.all([
        startups.searchStartups(caller, { startupName: query }, { limit: limitMatches }),
        connectors.monday.listPortfolio(),
      ]);

      const mondayMatches = portfolio.filter((row) =>
        normalizeKey(row.id).includes(needle) ||
        normalizeKey(row.startupId).includes(needle),
      );

      const candidateById = new Map<string, ResolvedEntityCandidate>();
      const orderedKeys: string[] = [];
      const keyForHubspot = (s: Startup): string => `hub:${s.id}`;
      const keyForMonday = (row: PortfolioCompany): string =>
        `mon:${normalizeKey(row.id)}`;

      const recordCandidate = (
        key: string,
        candidate: ResolvedEntityCandidate,
      ): void => {
        const existing = candidateById.get(key);
        if (!existing) {
          candidateById.set(key, candidate);
          orderedKeys.push(key);
          return;
        }
        existing.canonicalName = candidate.canonicalName || existing.canonicalName;
        if (candidate.startupId !== undefined) {
          existing.startupId = candidate.startupId;
        }
        if (candidate.portfolioCompanyId !== undefined) {
          existing.portfolioCompanyId = candidate.portfolioCompanyId;
        }
        const mergedSources = new Set([
          ...existing.matchedSources,
          ...candidate.matchedSources,
        ]);
        existing.matchedSources = [...mergedSources];
      };

      for (const s of hubSpotMatches) {
        const portfolioId = derivePortfolioCompanyIdFromStartup(s, portfolio);
        recordCandidate(keyForHubspot(s), {
          canonicalName: s.name,
          startupId: s.id,
          portfolioCompanyId: portfolioId,
          matchedSources: portfolioId ? ["hubspot", "monday"] : ["hubspot"],
        });
      }

      for (const row of mondayMatches) {
        const linkedStartup = hubSpotMatches.find(
          (item) => normalizeKey(item.name) === normalizeKey(row.startupId),
        );
        if (linkedStartup) {
          recordCandidate(keyForHubspot(linkedStartup), {
            canonicalName: linkedStartup.name,
            startupId: linkedStartup.id,
            portfolioCompanyId: row.id,
            matchedSources: ["hubspot", "monday"],
          });
          continue;
        }
        recordCandidate(keyForMonday(row), {
          canonicalName: row.startupId,
          startupId: undefined,
          portfolioCompanyId: row.id,
          matchedSources: ["monday"],
        });
      }

      let candidates = orderedKeys
        .map((key) => candidateById.get(key))
        .filter((value): value is ResolvedEntityCandidate => value !== undefined);

      const exactCandidates = candidates.filter(
        (c) =>
          normalizeKey(c.canonicalName) === needle ||
          (c.portfolioCompanyId !== undefined &&
            normalizeKey(c.portfolioCompanyId) === needle) ||
          (c.startupId !== undefined && c.startupId === trimmed),
      );

      const uniqueExactMatch = exactCandidates.length === 1
        ? exactCandidates[0]
        : undefined;

      if (uniqueExactMatch) {
        candidates = [uniqueExactMatch];
      } else if (candidates.length > limitMatches) {
        warnings.push(
          `Result truncated to ${String(limitMatches)} candidates. Narrow the query.`,
        );
        candidates = candidates.slice(0, limitMatches);
      }

      if (candidates.length === 0) {
        warnings.push(
          "No candidate matched. Verify spelling or rely on search_startups directly.",
        );
      }

      const needsClarification = uniqueExactMatch === undefined && candidates.length > 1;

      return {
        query,
        candidates,
        needsClarification,
        warnings,
      };
    },

    listCompanyCrmActivity: async (
      caller: Identity,
      args: {
        startupId?: string | undefined;
        startupName?: string | undefined;
        portfolioCompanyId?: string | undefined;
        includeNotes: boolean;
        includeDeals: boolean;
        includeMeetings: boolean;
        notesLimit?: number | undefined;
        dealsLimit?: number | undefined;
        meetingsLimit?: number | undefined;
      },
    ): Promise<ListCompanyCrmActivityOutput> => {
      const warnings: string[] = [];
      let lookup: {
        startupId?: string | undefined;
        startupName?: string | undefined;
      };
      let selectorSummary: Record<string, string | undefined>;

      if (args.startupId) {
        lookup = { startupId: args.startupId };
        selectorSummary = { startupId: args.startupId };
      } else if (args.startupName !== undefined) {
        lookup = { startupName: args.startupName };
        selectorSummary = { startupName: args.startupName };
      } else if (args.portfolioCompanyId !== undefined) {
        lookup = { startupName: args.portfolioCompanyId };
        selectorSummary = { portfolioCompanyId: args.portfolioCompanyId };
        warnings.push(
          "portfolioCompanyId uses the Monday board-derived name token to align with CRM company names.",
        );
      } else {
        throw BadRequest("Provide startupId, startupName or portfolioCompanyId.");
      }

      const notesLimit = clampCrmLimit(
        args.notesLimit,
        CRM_ACTIVITY_DEFAULT_LIMITS.notes,
        200,
      );
      const dealsLimit = clampCrmLimit(
        args.dealsLimit,
        CRM_ACTIVITY_DEFAULT_LIMITS.deals,
        200,
      );
      const meetingsLimit = clampCrmLimit(
        args.meetingsLimit,
        CRM_ACTIVITY_DEFAULT_LIMITS.meetings,
        200,
      );

      const listOptsNotes = args.includeNotes ? { limit: notesLimit } : undefined;
      const listOptsDeals = args.includeDeals ? { limit: dealsLimit } : undefined;
      const listOptsMeetings = args.includeMeetings
        ? { limit: meetingsLimit }
        : undefined;

      const notes = args.includeNotes
        ? await startups.listAccessibleNotes(caller, lookup, listOptsNotes)
        : [];
      const deals = args.includeDeals
        ? await startups.listAccessibleDeals(caller, lookup, listOptsDeals)
        : [];
      const meetings = args.includeMeetings
        ? await startups.listAccessibleMeetings(caller, lookup, listOptsMeetings)
        : [];

      if (notes.length === 0 && deals.length === 0 && meetings.length === 0) {
        warnings.push(
          "No CRM activity returned. Narrow the startup selector until it resolves to one HubSpot company visible to this caller.",
        );
      }

      return {
        selector: selectorSummary,
        notes,
        deals,
        meetings,
        warnings,
      };
    },

    listCompanyDocuments,

    readCompanyDocumentExcerpt: async (
      caller: Identity,
      args: {
        portfolioCompanyId: string;
        driveFileId: string;
        maxChars: number;
        charOffset?: number | undefined;
      },
    ): Promise<ReadCompanyDocumentExcerptOutput> => {
      const warnings: string[] = [];
      await society.ensurePortfolioCompanyInScope(caller, args.portfolioCompanyId);

      const allowedFiles = await connectors.drive.listBoardPacksForCompany(
        args.portfolioCompanyId,
      );

      const fileMeta = allowedFiles.find((file) =>
        file.driveFileId === args.driveFileId,
      );

      if (!fileMeta) {
        throw BadRequest(
          "driveFileId is not listed for this portfolio company. Call list_company_documents first.",
          { driveFileId: args.driveFileId, portfolioCompanyId: args.portfolioCompanyId },
        );
      }

      const MIN_WINDOW = 512;
      const MAX_WINDOW = 120_000;
      const clampedOffset = Math.max(0, args.charOffset ?? 0);
      const requestedLength = args.maxChars;
      const clampedLength = Math.max(MIN_WINDOW, Math.min(requestedLength, MAX_WINDOW));
      if (requestedLength < MIN_WINDOW) {
        warnings.push(
          `maxChars clamped to the minimum window of ${String(MIN_WINDOW)} characters.`,
        );
      }
      if (requestedLength > MAX_WINDOW) {
        warnings.push(
          `maxChars clamped to the maximum window of ${String(MAX_WINDOW)} characters.`,
        );
      }

      let fullText: string;
      try {
        fullText = await connectors.drive.fetchDocumentText(fileMeta.driveFileId);
      } catch (error) {
        throw BadRequest(
          "Drive text extraction failed for this mime type.",
          {
            driveFileId: args.driveFileId,
            cause: error instanceof Error ? error.message : String(error),
          },
        );
      }

      if (fullText.startsWith("[") && fullText.includes("binary format")) {
        warnings.push(
          "Document text unavailable for exported binaries.",
        );
      }

      const codepoints = [...fullText];
      const totalChars = codepoints.length;

      if (clampedOffset >= totalChars && totalChars > 0) {
        warnings.push(
          `charOffset (${String(clampedOffset)}) is past document end (${String(totalChars)}).`,
        );
      }

      const windowText =
        codepoints.slice(clampedOffset, clampedOffset + clampedLength).join("");
      const truncated = clampedOffset + [...windowText].length < totalChars;

      if (truncated) {
        warnings.push(
          "Excerpt truncated relative to document length. Adjust charOffset or maxChars.",
        );
      }

      return {
        portfolioCompanyId: args.portfolioCompanyId,
        driveFileId: args.driveFileId,
        title: fileMeta.title,
        excerpt: windowText,
        truncated,
        warnings,
      };
    },

    listPortfolioContext,

    buildCompany360Context: async (
      caller: Identity,
      args: {
        sections: BuildCompany360Section[];
        portfolioCompanyId?: string | undefined;
        startupId?: string | undefined;
        startupName?: string | undefined;
        notesLimit?: number | undefined;
        dealsLimit?: number | undefined;
        meetingsLimit?: number | undefined;
        documentsLimit?: number | undefined;
        sinceDaysSignals?: number | undefined;
        eventsLimit?: number | undefined;
      },
    ): Promise<Company360Output> => {
      const warnings: string[] = [];
      const portfolio = await connectors.monday.listPortfolio();

      let startupState: Startup | undefined;
      let portfolioCompanyId = args.portfolioCompanyId;

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
          throw BadRequest("Startup selector did not resolve to a visible CRM record.");
        }
        if (matches.length > 1) {
          throw BadRequest(
            "Startup selector matched multiple startups. Prefer startupId or narrow startupName.",
            {
              matches: matches.map((item) => ({
                startupId: item.id,
                name: item.name,
              })),
            },
          );
        }
        const resolvedStartup = matches[0];
        if (!resolvedStartup) {
          throw BadRequest("Startup selector did not resolve to a visible CRM record.");
        }
        startupState = resolvedStartup;
        portfolioCompanyId = portfolioCompanyId ??
          derivePortfolioCompanyIdFromStartup(resolvedStartup, portfolio);

        const needsPortfolio = args.sections.some((item) =>
          item === "documents" || item === "portfolio_signals" || item === "events",
        );
        if (!portfolioCompanyId && needsPortfolio) {
          warnings.push(
            "No Monday-linked portfolio identifier was inferred from the startup profile; sections that require portfolioCompanyId are skipped.",
          );
        }
      } else if (!portfolioCompanyId) {
        throw BadRequest(
          "Provide portfolioCompanyId plus optional startup selectors, or at least startupId/startupName.",
        );
      }

      if (portfolioCompanyId !== undefined) {
        await society.ensurePortfolioCompanyInScope(caller, portfolioCompanyId);
      }

      let startupHydrated =
        startupState;

      if (!startupHydrated && portfolioCompanyId) {
        const row = portfolio.find((p) => p.id === portfolioCompanyId);
        if (row) {
          const byName = await startups.searchStartups(
            caller,
            { startupName: row.startupId },
            { limit: 2 },
          );
          startupHydrated = byName.length === 1 ? byName[0] : undefined;
        }
      }

      const sectionsIncluded = [...args.sections];

      let notes: Note[] = [];
      let deals: Deal[] = [];
      let meetings: Meeting[] = [];
      let documents: ListCompanyDocumentsOutput["documents"] = [];
      let signals: PortfolioSignal[] = [];
      let upcomingEvents: Event[] = [];

      let startupLookup: {
        startupId?: string | undefined;
        startupName?: string | undefined;
      } | undefined;

      if (
        sectionsIncluded.some((section) =>
          section === "profile" ||
          section === "crm_activity",
        )
      ) {
        if (startupHydrated) {
          startupLookup = { startupId: startupHydrated.id };
        } else if (args.startupId) {
          startupLookup = { startupId: args.startupId };
        } else if (args.startupName) {
          startupLookup = { startupName: args.startupName };
        } else if (portfolioCompanyId) {
          startupLookup = { startupName: portfolioCompanyId };
          warnings.push(
            "CRM lookup uses the board-derived portfolio identifier; results may be empty if it does not match the HubSpot company name.",
          );
        } else {
          startupLookup = undefined;
        }

        if (!startupLookup) {
          warnings.push(
            "profile/crm_activity skipped: startup linkage unresolved.",
          );
        }
      }

      if (
        sectionsIncluded.includes("crm_activity") && startupLookup
      ) {
        notes = await startups.listAccessibleNotes(
          caller,
          startupLookup,
          args.notesLimit !== undefined ? { limit: args.notesLimit } : undefined,
        );
        deals = await startups.listAccessibleDeals(
          caller,
          startupLookup,
          args.dealsLimit !== undefined ? { limit: args.dealsLimit } : undefined,
        );
        meetings = await startups.listAccessibleMeetings(
          caller,
          startupLookup,
          args.meetingsLimit !== undefined
            ? { limit: args.meetingsLimit }
            : undefined,
        );
      }

      const startupProfile =
        sectionsIncluded.includes("profile") ?
          (startupHydrated ?? startupState) :
          undefined;

      if (sectionsIncluded.includes("documents") && portfolioCompanyId) {
        const docOptions: { limit?: number } = {};
        if (args.documentsLimit !== undefined) {
          docOptions.limit = args.documentsLimit;
        }
        const docPack = await listCompanyDocuments(
          caller,
          portfolioCompanyId,
          docOptions,
        );
        documents = docPack.documents;
        warnings.push(...docPack.warnings);
      }

      if (
        sectionsIncluded.some((item) => item === "portfolio_signals" || item === "events") &&
        portfolioCompanyId !== undefined
      ) {
        const ctxOptions: {
          sinceDaysSignals: number;
          eventsLimit?: number;
        } = {
          sinceDaysSignals: args.sinceDaysSignals ?? 45,
        };
        if (args.eventsLimit !== undefined) {
          ctxOptions.eventsLimit = args.eventsLimit;
        }
        const ctx = await listPortfolioContext(
          caller,
          portfolioCompanyId,
          ctxOptions,
        );
        signals = sectionsIncluded.includes("portfolio_signals") ? ctx.signals : [];
        upcomingEvents = sectionsIncluded.includes("events") ? ctx.upcomingEvents : [];
        warnings.push(...ctx.warnings);
      }

      return {
        portfolioCompanyId,
        startupId: startupHydrated?.id ?? args.startupId,
        startupProfile,
        sectionsIncluded,
        startup: startupHydrated ?? startupState,
        notes:
          sectionsIncluded.includes("crm_activity") && startupLookup ?
            notes :
            [],
        deals:
          sectionsIncluded.includes("crm_activity") && startupLookup ?
            deals :
            [],
        meetings:
          sectionsIncluded.includes("crm_activity") && startupLookup ?
            meetings :
            [],
        documents,
        signals,
        upcomingEvents,
        warnings,
      };
    },
  };
};

export type CompanyContextService = ReturnType<typeof buildCompanyContextService>;
