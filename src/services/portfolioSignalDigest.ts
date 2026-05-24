import { BadRequest, Forbidden } from "../errors/index.js";
import type { Connectors } from "../connectors/registry.js";
import type { Identity } from "../domain/identity.js";
import type { Citation, PortfolioCompany, PortfolioSignal } from "../domain/entities.js";
import type { SignalEvent, WatchedEntityPriority } from "../domain/signalHub.js";
import { effectiveHuman, isInternalRole } from "../domain/identity.js";
import {
  ToolWarningCodes,
  wrapToolOutput,
  type SuggestedToolCall,
  type ToolWarning,
} from "../domain/mcpToolOutput.js";
import { canSeeNote, canSeeSignalForInvestor } from "../permissions/policies.js";
import type { SocietyService } from "./society.js";
import type { StartupsService } from "./startups.js";
import type { SignalHubService } from "./signalHub/index.js";
import { filterSignalHubSuggestions } from "../agent/toolCatalog.js";

const MS_PER_DAY = 86_400_000;
const NOTE_EXCERPT_MAX = 280;
const SIGNAL_EXCERPT_MAX = 240;
const MAX_PORTFOLIO_COMPANIES = 100;
const MAX_LINKEDIN_EVENTS = 500;
const MAX_NOTES_FETCH = 50;
const NOTES_FETCH_MULTIPLIER = 10;

export type DigestMondaySignal = {
  id: string;
  kind: PortfolioSignal["kind"];
  summary: string;
  detectedAt: string;
};

export type DigestLinkedInSignal = {
  id: string;
  source: SignalEvent["source"];
  signalType: SignalEvent["signalType"];
  excerpt: string;
  ingestedAt: string;
  url: string | undefined;
  watchedDisplayName: string | undefined;
};

export type DigestCrmNote = {
  id: string;
  excerpt: string;
  sensitivity: string;
  createdAt: string;
};

export type CompanyDigestEntry = {
  portfolioCompanyId: string;
  canonicalName: string;
  startupId: string | undefined;
  mondaySignals: DigestMondaySignal[];
  linkedInSignals: DigestLinkedInSignal[];
  crmNotes: DigestCrmNote[];
  sourceChannels: Array<"monday" | "signal_hub" | "hubspot">;
  factCount: number;
};

export type PortfolioSignalDigestData = {
  period: {
    sinceDays: number;
    sinceIso: string;
    untilIso: string;
  };
  scope: {
    portfolioCompanyCount: number;
    watchedEntityCount: number;
    priorityFilter: WatchedEntityPriority | undefined;
    scopedCompanyCount: number;
    quietCompaniesOmitted: number;
  };
  companies: CompanyDigestEntry[];
  unlinkedLinkedInSignals: DigestLinkedInSignal[];
  summary: {
    totalFacts: number;
    companiesWithActivity: number;
    companiesQuiet: number;
    unlinkedLinkedInCount?: number;
  };
};

type PortfolioScopeRow = {
  row: PortfolioCompany;
  canonicalName: string;
  startupId: string | undefined;
};

const normalizeKey = (value: string): string => value.trim().toLowerCase();

const excerpt = (text: string, maxChars: number): string =>
  text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;

const isWithinWindow = (isoDate: string, sinceMs: number): boolean => {
  const parsed = Date.parse(isoDate);
  return !Number.isNaN(parsed) && parsed >= sinceMs;
};

const compareIsoDesc = (left: string, right: string): number =>
  right.localeCompare(left);

const topMondaySignals = (
  signals: DigestMondaySignal[],
  limit: number,
): DigestMondaySignal[] =>
  [...signals]
    .sort((left, right) => compareIsoDesc(left.detectedAt, right.detectedAt))
    .slice(0, limit);

const topLinkedInSignals = (
  signals: DigestLinkedInSignal[],
  limit: number,
): DigestLinkedInSignal[] =>
  [...signals]
    .sort((left, right) => compareIsoDesc(left.ingestedAt, right.ingestedAt))
    .slice(0, limit);

const notesFetchLimit = (notesPerCompany: number): number =>
  Math.min(Math.max(notesPerCompany * NOTES_FETCH_MULTIPLIER, notesPerCompany), MAX_NOTES_FETCH);

const buildStartupIdByPortfolioToken = (
  portfolio: PortfolioCompany[],
  startupNameById: Map<string, string>,
  startupIdByName: Map<string, string>,
): Map<string, string | undefined> => {
  const out = new Map<string, string | undefined>();
  for (const row of portfolio) {
    const byToken = startupIdByName.get(normalizeKey(row.startupId));
    if (byToken) {
      out.set(row.id, byToken);
      continue;
    }
    const matched = [...startupNameById.entries()].find(
      ([, name]) => normalizeKey(name) === normalizeKey(row.startupId),
    );
    out.set(row.id, matched?.[0]);
  }
  return out;
};

const prioritizeScopeRows = (
  scopeRows: PortfolioScopeRow[],
  activityScore: ReadonlyMap<string, number>,
): PortfolioScopeRow[] => {
  if (scopeRows.length <= MAX_PORTFOLIO_COMPANIES) return scopeRows;
  return [...scopeRows]
    .sort((left, right) => {
      const scoreLeft = activityScore.get(left.row.id) ?? 0;
      const scoreRight = activityScore.get(right.row.id) ?? 0;
      if (scoreRight !== scoreLeft) return scoreRight - scoreLeft;
      return left.canonicalName.localeCompare(right.canonicalName);
    })
    .slice(0, MAX_PORTFOLIO_COMPANIES);
};

export const buildPortfolioSignalDigestService = (deps: {
  connectors: Connectors;
  startups: StartupsService;
  society: SocietyService;
  signalHub: SignalHubService;
  signalHubEnabled: boolean;
}) => {
  const { connectors, startups, society, signalHub, signalHubEnabled } = deps;

  const resolveScope = async (
    caller: Identity,
    portfolioCompanyId: string | undefined,
  ): Promise<PortfolioScopeRow[]> => {
    const portfolio = await connectors.monday.listPortfolio();
    const activeRows = portfolio.filter((row) => row.status === "active");

    let scopedRows = activeRows;
    if (portfolioCompanyId !== undefined) {
      await society.ensurePortfolioCompanyInScope(caller, portfolioCompanyId);
      scopedRows = activeRows.filter((row) => row.id === portfolioCompanyId);
      if (scopedRows.length === 0) {
        throw BadRequest(
          `Portfolio company "${portfolioCompanyId}" is not in the active Monday portfolio.`,
        );
      }
    } else {
      const human = effectiveHuman(caller);
      if (human?.role === "external_investor") {
        if (!human.investorId) {
          throw Forbidden("External investor identity must include investorId");
        }
        const investor = await connectors.investors.getInvestorById(human.investorId);
        if (!investor) {
          throw Forbidden("Investor record not found for caller scope");
        }
        const allowed = new Set(investor.portfolioCompanyIds);
        scopedRows = activeRows.filter((row) => allowed.has(row.id));
      } else if (!human || !isInternalRole(human.role)) {
        throw Forbidden("Portfolio digest requires internal_team or investor scope");
      }
    }

    const visibleStartups = await startups.searchStartups(caller, {}, { limit: 200 });
    const startupIdByName = new Map(
      visibleStartups.map((startup) => [normalizeKey(startup.name), startup.id]),
    );
    const startupNameById = new Map(
      visibleStartups.map((startup) => [startup.id, startup.name]),
    );
    const startupIds = buildStartupIdByPortfolioToken(
      scopedRows,
      startupNameById,
      startupIdByName,
    );

    return scopedRows.map((row) => ({
      row,
      canonicalName: row.startupId,
      startupId: startupIds.get(row.id),
    }));
  };

  return {
    generatePortfolioSignalDigest: async (
      caller: Identity,
      args: {
        sinceDays?: number;
        portfolioCompanyId?: string;
        priority?: WatchedEntityPriority;
        signalsPerCompany?: number;
        includeCrmNotes?: boolean;
        notesPerCompany?: number;
        includeQuietCompanies?: boolean;
      },
    ) => {
      const sinceDays = Math.min(args.sinceDays ?? 7, 30);
      const signalsPerCompany = Math.min(args.signalsPerCompany ?? 10, 25);
      const includeCrmNotes = args.includeCrmNotes ?? true;
      const notesPerCompany = Math.min(args.notesPerCompany ?? 2, 5);
      const includeQuietCompanies = args.includeQuietCompanies ?? false;
      const isExternalInvestor =
        effectiveHuman(caller)?.role === "external_investor";

      const untilMs = Date.now();
      const sinceMs = untilMs - sinceDays * MS_PER_DAY;
      const sinceIso = new Date(sinceMs).toISOString();
      const untilIso = new Date(untilMs).toISOString();

      const allScopeRows = await resolveScope(caller, args.portfolioCompanyId);
      const portfolioIds = new Set(allScopeRows.map((entry) => entry.row.id));
      const portfolioSet = portfolioIds;
      const startupToPortfolio = new Map<string, string>();
      for (const entry of allScopeRows) {
        if (entry.startupId) {
          startupToPortfolio.set(entry.startupId, entry.row.id);
        }
      }

      const [
        mondaySignalsRaw,
        linkedInEvents,
        watchedForScope,
        watchedForMapping,
      ] = await Promise.all([
        connectors.monday.listSignals(sinceDays),
        signalHubEnabled
          ? signalHub.listEvents(caller, {
              sinceIso,
              limit: MAX_LINKEDIN_EVENTS,
            })
          : Promise.resolve([]),
        signalHubEnabled
          ? signalHub.listWatched(caller, args.priority)
          : Promise.resolve([]),
        signalHubEnabled
          ? signalHub.listWatched(caller, undefined)
          : Promise.resolve([]),
      ]);

      const watchedById = new Map(
        watchedForMapping.map((entity) => [entity.id, entity]),
      );
      const priorityWatchedIds = args.priority
        ? new Set(watchedForScope.map((entity) => entity.id))
        : undefined;

      const portfolioMonday = mondaySignalsRaw
        .filter((signal) => portfolioIds.has(signal.portfolioCompanyId))
        .filter((signal) => canSeeSignalForInvestor(caller, signal, portfolioSet))
        .filter((signal) => isWithinWindow(signal.detectedAt, sinceMs));

      const mondayByCompany = new Map<string, DigestMondaySignal[]>();
      for (const signal of portfolioMonday) {
        const bucket = mondayByCompany.get(signal.portfolioCompanyId) ?? [];
        bucket.push({
          id: signal.id,
          kind: signal.kind,
          summary: signal.summary,
          detectedAt: signal.detectedAt,
        });
        mondayByCompany.set(signal.portfolioCompanyId, bucket);
      }

      const linkedInByCompany = new Map<string, DigestLinkedInSignal[]>();
      const unlinkedLinkedInSignals: DigestLinkedInSignal[] = [];

      for (const event of linkedInEvents) {
        if (!isWithinWindow(event.ingestedAt, sinceMs)) continue;

        if (
          priorityWatchedIds !== undefined
          && event.watchedId !== undefined
          && !priorityWatchedIds.has(event.watchedId)
        ) {
          continue;
        }

        const watched = event.watchedId
          ? watchedById.get(event.watchedId)
          : undefined;
        const startupId = event.startupId ?? watched?.startupId;
        const portfolioCompanyId = startupId
          ? startupToPortfolio.get(startupId)
          : undefined;

        const digestSignal: DigestLinkedInSignal = {
          id: event.id,
          source: event.source,
          signalType: event.signalType,
          excerpt: excerpt(
            event.rawText ?? event.url ?? event.signalType,
            SIGNAL_EXCERPT_MAX,
          ),
          ingestedAt: event.ingestedAt,
          url: event.url,
          watchedDisplayName: watched?.displayName,
        };

        if (portfolioCompanyId === undefined) {
          unlinkedLinkedInSignals.push(digestSignal);
          continue;
        }

        const bucket = linkedInByCompany.get(portfolioCompanyId) ?? [];
        bucket.push(digestSignal);
        linkedInByCompany.set(portfolioCompanyId, bucket);
      }

      const preliminaryActivity = new Map<string, number>();
      for (const signal of portfolioMonday) {
        preliminaryActivity.set(
          signal.portfolioCompanyId,
          (preliminaryActivity.get(signal.portfolioCompanyId) ?? 0) + 1,
        );
      }
      for (const [portfolioCompanyId, signals] of linkedInByCompany.entries()) {
        if (signals.length === 0) continue;
        preliminaryActivity.set(
          portfolioCompanyId,
          (preliminaryActivity.get(portfolioCompanyId) ?? 0) + signals.length,
        );
      }

      const scopeWasTruncated = allScopeRows.length > MAX_PORTFOLIO_COMPANIES;
      const scopeRows = prioritizeScopeRows(allScopeRows, preliminaryActivity);

      const crmNotesByCompany = new Map<string, DigestCrmNote[]>();
      if (includeCrmNotes) {
        const noteRows = await Promise.all(
          scopeRows.map(async (entry) => {
            if (!entry.startupId) {
              return { portfolioCompanyId: entry.row.id, notes: [] as DigestCrmNote[] };
            }
            const notes = await startups.listAccessibleNotes(
              caller,
              { startupId: entry.startupId },
              { limit: notesFetchLimit(notesPerCompany) },
            );
            const inWindow = notes
              .filter((note) => isWithinWindow(note.createdAt, sinceMs))
              .filter((note) => canSeeNote(caller, note))
              .sort((left, right) => compareIsoDesc(left.createdAt, right.createdAt))
              .slice(0, notesPerCompany)
              .map((note) => ({
                id: note.id,
                excerpt: excerpt(note.body, NOTE_EXCERPT_MAX),
                sensitivity: note.sensitivity,
                createdAt: note.createdAt,
              }));
            return { portfolioCompanyId: entry.row.id, notes: inWindow };
          }),
        );
        for (const row of noteRows) {
          crmNotesByCompany.set(row.portfolioCompanyId, row.notes);
        }
      }

      const companies: CompanyDigestEntry[] = [];
      const citations: Citation[] = [];
      const warnings: ToolWarning[] = [];

      for (const entry of scopeRows) {
        const mondaySignals = topMondaySignals(
          mondayByCompany.get(entry.row.id) ?? [],
          signalsPerCompany,
        );
        const linkedInSignals = topLinkedInSignals(
          linkedInByCompany.get(entry.row.id) ?? [],
          signalsPerCompany,
        );
        const crmNotes = crmNotesByCompany.get(entry.row.id) ?? [];

        const sourceChannels: CompanyDigestEntry["sourceChannels"] = [];
        if (mondaySignals.length > 0) sourceChannels.push("monday");
        if (linkedInSignals.length > 0) sourceChannels.push("signal_hub");
        if (crmNotes.length > 0) sourceChannels.push("hubspot");

        const factCount =
          mondaySignals.length + linkedInSignals.length + crmNotes.length;

        companies.push({
          portfolioCompanyId: entry.row.id,
          canonicalName: entry.canonicalName,
          startupId: entry.startupId,
          mondaySignals,
          linkedInSignals,
          crmNotes,
          sourceChannels,
          factCount,
        });

        for (const signal of mondaySignals) {
          citations.push({
            label: `Monday ${signal.kind} ${signal.id}`,
            source: {
              system: "monday",
              externalId: signal.id,
              url: undefined,
            },
          });
        }
        for (const signal of linkedInSignals) {
          citations.push({
            label: `Signal Hub ${signal.id}`,
            source: {
              system: "signal_hub",
              externalId: signal.id,
              url: signal.url,
            },
          });
        }
        for (const note of crmNotes) {
          citations.push({
            label: `Note ${note.id} (${note.sensitivity})`,
            source: {
              system: "hubspot",
              externalId: note.id,
              url: undefined,
            },
          });
        }
      }

      companies.sort((left, right) => right.factCount - left.factCount);

      const outputCompanies = includeQuietCompanies
        ? companies
        : companies.filter((row) => row.factCount > 0);
      const quietCompaniesOmitted = includeQuietCompanies
        ? 0
        : companies.filter((row) => row.factCount === 0).length;

      const unresolvedHubSpotCount = scopeRows.filter(
        (entry) => entry.startupId === undefined,
      ).length;
      const visibleUnlinked = isExternalInvestor
        ? []
        : unlinkedLinkedInSignals;
      const totalFacts = outputCompanies.reduce((sum, row) => sum + row.factCount, 0)
        + visibleUnlinked.length;
      const companiesWithActivity = outputCompanies.filter(
        (row) => row.factCount > 0,
      ).length;
      const companiesQuiet = allScopeRows.length - companies.filter(
        (row) => row.factCount > 0,
      ).length;

      if (signalHubEnabled && watchedForScope.length === 0) {
        warnings.push({
          code: ToolWarningCodes.WATCHLIST_EMPTY,
          message: "Signal Hub watchlist is empty for this priority filter.",
          mitigation: "Add portfolio founders via signal_hub_add_watched.",
        });
      }

      if (unresolvedHubSpotCount > 0) {
        warnings.push({
          code: ToolWarningCodes.PORTFOLIO_LINK_MISSING,
          message:
            `${String(unresolvedHubSpotCount)} portfolio company(ies) could not be linked to HubSpot; CRM notes omitted.`,
          mitigation: "Call resolve_entity to fix Monday ↔ HubSpot mapping.",
        });
      }

      if (!isExternalInvestor && unlinkedLinkedInSignals.length > 0) {
        warnings.push({
          code: ToolWarningCodes.PORTFOLIO_LINK_MISSING,
          message:
            `${String(unlinkedLinkedInSignals.length)} LinkedIn signal(s) could not be mapped to a portfolio company.`,
          mitigation: "Link watched entities to startupId or call resolve_entity.",
        });
      }

      if (signalHubEnabled && linkedInEvents.length >= MAX_LINKEDIN_EVENTS) {
        warnings.push({
          code: ToolWarningCodes.LINKEDIN_EVENTS_TRUNCATED,
          message:
            `LinkedIn event fetch hit the ${String(MAX_LINKEDIN_EVENTS)}-event cap; older or lower-ranked signals may be missing.`,
          mitigation: "Narrow sinceDays or call signal_hub_recent_signals per company.",
        });
      }

      if (scopeWasTruncated) {
        warnings.push({
          code: ToolWarningCodes.DIGEST_SCOPE_TRUNCATED,
          message: `Digest truncated to ${String(MAX_PORTFOLIO_COMPANIES)} portfolio companies with the most Monday/LinkedIn activity.`,
          mitigation: "Pass portfolioCompanyId to focus on one company.",
        });
      }

      const nextSuggestedTools: SuggestedToolCall[] = [];
      if (signalHubEnabled) {
        const topActive = outputCompanies.find((row) => row.factCount > 0);
        if (topActive?.startupId) {
          nextSuggestedTools.push({
            toolName: "signal_hub_recent_signals",
            reason: "Drill into LinkedIn signals for the most active portco",
            arguments: { startupId: topActive.startupId },
          });
          nextSuggestedTools.push({
            toolName: "prepare_board_brief",
            reason: "Cross-check digest highlights with a full board brief",
            arguments: { portfolioCompanyId: topActive.portfolioCompanyId },
          });
        } else if (watchedForScope[0]) {
          nextSuggestedTools.push({
            toolName: "signal_hub_request_refresh",
            reason: "Queue a fresh public LinkedIn poll when the digest is empty",
            arguments: { watchedId: watchedForScope[0].id },
          });
        }
      }

      const data: PortfolioSignalDigestData = {
        period: { sinceDays, sinceIso, untilIso },
        scope: {
          portfolioCompanyCount: scopeRows.length,
          scopedCompanyCount: allScopeRows.length,
          watchedEntityCount: watchedForScope.length,
          priorityFilter: args.priority,
          quietCompaniesOmitted,
        },
        companies: outputCompanies,
        unlinkedLinkedInSignals: topLinkedInSignals(
          visibleUnlinked,
          signalsPerCompany,
        ),
        summary: {
          totalFacts,
          companiesWithActivity,
          companiesQuiet,
          ...(isExternalInvestor && unlinkedLinkedInSignals.length > 0
            ? { unlinkedLinkedInCount: unlinkedLinkedInSignals.length }
            : {}),
        },
      };

      return wrapToolOutput(data, {
        citations,
        warnings,
        ...(nextSuggestedTools.length > 0
          ? {
              nextSuggestedTools: filterSignalHubSuggestions(
                nextSuggestedTools,
                signalHubEnabled,
              ),
            }
          : {}),
      });
    },
  };
};

export type PortfolioSignalDigestService = ReturnType<
  typeof buildPortfolioSignalDigestService
>;
