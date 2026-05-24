import { BadRequest } from "../errors/index.js";
import type { Connectors } from "../connectors/registry.js";
import type { Citation } from "../domain/entities.js";
import type { Identity } from "../domain/identity.js";
import {
  ToolWarningCodes,
  wrapToolOutput,
  type ToolWarning,
  type SuggestedToolCall,
} from "../domain/mcpToolOutput.js";
import { BpFinancementTabDraftSchema } from "../playbooks/bp/template-schema.js";
import type { BpWorkflowMode } from "../playbooks/bp/template-schema.js";
import type { DriveTokenCandidate } from "./entityResolution.js";
import {
  assertDriveFileInCompanyScope,
  listRankedDriveFilesForTokens,
} from "./driveCompanyFiles.js";
import {
  classifyBpFilename,
  inferBpWorkflowMode,
  isSpreadsheetFile,
  rankFounderBpCandidate,
  refineSpreadsheetClassification,
  type ClassifiedDriveFile,
} from "./bpClassify.js";
import {
  inspectWorkbookMeta,
  mapFounderDebtToFinancement,
  parseFounderDebtTab,
  readWorkbookFromBuffer,
  resolveDebtSourceTab,
  workbookHasDebtSourceTab,
} from "./bpSpreadsheet.js";
import type { SocietyService } from "./society.js";

export type AssembleCompanyFinancePackData = {
  portfolioCompanyId: string;
  recommendedMode: BpWorkflowMode;
  modeRationale: string;
  founderBpFile: {
    driveFileId: string;
    title: string;
    sheetNames: string[];
    canonicalTabHits: number;
    canonicalTabTotal: number;
  } | null;
  classifiedFiles: ClassifiedDriveFile[];
  inputSummary: {
    founderBp: number;
    payroll: number;
    debt: number;
    analysis: number;
  };
};

export const buildBpWorkflowService = (deps: {
  connectors: Connectors;
  society: SocietyService;
}) => {
  const { connectors, society } = deps;

  const resolvePortfolioCompanyId = async (
    caller: Identity,
    args: {
      portfolioCompanyId?: string;
    },
  ): Promise<string> => {
    if (args.portfolioCompanyId) {
      await society.ensurePortfolioCompanyInScope(caller, args.portfolioCompanyId);
      return args.portfolioCompanyId;
    }
    throw BadRequest(
      "Provide portfolioCompanyId from resolve_entity before BP workflow tools.",
    );
  };

  const listScopedDriveFiles = async (
    portfolioCompanyId: string,
    driveTokens: DriveTokenCandidate[] | undefined,
    titleContains: string | undefined,
  ) => {
    const ranked = await listRankedDriveFilesForTokens(
      connectors.drive,
      portfolioCompanyId,
      driveTokens,
      titleContains,
    );
    return ranked;
  };

  const hasBpInputSignals = (classifiedFiles: ClassifiedDriveFile[]): boolean => {
    const summaryClasses = new Set([
      "founder_bp_xlsx",
      "founder_bp_other",
      "tomcat_labeled",
      "payroll_input",
      "debt_input",
    ]);
    return classifiedFiles.some((file) => summaryClasses.has(file.classification));
  };

  const shouldSuggestDebtDraft = (input: {
    mode: BpWorkflowMode;
    founderBpFile: AssembleCompanyFinancePackData["founderBpFile"];
    debtInputCount: number;
  }): boolean => {
    if (input.mode !== "transform" && input.mode !== "hybrid") return false;
    if (!input.founderBpFile) return false;
    if (input.debtInputCount > 0) return true;
    return workbookHasDebtSourceTab(input.founderBpFile.sheetNames);
  };

  const assembleCompanyFinancePack = async (
    caller: Identity,
    args: {
      portfolioCompanyId?: string;
      driveTokens?: DriveTokenCandidate[];
      titleContains?: string;
      documentLimit?: number;
      peekFounderBpSheets?: boolean;
    },
  ) => {
    const portfolioCompanyId = await resolvePortfolioCompanyId(caller, args);
    const warnings: ToolWarning[] = [];
    const citations: Citation[] = [];

    const { files, listedBeforeFilter } = await listScopedDriveFiles(
      portfolioCompanyId,
      args.driveTokens,
      args.titleContains,
    );

    if (listedBeforeFilter === 0) {
      warnings.push({
        code: ToolWarningCodes.DRIVE_INDEX_MISS,
        message:
          "No Drive files matched any drive token for this company. HubSpot-only companies may need Monday portfolio indexing, or filenames may not contain the company name.",
        mitigation:
          "Confirm resolve_entity driveTokens, check Drive folder naming, or retry after drive.boardPacks sync.",
      });
    } else if (
      args.titleContains?.trim() &&
      files.length === 0 &&
      listedBeforeFilter > 0
    ) {
      warnings.push({
        code: "DRIVE_TITLE_FILTER_EMPTY",
        message: `titleContains « ${args.titleContains.trim()} » matched 0 of ${String(listedBeforeFilter)} Drive files.`,
        mitigation: 'Retry with a broader filter such as "BP" or "Business plan".',
      });
    }

    const limit = Math.min(Math.max(args.documentLimit ?? 40, 5), 80);
    const classifiedFiles: ClassifiedDriveFile[] = files.slice(0, limit).map((file) => {
      const base = classifyBpFilename(file.title);
      const classification = refineSpreadsheetClassification(
        base,
        file.title,
        file.mimeType,
      );
      return {
        driveFileId: file.driveFileId,
        title: file.title,
        mimeType: file.mimeType,
        classification,
        modifiedTime: file.createdAt,
      };
    });

    if (files.length > limit) {
      warnings.push({
        code: ToolWarningCodes.DIGEST_SCOPE_TRUNCATED,
        message: `Drive listing truncated to ${String(limit)} files. Narrow with titleContains if needed.`,
      });
    }

    const founderCandidates = classifiedFiles
      .filter((f) => f.classification === "founder_bp_xlsx")
      .sort((a, b) => rankFounderBpCandidate(b) - rankFounderBpCandidate(a));

    let founderBpFile: AssembleCompanyFinancePackData["founderBpFile"] = null;
    let canonicalTabHits = 0;
    const canonicalTabTotal = 8;

    const peekSheets = args.peekFounderBpSheets !== false;
    if (peekSheets && founderCandidates[0]) {
      const top = founderCandidates[0];
      try {
        const binary = await connectors.drive.fetchDocumentBinary(top.driveFileId);
        const wb = readWorkbookFromBuffer(binary.buffer);
        const meta = inspectWorkbookMeta(wb);
        canonicalTabHits = meta.canonicalDetection.hits;
        founderBpFile = {
          driveFileId: top.driveFileId,
          title: top.title,
          sheetNames: meta.sheetNames,
          canonicalTabHits,
          canonicalTabTotal: meta.canonicalDetection.total,
        };
        citations.push({
          label: top.title,
          source: {
            system: "drive",
            externalId: top.driveFileId,
            url: undefined,
          },
        });
      } catch {
        warnings.push({
          code: ToolWarningCodes.DRIVE_BINARY_NOT_EXTRACTABLE,
          message: `Could not read sheet names from founder BP « ${top.title} ». Mode inference uses filenames only.`,
          mitigation: "Verify Drive permissions or pass peekFounderBpSheets: false.",
        });
        founderBpFile = {
          driveFileId: top.driveFileId,
          title: top.title,
          sheetNames: [],
          canonicalTabHits: 0,
          canonicalTabTotal,
        };
      }
    } else if (founderCandidates[0]) {
      founderBpFile = {
        driveFileId: founderCandidates[0].driveFileId,
        title: founderCandidates[0].title,
        sheetNames: [],
        canonicalTabHits: 0,
        canonicalTabTotal,
      };
    }

    const inputSummary = {
      founderBp: classifiedFiles.filter((f) => f.classification === "founder_bp_xlsx").length,
      payroll: classifiedFiles.filter((f) => f.classification === "payroll_input").length,
      debt: classifiedFiles.filter((f) => f.classification === "debt_input").length,
      analysis: classifiedFiles.filter((f) => f.classification === "analysis").length,
    };

    const founderBpOtherCount = classifiedFiles.filter(
      (f) => f.classification === "founder_bp_other",
    ).length;
    if (founderBpOtherCount > 0 && inputSummary.founderBp === 0) {
      warnings.push({
        code: ToolWarningCodes.BP_FOUND_NON_SPREADSHEET,
        message: `${String(founderBpOtherCount)} BP-like file(s) detected but not as parseable spreadsheets (PDF, Doc, or Google file without extension in title).`,
        mitigation:
          "Ask for an .xlsx export or use read_company_document_excerpt on the listed file.",
      });
    }

    const { mode, rationale } = inferBpWorkflowMode({
      founderBpCount: inputSummary.founderBp,
      payrollInputCount: inputSummary.payroll,
      debtInputCount: inputSummary.debt,
      canonicalTabHits,
      canonicalTabTotal,
    });

    if (!hasBpInputSignals(classifiedFiles)) {
      warnings.push({
        code: ToolWarningCodes.DRIVE_INPUTS_INCOMPLETE,
        message: "No BP, payroll, or debt inputs detected in the scanned Drive files.",
        mitigation:
          "Call resolve_company_drive_folder (purpose: bp_inputs) or list_company_documents with titleContains: BP.",
      });
    }

    if (canonicalTabHits === canonicalTabTotal && canonicalTabTotal > 0) {
      warnings.push({
        code: "BP_CANONICAL_TABS_DETECTED",
        message:
          "Top founder BP already exposes canonical Tomcat tab names. Confirm before full restructure.",
      });
    }

    const nextSuggestedTools: SuggestedToolCall[] = [
      {
        toolName: "read_bp_playbook",
        reason: "Confirm workflow mode and Financement 1:1 benchmark thresholds.",
      },
    ];
    if (shouldSuggestDebtDraft({ mode, founderBpFile, debtInputCount: inputSummary.debt })) {
      nextSuggestedTools.push({
        toolName: "draft_bp_tab_debt",
        reason: "First end-to-end slice: map founder Debt tab to Financement.",
        arguments: {
          portfolioCompanyId,
          founderBpFileId: founderBpFile!.driveFileId,
        },
      });
    }

    const data: AssembleCompanyFinancePackData = {
      portfolioCompanyId,
      recommendedMode: mode,
      modeRationale: rationale,
      founderBpFile,
      classifiedFiles,
      inputSummary,
    };

    return wrapToolOutput(data, { citations, warnings, nextSuggestedTools });
  };

  const draftBpTabDebt = async (
    caller: Identity,
    args: {
      portfolioCompanyId?: string;
      founderBpFileId: string;
      sourceTab?: string;
      driveTokens?: DriveTokenCandidate[];
    },
  ) => {
    const portfolioCompanyId = await resolvePortfolioCompanyId(caller, args);
    const warnings: ToolWarning[] = [];
    const citations: Citation[] = [];
    const mappingNotes: string[] = [];

    const fileMeta = await assertDriveFileInCompanyScope(
      connectors.drive,
      portfolioCompanyId,
      args.founderBpFileId,
      args.driveTokens,
    );

    if (!isSpreadsheetFile(fileMeta.title, fileMeta.mimeType)) {
      throw BadRequest("founderBpFileId must reference a spreadsheet (.xlsx or Google Sheet).", {
        driveFileId: args.founderBpFileId,
        title: fileMeta.title,
      });
    }

    const binary = await connectors.drive.fetchDocumentBinary(args.founderBpFileId);
    const wb = readWorkbookFromBuffer(binary.buffer);
    const sourceTab = resolveDebtSourceTab(wb.SheetNames, args.sourceTab);
    if (!sourceTab) {
      throw BadRequest(
        "No Debt/Loan/Financement tab found in the founder BP. Pass sourceTab explicitly.",
        { sheetNames: wb.SheetNames },
      );
    }

    const founderInstruments = parseFounderDebtTab(wb, sourceTab);
    if (founderInstruments.length === 0) {
      warnings.push({
        code: "BP_DEBT_TAB_EMPTY",
        message: `No loan blocks parsed from tab « ${sourceTab} ».`,
        mitigation: "Inspect the tab via read_company_document_excerpt or verify tab name.",
      });
    }

    const financementInstruments = [];
    for (const debt of founderInstruments) {
      const mapped = mapFounderDebtToFinancement(debt);
      financementInstruments.push(mapped.row);
      mappingNotes.push(...mapped.notes);
    }

    const financementDraft = BpFinancementTabDraftSchema.parse({
      tabSlug: "financement",
      instruments:
        financementInstruments.length > 0
          ? financementInstruments
          : [
              {
                label: "Placeholder — no loans parsed",
                instrumentType: "private_loan" as const,
                amount: 0,
              },
            ],
    });

    if (financementInstruments.length === 0) {
      warnings.push({
        code: "BP_DRAFT_PLACEHOLDER",
        message: "Draft contains a placeholder instrument because no loans were parsed.",
      });
    }

    citations.push({
      label: fileMeta.title,
      source: {
        system: "drive",
        externalId: args.founderBpFileId,
        url: undefined,
      },
    });

    return wrapToolOutput(
      {
        portfolioCompanyId,
        sourceFile: {
          driveFileId: args.founderBpFileId,
          title: fileMeta.title,
          sourceTab,
        },
        founderInstruments,
        financementDraft,
        mappingNotes,
        status: "confidential_draft" as const,
      },
      {
        citations,
        warnings,
        nextSuggestedTools: [
          {
            toolName: "read_bp_playbook",
            reason: "Validate Financement 1:1 benchmark before export.",
            arguments: { section: "benchmark" },
          },
        ],
      },
    );
  };

  return {
    assembleCompanyFinancePack,
    draftBpTabDebt,
  };
};

export type BpWorkflowService = ReturnType<typeof buildBpWorkflowService>;
