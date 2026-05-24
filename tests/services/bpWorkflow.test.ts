import { describe, expect, it, vi } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { buildBpWorkflowService } from "../../src/services/bpWorkflow.js";
import type { Identity } from "../../src/domain/identity.js";

const ESWIT_PATH = "/tmp/bp-study/eswit.xlsx";

const caller: Identity = {
  kind: "human",
  email: "guillaume@tomcat.eu",
  domain: "tomcat.eu",
  role: "internal_team",
  team: undefined,
  investorId: undefined,
};

describe("bpWorkflow service", () => {
  it("assemble classifies files and suggests draft_bp_tab_debt", async () => {
    const service = buildBpWorkflowService({
      connectors: {
        drive: {
          listBoardPacksForCompany: vi.fn().mockResolvedValue([
            {
              id: "f1",
              title: "eSwit BP Tomcat.xlsx",
              driveFileId: "f1",
              createdAt: "2026-01-01",
              mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            },
            {
              id: "f2",
              title: "eSwit DSN export.pdf",
              driveFileId: "f2",
              createdAt: "2026-01-02",
              mimeType: "application/pdf",
            },
            {
              id: "f3",
              title: "eSwit BPI loan schedule.pdf",
              driveFileId: "f3",
              createdAt: "2026-01-03",
              mimeType: "application/pdf",
            },
          ]),
          fetchDocumentBinary: vi.fn(),
        },
      } as never,
      society: {
        ensurePortfolioCompanyInScope: vi.fn().mockResolvedValue(undefined),
      } as never,
    });

    const out = await service.assembleCompanyFinancePack(caller, {
      portfolioCompanyId: "ESWIT",
      peekFounderBpSheets: false,
    });

    expect(out.data.recommendedMode).toBe("hybrid");
    expect(out.data.inputSummary.founderBp).toBe(1);
    expect(out.data.inputSummary.payroll).toBe(1);
    expect(out.nextSuggestedTools?.some((t) => t.toolName === "draft_bp_tab_debt")).toBe(true);
  });

  it("assemble does not suggest draft_bp_tab_debt without debt tab or debt files", async () => {
    const service = buildBpWorkflowService({
      connectors: {
        drive: {
          listBoardPacksForCompany: vi.fn().mockResolvedValue([
            {
              id: "f1",
              title: "Seedext Suivi financier.xlsx",
              driveFileId: "f1",
              createdAt: "2026-01-01",
              mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            },
          ]),
          fetchDocumentBinary: vi.fn().mockResolvedValue({
            name: "Seedext Suivi financier.xlsx",
            mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            buffer: Buffer.from([]),
          }),
        },
      } as never,
      society: {
        ensurePortfolioCompanyInScope: vi.fn().mockResolvedValue(undefined),
      } as never,
    });

    const out = await service.assembleCompanyFinancePack(caller, {
      portfolioCompanyId: "Seedext",
      peekFounderBpSheets: true,
    });

    expect(out.data.recommendedMode).toBe("transform");
    expect(
      out.nextSuggestedTools?.some((t) => t.toolName === "draft_bp_tab_debt"),
    ).toBe(false);
  });

  it("draft_bp_tab_debt maps eSwit Debt to financement draft", async () => {
    if (!existsSync(ESWIT_PATH)) return;

    const buffer = readFileSync(ESWIT_PATH);
    const service = buildBpWorkflowService({
      connectors: {
        drive: {
          listBoardPacksForCompany: vi.fn().mockResolvedValue([
            {
              id: "eswit-bp",
              title: "eSwit BP Tomcat.xlsx",
              driveFileId: "eswit-bp",
              createdAt: "2026-01-01",
              mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            },
          ]),
          fetchDocumentBinary: vi.fn().mockResolvedValue({
            name: "eSwit BP Tomcat.xlsx",
            mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            buffer,
          }),
        },
      } as never,
      society: {
        ensurePortfolioCompanyInScope: vi.fn().mockResolvedValue(undefined),
      } as never,
    });

    const out = await service.draftBpTabDebt(caller, {
      portfolioCompanyId: "ESWIT",
      founderBpFileId: "eswit-bp",
    });

    expect(out.data.sourceFile.sourceTab).toBe("Debt");
    expect(out.data.founderInstruments.length).toBeGreaterThanOrEqual(3);
    expect(out.data.financementDraft.instruments.length).toBeGreaterThanOrEqual(3);
    expect(out.data.status).toBe("confidential_draft");
    expect(out.citations[0]?.source.externalId).toBe("eswit-bp");
  });
});
