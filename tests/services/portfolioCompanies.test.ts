import { describe, expect, it, vi } from "vitest";
import { buildPortfolioCompaniesService } from "../../src/services/portfolioCompanies.js";
import type { Connectors } from "../../src/connectors/registry.js";
import type { Identity } from "../../src/domain/identity.js";
import type { SocietyService } from "../../src/services/society.js";
import type { PortfolioCompany, Startup } from "../../src/domain/entities.js";

const caller: Identity = {
  kind: "human",
  email: "gui@tomcat.eu",
  domain: "tomcat.eu",
  role: "internal_team",
  team: undefined,
  investorId: undefined,
};

const seedextStartup: Startup = {
  id: "hs_seedext",
  name: "Seedext",
  sectors: ["saas"],
  stage: "series_a",
  country: "FR",
  description: undefined,
  visibilityTier: "internal_only",
  sources: [{ system: "hubspot", externalId: "hs_seedext", url: undefined }],
};

const portfolioRows: PortfolioCompany[] = [
  {
    id: "Seedext",
    startupId: "Seedext",
    investedAt: "2024-01-01",
    ownershipPct: undefined,
    status: "active",
  },
  {
    id: "UnlinkedPortco",
    startupId: "UnlinkedPortco",
    investedAt: "2025-01-01",
    ownershipPct: undefined,
    status: "active",
  },
];

const buildService = (overrides?: {
  portfolioRows?: PortfolioCompany[];
  hubspotStartups?: Startup[];
  driveCounts?: Record<string, number>;
}) => {
  const society = {
    ensurePortfolioCompanyInScope: vi.fn(async () => undefined),
  } as unknown as SocietyService;

  const driveCounts = overrides?.driveCounts ?? { Seedext: 3, UnlinkedPortco: 0 };

  const connectors = {
    monday: {
      listPortfolio: vi.fn(async () => overrides?.portfolioRows ?? portfolioRows),
    },
    hubspot: {
      listStartups: vi.fn(async () => overrides?.hubspotStartups ?? [seedextStartup]),
    },
    drive: {
      listBoardPacksForCompany: vi.fn(async (companyId: string) =>
        Array.from({ length: driveCounts[companyId] ?? 0 }, (_, index) => ({
          driveFileId: `file_${companyId}_${index}`,
          name: `${companyId} doc ${index}`,
          mimeType: "application/vnd.google-apps.spreadsheet",
          modifiedTime: "2026-05-01T00:00:00Z",
        })),
      ),
    },
    investors: {
      getInvestorById: vi.fn(),
    },
  } as unknown as Connectors;

  return {
    service: buildPortfolioCompaniesService({ connectors, society }),
    society,
    connectors,
  };
};

describe("portfolioCompanies.listPortfolioCompanies", () => {
  it("lists Monday portcos with HubSpot linkage and drive counts", async () => {
    const { service } = buildService();

    const result = await service.listPortfolioCompanies(caller);

    expect(result.data.source).toBe("monday.portfolio");
    expect(result.data.total).toBe(2);
    expect(result.data.companies).toEqual([
      expect.objectContaining({
        portfolioCompanyId: "Seedext",
        canonicalName: "Seedext",
        startupId: "hs_seedext",
        matchedSources: ["monday", "hubspot"],
        driveIndexedFileCount: 3,
      }),
      expect.objectContaining({
        portfolioCompanyId: "UnlinkedPortco",
        canonicalName: "UnlinkedPortco",
        startupId: undefined,
        matchedSources: ["monday"],
        driveIndexedFileCount: 0,
      }),
    ]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]?.code).toBe("PORTFOLIO_LINK_MISSING");
    expect(result.nextSuggestedTools?.some(
      (tool) => tool.toolName === "resolve_entity",
    )).toBe(true);
    expect(result.nextSuggestedTools?.some(
      (tool) => tool.toolName === "search_startups",
    )).toBe(true);
    expect(result.nextSuggestedTools?.some(
      (tool) => tool.toolName === "list_portfolio_companies",
    )).toBe(false);
  });
});
