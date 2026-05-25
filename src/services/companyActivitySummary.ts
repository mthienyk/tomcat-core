import { BadRequest } from "../errors/index.js";
import type { Identity } from "../domain/identity.js";
import type { Citation, Deal, Meeting, Note, Startup } from "../domain/entities.js";
import {
  wrapToolOutput,
  type SuggestedToolCall,
  type ToolRunEnvelope,
  type ToolWarning,
} from "../domain/mcpToolOutput.js";
import {
  CRM_ACTIVITY_DEFAULT_LIMITS,
  clampCrmLimit,
} from "./crmActivityLimits.js";
import type { StartupsService } from "./startups.js";
import {
  ELIE_NOTE_AUTHOR_EMAIL,
  isM1M2SynthesisNote,
  matchesAuthorEmail,
  noteQualityBoost,
} from "./noteRanking.js";

export type CompanyActivityFactKind = "note" | "deal" | "meeting";

export type CompanyActivityFact = {
  kind: CompanyActivityFactKind;
  id: string;
  occurredAt: string;
  headline: string;
  detail: string | undefined;
  rankScore: number;
  citation: Citation;
};

export type CompanyActivitySummaryData = {
  startupId: string;
  canonicalName: string;
  portfolioCompanyId: string | undefined;
  profile: {
    sectors: string[];
    stage: string;
    country: string | undefined;
  };
  summary: {
    factsReturned: number;
    notesScanned: number;
    dealsScanned: number;
    meetingsScanned: number;
    activePipelineDeals: number;
    lastActivityAt: string | undefined;
  };
  facts: CompanyActivityFact[];
};

const NOTE_HEADLINE_MAX = 220;
const MS_PER_DAY = 86_400_000;
const HIGHLIGHT_FACT_SCORE = 200;

const excerpt = (text: string, maxChars: number): string =>
  text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;

const recencyScore = (isoDate: string, nowMs: number): number => {
  const parsed = Date.parse(isoDate);
  if (Number.isNaN(parsed)) return 0;
  const daysAgo = Math.max(0, (nowMs - parsed) / MS_PER_DAY);
  return Math.max(0, 100 - daysAgo);
};

const futureMeetingScore = (occurredAt: string, nowMs: number): number => {
  const parsed = Date.parse(occurredAt);
  if (Number.isNaN(parsed)) return 0;
  if (parsed >= nowMs) {
    const daysUntil = (parsed - nowMs) / MS_PER_DAY;
    return 140 + Math.max(0, 30 - daysUntil);
  }
  return recencyScore(occurredAt, nowMs);
};

const dealStatusScore = (status: Deal["status"]): number => {
  if (status === "diligence") return 95;
  if (status === "screening") return 72;
  if (status === "invested") return 70;
  if (status === "passed") return 25;
  if (status === "lost") return 15;
  return 40;
};

const formatDealHeadline = (deal: Deal): string => {
  const amount =
    deal.amountEur !== undefined
      ? ` — €${deal.amountEur.toLocaleString("fr-FR")}`
      : "";
  return `${deal.status}${amount}`;
};

const resolveStartup = async (
  startups: StartupsService,
  caller: Identity,
  args: {
    startupId?: string;
    startupName?: string;
    portfolioCompanyId?: string;
  },
): Promise<{ startup: Startup; warnings: ToolWarning[] }> => {
  const warnings: ToolWarning[] = [];

  if (args.startupId) {
    const matches = await startups.searchStartups(
      caller,
      { startupId: args.startupId },
      { limit: 1 },
    );
    const startup = matches[0];
    if (!startup) {
      throw BadRequest("Startup selector did not resolve to a visible CRM record.");
    }
    return { startup, warnings };
  }

  if (args.startupName) {
    const matches = await startups.searchStartups(
      caller,
      { startupName: args.startupName },
      { limit: 5 },
    );
    if (matches.length === 0) {
      throw BadRequest("Startup selector did not resolve to a visible CRM record.");
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
    return { startup: matches[0]!, warnings };
  }

  if (args.portfolioCompanyId) {
    warnings.push({
      code: "PORTFOLIO_NAME_PROXY",
      message:
        "portfolioCompanyId is used as a HubSpot name token; results depend on CRM naming alignment.",
      mitigation: "Prefer startupId from resolve_entity when available.",
    });
    const matches = await startups.searchStartups(
      caller,
      { startupName: args.portfolioCompanyId },
      { limit: 5 },
    );
    if (matches.length === 0) {
      throw BadRequest("Startup selector did not resolve to a visible CRM record.");
    }
    if (matches.length > 1) {
      throw BadRequest(
        "portfolioCompanyId matched multiple startups. Prefer startupId or call resolve_entity.",
      );
    }
    return { startup: matches[0]!, warnings };
  }

  throw BadRequest(
    "Provide startupId, startupName, or portfolioCompanyId after resolve_entity.",
  );
};

const buildFacts = (input: {
  notes: Note[];
  deals: Deal[];
  meetings: Meeting[];
  nowMs: number;
}): CompanyActivityFact[] => {
  const facts: CompanyActivityFact[] = [];

  for (const note of input.notes) {
    const headline = excerpt(note.body.replace(/\s+/g, " ").trim(), NOTE_HEADLINE_MAX);
    const qualityBoost = noteQualityBoost(note.body);
    let rankScore =
      recencyScore(note.createdAt, input.nowMs) +
      Math.min(20, Math.floor(headline.length / 40)) +
      qualityBoost;
    if (qualityBoost >= 80) {
      rankScore = Math.max(rankScore, 130);
    } else if (qualityBoost >= 60) {
      rankScore = Math.max(rankScore, 125);
    } else if (qualityBoost > 0) {
      rankScore = Math.max(rankScore, 100);
    }
    facts.push({
      kind: "note",
      id: note.id,
      occurredAt: note.createdAt,
      headline,
      detail: note.authorEmail,
      rankScore,
      citation: {
        label: `Note ${note.id} (${note.sensitivity})`,
        source: note.source,
      },
    });
  }

  for (const deal of input.deals) {
    facts.push({
      kind: "deal",
      id: deal.id,
      occurredAt: deal.updatedAt,
      headline: formatDealHeadline(deal),
      detail: deal.ownerEmail,
      rankScore: dealStatusScore(deal.status) + recencyScore(deal.updatedAt, input.nowMs) * 0.4,
      citation: {
        label: `Deal ${deal.id} (${deal.status})`,
        source: { system: "hubspot", externalId: deal.id, url: undefined },
      },
    });
  }

  for (const meeting of input.meetings) {
    facts.push({
      kind: "meeting",
      id: meeting.id,
      occurredAt: meeting.occurredAt,
      headline: meeting.subject,
      detail: meeting.attendees.length > 0 ? meeting.attendees.join(", ") : undefined,
      rankScore: futureMeetingScore(meeting.occurredAt, input.nowMs),
      citation: {
        label: `Meeting ${meeting.id}`,
        source: meeting.source,
      },
    });
  }

  return facts.sort((left, right) => {
    if (right.rankScore !== left.rankScore) {
      return right.rankScore - left.rankScore;
    }
    return right.occurredAt.localeCompare(left.occurredAt);
  });
};

const buildNoteFact = (
  note: Note,
  headlinePrefix: string,
  rankScore: number,
): CompanyActivityFact => ({
  kind: "note",
  id: note.id,
  occurredAt: note.createdAt,
  headline: `${headlinePrefix}: ${excerpt(
    note.body.replace(/\s+/g, " ").trim(),
    NOTE_HEADLINE_MAX - headlinePrefix.length - 2,
  )}`,
  detail: note.authorEmail,
  rankScore,
  citation: {
    label: `Note ${note.id} (${note.sensitivity})`,
    source: note.source,
  },
});

const buildHighlightFacts = (notes: Note[]): CompanyActivityFact[] => {
  const highlights: CompanyActivityFact[] = [];
  const seenIds = new Set<string>();

  const latestElie = [...notes]
    .filter((note) => matchesAuthorEmail(note, ELIE_NOTE_AUTHOR_EMAIL))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  if (latestElie) {
    highlights.push(
      buildNoteFact(latestElie, "Latest Elie note", HIGHLIGHT_FACT_SCORE),
    );
    seenIds.add(latestElie.id);
  }

  const latestM1M2 = [...notes]
    .filter((note) => isM1M2SynthesisNote(note.body))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  if (latestM1M2 && !seenIds.has(latestM1M2.id)) {
    highlights.push(
      buildNoteFact(
        latestM1M2,
        "Latest M1/M2 synthesis",
        HIGHLIGHT_FACT_SCORE - 1,
      ),
    );
  }

  return highlights;
};

const mergeFacts = (
  highlights: CompanyActivityFact[],
  rankedFacts: CompanyActivityFact[],
  factLimit: number,
): CompanyActivityFact[] => {
  const seenIds = new Set<string>();
  const merged: CompanyActivityFact[] = [];

  for (const fact of highlights) {
    if (seenIds.has(fact.id)) continue;
    seenIds.add(fact.id);
    merged.push(fact);
  }
  for (const fact of rankedFacts) {
    if (seenIds.has(fact.id)) continue;
    seenIds.add(fact.id);
    merged.push(fact);
  }

  return merged.slice(0, factLimit);
};

export const buildCompanyActivitySummaryService = (deps: {
  startups: StartupsService;
}) => {
  const { startups } = deps;

  return {
    summarizeCompanyActivity: async (
      caller: Identity,
      args: {
        startupId?: string;
        startupName?: string;
        portfolioCompanyId?: string;
        factLimit?: number;
        notesLimit?: number;
        dealsLimit?: number;
        meetingsLimit?: number;
      },
    ): Promise<ToolRunEnvelope<CompanyActivitySummaryData>> => {
      const { startup, warnings } = await resolveStartup(startups, caller, args);
      const lookup = { startupId: startup.id };
      const nowMs = Date.now();

      const notesLimit = clampCrmLimit(
        args.notesLimit,
        CRM_ACTIVITY_DEFAULT_LIMITS.notes,
        50,
      );
      const dealsLimit = clampCrmLimit(
        args.dealsLimit,
        CRM_ACTIVITY_DEFAULT_LIMITS.deals,
        50,
      );
      const meetingsLimit = clampCrmLimit(
        args.meetingsLimit,
        CRM_ACTIVITY_DEFAULT_LIMITS.meetings,
        50,
      );
      const factLimit = Math.min(args.factLimit ?? 12, 25);

      const [notes, deals, meetings] = await Promise.all([
        startups.listAccessibleNotes(caller, lookup, { limit: notesLimit }),
        startups.listAccessibleDeals(caller, lookup, { limit: dealsLimit }),
        startups.listAccessibleMeetings(caller, lookup, { limit: meetingsLimit }),
      ]);

      const rankedFacts = buildFacts({ notes, deals, meetings, nowMs });
      const highlights = buildHighlightFacts(notes);
      const facts = mergeFacts(highlights, rankedFacts, factLimit);

      const activePipelineDeals = deals.filter(
        (deal) => deal.status === "diligence" || deal.status === "screening",
      ).length;

      const lastActivityAt = facts[0]?.occurredAt;

      if (facts.length === 0) {
        warnings.push({
          code: "CRM_ACTIVITY_EMPTY",
          message: "No CRM notes, deals, or meetings visible for this startup.",
          mitigation: "Verify the startupId or broaden the company selector.",
        });
      }

      const nextSuggestedTools: SuggestedToolCall[] = [
        {
          toolName: "find_competitive_history",
          reason: "Compare against prior deals in the same sector",
          arguments: { startupId: startup.id },
        },
        {
          toolName: "find_similar_cases",
          reason: "Find semantically similar historical cases beyond sector tags",
          arguments: { startupId: startup.id },
        },
      ];

      if (args.portfolioCompanyId ?? startup.name) {
        nextSuggestedTools.push({
          toolName: "find_latest_deck",
          reason: "Locate pitch deck or BP in Drive",
          arguments: {
            ...(args.portfolioCompanyId !== undefined
              ? { portfolioCompanyId: args.portfolioCompanyId }
              : {}),
            startupId: startup.id,
          },
        });
      }

      if (facts.some((fact) => fact.kind === "note")) {
        nextSuggestedTools.push({
          toolName: "read_startup_notes",
          reason: "Read full note bodies beyond ranked excerpts",
          arguments: { startupId: startup.id, limit: 5 },
        });
      }

      const data: CompanyActivitySummaryData = {
        startupId: startup.id,
        canonicalName: startup.name,
        portfolioCompanyId: args.portfolioCompanyId,
        profile: {
          sectors: startup.sectors,
          stage: startup.stage,
          country: startup.country,
        },
        summary: {
          factsReturned: facts.length,
          notesScanned: notes.length,
          dealsScanned: deals.length,
          meetingsScanned: meetings.length,
          activePipelineDeals,
          lastActivityAt,
        },
        facts,
      };

      return wrapToolOutput(data, {
        citations: facts.map((fact) => fact.citation),
        warnings,
        nextSuggestedTools,
      });
    },
  };
};

export type CompanyActivitySummaryService = ReturnType<
  typeof buildCompanyActivitySummaryService
>;
