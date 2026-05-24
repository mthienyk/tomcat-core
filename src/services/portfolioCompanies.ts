import { Forbidden } from "../errors/index.js";
import type { Connectors } from "../connectors/registry.js";
import type { Identity } from "../domain/identity.js";
import type { PortfolioCompany, Startup } from "../domain/entities.js";
import {
  ToolWarningCodes,
  wrapToolOutput,
  type SuggestedToolCall,
  type ToolWarning,
} from "../domain/mcpToolOutput.js";
import { matchConfidence, normalizeEntityKey } from "./entityResolution.js";
import type { SocietyService } from "./society.js";

export type PortfolioCompanyEntry = {
  portfolioCompanyId: string;
  canonicalName: string;
  startupId: string | undefined;
  matchedSources: ("hubspot" | "monday")[];
  driveIndexedFileCount: number;
  investedAt: string | undefined;
  status: PortfolioCompany["status"];
};

export type ListPortfolioCompaniesData = {
  source: "monday.portfolio";
  total: number;
  companies: PortfolioCompanyEntry[];
};

const normalizeKey = normalizeEntityKey;

const linkHubspotStartup = (
  row: PortfolioCompany,
  startups: Startup[],
): Startup | undefined => {
  const exact = startups.find(
    (startup) => normalizeKey(startup.name) === normalizeKey(row.id),
  );
  if (exact) return exact;

  let best: { startup: Startup; score: number } | undefined;
  for (const startup of startups) {
    const score = Math.max(
      matchConfidence(row.id, startup.name).confidence,
      matchConfidence(row.startupId, startup.name).confidence,
    );
    if (score < 0.88) continue;
    if (!best || score > best.score) {
      best = { startup, score };
    }
  }
  return best?.startup;
};

const listPortfolioRowsForCaller = async (
  caller: Identity,
  connectors: Connectors,
): Promise<PortfolioCompany[]> => {
  const rows = await connectors.monday.listPortfolio();
  const sorted = [...rows].sort((left, right) => left.id.localeCompare(right.id));

  if (caller.kind === "human" && caller.role !== "external_investor") {
    return sorted;
  }

  const investorId =
    caller.kind === "human"
      ? caller.investorId
      : caller.onBehalfOf?.investorId;
  if (!investorId) {
    throw Forbidden("External investor identity must include investorId");
  }

  const investor = await connectors.investors.getInvestorById(investorId);
  if (!investor) {
    throw Forbidden("Investor not found");
  }

  const allowed = new Set(investor.portfolioCompanyIds);
  return sorted.filter((row) => allowed.has(row.id));
};

export const buildPortfolioCompaniesService = (deps: {
  connectors: Connectors;
  society: SocietyService;
}) => {
  const { connectors, society } = deps;

  const listPortfolioCompanies = async (caller: Identity) => {
    const warnings: ToolWarning[] = [];
    const nextSuggestedTools: SuggestedToolCall[] = [];

    const [portfolioRows, hubspotStartups] = await Promise.all([
      listPortfolioRowsForCaller(caller, connectors),
      connectors.hubspot.listStartups(),
    ]);

    const companies: PortfolioCompanyEntry[] = [];
    const unlinkedPortcos: string[] = [];
    for (const row of portfolioRows) {
      await society.ensurePortfolioCompanyInScope(caller, row.id);
      const linked = linkHubspotStartup(row, hubspotStartups);
      const driveFiles = await connectors.drive.listBoardPacksForCompany(row.id);
      const matchedSources: PortfolioCompanyEntry["matchedSources"] = ["monday"];
      if (linked) matchedSources.push("hubspot");

      companies.push({
        portfolioCompanyId: row.id,
        canonicalName: linked?.name ?? row.id,
        startupId: linked?.id,
        matchedSources,
        driveIndexedFileCount: driveFiles.length,
        investedAt: row.investedAt,
        status: row.status,
      });

      if (!linked) {
        unlinkedPortcos.push(row.id);
      }
    }

    if (unlinkedPortcos.length > 0) {
      warnings.push({
        code: ToolWarningCodes.PORTFOLIO_LINK_MISSING,
        message:
          `${unlinkedPortcos.length} Monday portco(s) have no HubSpot startup link: `
          + `${unlinkedPortcos.join(", ")}.`,
        mitigation: "Call resolve_entity with each company name to inspect linkage.",
      });
    }

    if (companies.length === 0) {
      warnings.push({
        code: ToolWarningCodes.WATCHLIST_EMPTY,
        message: "No portfolio companies visible for this caller.",
      });
    }

    const firstCompany = companies[0]?.portfolioCompanyId;
    if (firstCompany !== undefined) {
      nextSuggestedTools.push({
        toolName: "resolve_entity",
        reason: "Pick a portco and get driveTokens for downstream reads.",
        arguments: { query: firstCompany },
      });
    }

    nextSuggestedTools.push({
      toolName: "search_startups",
      reason: "CRM discovery by sector or startupName (funnel, not Monday portcos).",
      arguments: {},
    });

    const data: ListPortfolioCompaniesData = {
      source: "monday.portfolio",
      total: companies.length,
      companies,
    };

    return wrapToolOutput(data, { warnings, nextSuggestedTools });
  };

  return { listPortfolioCompanies };
};

export type PortfolioCompaniesService = ReturnType<
  typeof buildPortfolioCompaniesService
>;
