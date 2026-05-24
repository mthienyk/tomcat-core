import { describe, expect, it, vi } from "vitest";
import { buildCompanyDriveFolderService } from "../../src/services/companyDriveFolder.js";
import type { Connectors } from "../../src/connectors/registry.js";
import type { Identity } from "../../src/domain/identity.js";
import type { SocietyService } from "../../src/services/society.js";
import type { StartupsService } from "../../src/services/startups.js";
import type { PortfolioCompany, Startup } from "../../src/domain/entities.js";

const caller: Identity = {
  kind: "human",
  email: "gui@tomcat.eu",
  domain: "tomcat.eu",
  role: "internal_team",
  team: undefined,
  investorId: undefined,
};

const startup: Startup = {
  id: "hs_atlas",
  name: "Atlas",
  sectors: ["saas"],
  stage: "series_a",
  country: "FR",
  description: undefined,
  visibilityTier: "internal_only",
  sources: [{ system: "hubspot", externalId: "hs_atlas", url: undefined }],
};

const portfolioRow: PortfolioCompany = {
  id: "Atlas",
  startupId: "Atlas",
  investedAt: "2026-01-01",
  ownershipPct: undefined,
  status: "active",
};

const buildService = (driveOverrides?: Partial<Connectors["drive"]>) => {
  const society = {
    ensurePortfolioCompanyInScope: vi.fn(async () => undefined),
  };

  const startups = {
    searchStartups: vi.fn(async () => [startup]),
  };

  const connectors = {
    monday: {
      listPortfolio: vi.fn(async () => [portfolioRow]),
    },
    drive: {
      listCompanyFolders: vi.fn(async () => [
        {
          driveFolderId: "folder_m2",
          name: "Atlas — M2 Finance",
          createdTime: "2026-01-01T00:00:00Z",
          modifiedTime: "2026-05-01T00:00:00Z",
          parentIds: ["root"],
        },
        {
          driveFolderId: "folder_root",
          name: "Atlas",
          createdTime: "2025-12-01T00:00:00Z",
          modifiedTime: "2026-04-01T00:00:00Z",
          parentIds: ["root"],
        },
      ]),
      listFolderChildren: vi.fn(async (folderId: string) => {
        if (folderId === "folder_m2") {
          return [
            {
              driveFileId: "file_dsn",
              name: "DSN 2025.pdf",
              mimeType: "application/pdf",
              kind: "file" as const,
              createdTime: "2026-04-01T00:00:00Z",
              modifiedTime: "2026-04-01T00:00:00Z",
            },
          ];
        }
        return [];
      }),
      resolveItemPath: vi.fn(async (folderId: string) =>
        folderId === "folder_m2" ? "Portfolio / Atlas / Atlas — M2 Finance" : "Portfolio / Atlas",
      ),
      listBoardPacksForCompany: vi.fn(),
      fetchDocumentText: vi.fn(),
      ...driveOverrides,
    },
    hubspot: {} as never,
    investors: {} as never,
  } as unknown as Connectors;

  const service = buildCompanyDriveFolderService({
    connectors,
    startups: startups as unknown as StartupsService,
    society: society as unknown as SocietyService,
  });

  return { service, connectors, society, startups };
};

describe("companyDriveFolder service", () => {
  it("resolves M2 folder, inventory, and missing inputs in ToolRunEnvelope", async () => {
    const { service } = buildService();
    const result = await service.resolveCompanyDriveFolder(caller, {
      portfolioCompanyId: "Atlas",
      purpose: "m2_financial",
    });

    expect(result.data.primaryFolder?.driveFolderId).toBe("folder_m2");
    expect(result.data.primaryFolder?.path).toContain("M2 Finance");
    expect(result.data.driveTokenUsed).toBe("Atlas");
    expect(result.data.driveTokensTried).toContain("Atlas");
    expect(result.data.inventory).toHaveLength(1);
    expect(result.data.presentInputs).toContain("dsn");
    expect(result.data.missingInputs.length).toBeGreaterThan(0);
    expect(result.warnings.some((w) => w.code === "DRIVE_INPUTS_INCOMPLETE")).toBe(
      true,
    );
    expect(result.citations[0]?.source.externalId).toBe("folder_m2");
    expect(
      result.nextSuggestedTools?.some(
        (tool) => tool.toolName === "list_company_documents",
      ),
    ).toBe(true);
  });

  it("warns when no folder matches the portfolio token", async () => {
    const { service } = buildService({
      listCompanyFolders: vi.fn(async () => []),
    });

    const result = await service.resolveCompanyDriveFolder(caller, {
      portfolioCompanyId: "UnknownCo",
    });

    expect(result.data.primaryFolder).toBeNull();
    expect(result.data.driveTokensTried).toContain("UnknownCo");
    expect(result.warnings[0]?.code).toBe("DRIVE_FOLDER_NOT_FOUND");
    expect(
      result.nextSuggestedTools?.some(
        (tool) => tool.toolName === "list_company_documents",
      ),
    ).toBe(true);
  });

  it("uses alternate driveTokens when the primary portfolio token has no folders", async () => {
    const { service } = buildService({
      listCompanyFolders: vi.fn(async (token: string) =>
        token === "KOMEET (ex WENABI)"
          ? [
              {
                driveFolderId: "folder_wenabi",
                name: "KOMEET (ex WENABI) — Finance",
                createdTime: "2026-01-01T00:00:00Z",
                modifiedTime: "2026-05-01T00:00:00Z",
                parentIds: ["root"],
              },
            ]
          : [],
      ),
    });

    const result = await service.resolveCompanyDriveFolder(caller, {
      portfolioCompanyId: "Wenabi",
      driveTokens: [
        {
          token: "KOMEET (ex WENABI)",
          source: "monday_portfolio",
          confidence: 0.95,
          matchReason: "monday_portfolio_id",
        },
      ],
      purpose: "bp_inputs",
    });

    expect(result.data.driveTokenUsed).toBe("KOMEET (ex WENABI)");
    expect(result.data.primaryFolder?.driveFolderId).toBe("folder_wenabi");
    expect(result.warnings.some((w) => /alternate token/i.test(w.message))).toBe(
      true,
    );
  });

  it("resolves portfolioCompanyId from startupId via Monday linkage", async () => {
    const { service, society } = buildService();
    const result = await service.resolveCompanyDriveFolder(caller, {
      startupId: "hs_atlas",
    });

    expect(result.data.portfolioCompanyId).toBe("Atlas");
    expect(result.data.canonicalName).toBe("Atlas");
    expect(society.ensurePortfolioCompanyInScope).toHaveBeenCalledWith(
      caller,
      "Atlas",
    );
  });

  it("requires a company selector", async () => {
    const { service } = buildService();
    await expect(service.resolveCompanyDriveFolder(caller, {})).rejects.toThrow(
      /portfolioCompanyId or at least one startup selector/i,
    );
  });
});
