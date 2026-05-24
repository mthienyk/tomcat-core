import { describe, expect, it, vi } from "vitest";
import { buildFindLatestDeckService } from "../../src/services/findLatestDeck.js";
import type { Identity } from "../../src/domain/identity.js";
import type { Startup } from "../../src/domain/entities.js";

const caller: Identity = {
  kind: "human",
  email: "elie@tomcat.eu",
  domain: "tomcat.eu",
  role: "internal_team",
  team: undefined,
  investorId: undefined,
};

const wenabi: Startup = {
  id: "9426764108",
  name: "Wenabi",
  sectors: ["climate"],
  stage: "unknown",
  country: "FR",
  description: undefined,
  visibilityTier: "internal_only",
  sources: [{ system: "hubspot", externalId: "9426764108" }],
};

const buildService = (overrides?: {
  driveFiles?: Array<{
    driveFileId: string;
    title: string;
    createdAt: string;
    mimeType?: string;
  }>;
  documentText?: string;
}) => {
  const connectors = {
    drive: {
      listBoardPacksForCompany: vi.fn(
        async () => overrides?.driveFiles ?? [],
      ),
      fetchDocumentText: vi.fn(
        async () => overrides?.documentText ?? "Slide 1: traction overview",
      ),
    },
  };

  const startups = {
    searchStartups: vi.fn(async () => [wenabi]),
  };

  const society = {
    ensurePortfolioCompanyInScope: vi.fn(async () => undefined),
  };

  return buildFindLatestDeckService({
    connectors: connectors as never,
    startups: startups as never,
    society: society as never,
  });
};

describe("findLatestDeck service", () => {
  it("returns the top-ranked deck with excerpt when text-extractable", async () => {
    const service = buildService({
      driveFiles: [
        {
          driveFileId: "logo_1",
          title: "Wenabi logo pack",
          createdAt: "2026-05-01",
          mimeType: "image/png",
        },
        {
          driveFileId: "deck_1",
          title: "Wenabi Investor Deck Q2",
          createdAt: "2026-04-15",
          mimeType: "application/vnd.google-apps.presentation",
        },
        {
          driveFileId: "legal_1",
          title: "20241025_Wenabi x Vendredi_PV attribution actions.pdf",
          createdAt: "2026-05-20",
          mimeType: "application/pdf",
        },
      ],
    });

    const result = await service.findLatestDeck(caller, {
      startupId: "9426764108",
    });

    expect(result.data.deck?.driveFileId).toBe("deck_1");
    expect(result.data.deck?.textExtractable).toBe(true);
    expect(result.data.deck?.excerpt).toContain("traction");
    expect(result.data.alternates).toEqual([]);
    expect(result.citations[0]?.source.externalId).toBe("deck_1");
    expect(result.warnings.some((w) => w.code === "PORTFOLIO_LINK_MISSING")).toBe(
      true,
    );
    expect(
      result.nextSuggestedTools?.some(
        (tool) => tool.toolName === "summarize_company_activity",
      ),
    ).toBe(true);
  });

  it("warns when no deck-like file matches", async () => {
    const service = buildService({
      driveFiles: [
        {
          driveFileId: "logo_1",
          title: "Wenabi visuel team",
          createdAt: "2026-05-01",
        },
      ],
    });

    const result = await service.findLatestDeck(caller, {
      portfolioCompanyId: "KOMEET (ex WENABI)",
    });

    expect(result.data.deck).toBeNull();
    expect(result.warnings.some((w) => w.code === "DRIVE_DECK_NOT_FOUND")).toBe(
      true,
    );
    expect(
      result.nextSuggestedTools?.some(
        (tool) => tool.toolName === "resolve_company_drive_folder",
      ),
    ).toBe(true);
  });

  it("returns metadata without excerpt for binary deck candidates", async () => {
    const service = buildService({
      driveFiles: [
        {
          driveFileId: "pdf_deck",
          title: "Wenabi pitch deck 2025.pdf",
          createdAt: "2026-03-01",
          mimeType: "application/pdf",
        },
      ],
    });

    const result = await service.findLatestDeck(caller, {
      portfolioCompanyId: "KOMEET (ex WENABI)",
      startupId: "9426764108",
    });

    expect(result.data.deck?.driveFileId).toBe("pdf_deck");
    expect(result.data.deck?.textExtractable).toBe(false);
    expect(result.data.deck?.excerpt).toBeUndefined();
    expect(
      result.warnings.some((w) => w.code === "DRIVE_BINARY_NOT_EXTRACTABLE"),
    ).toBe(true);
    expect(
      result.nextSuggestedTools?.some(
        (tool) => tool.toolName === "read_company_document_excerpt",
      ),
    ).toBe(false);
  });

  it("warns when Drive token resolves to an empty folder", async () => {
    const service = buildService({ driveFiles: [] });

    const result = await service.findLatestDeck(caller, {
      portfolioCompanyId: "KOMEET (ex WENABI)",
    });

    expect(result.data.deck).toBeNull();
    expect(result.warnings.some((w) => w.code === "DRIVE_FOLDER_NOT_FOUND")).toBe(
      true,
    );
  });
});
