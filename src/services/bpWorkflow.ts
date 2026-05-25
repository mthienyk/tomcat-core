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
import {
  BpBusinessPlanDraftSchema,
  BpCaTabDraftSchema,
  BpFinancementTabDraftSchema,
  BpRhTabDraftSchema,
  BP_TEMPLATE_SOURCE,
  type BpWorkflowMode,
} from "../playbooks/bp/template-schema.js";
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
  buildCoverageReport,
  buildBpReviewBrief,
} from "./bpReviewBrief.js";
import {
  inspectWorkbookMeta,
  mapFounderDebtToFinancement,
  parseFounderDebtTab,
  parseFounderPayrollTab,
  parseFounderRevenueTab,
  readWorkbookFromBuffer,
  resolveDebtSourceTab,
  resolvePayrollSourceTab,
  resolveRevenueSourceTab,
} from "./bpSpreadsheet.js";
import {
  applyBusinessPlanDraftToWorkbook,
  buildExportFilename,
} from "./bpSpreadsheetWrite.js";
import { mapFounderWorkbookTabs } from "./bpTabMapping.js";
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
  alternateFounderBps: Array<{ driveFileId: string; title: string }>;
  classifiedFiles: ClassifiedDriveFile[];
  inputSummary: {
    founderBp: number;
    payroll: number;
    debt: number;
    analysis: number;
  };
};

type BpWorkflowBaseArgs = {
  portfolioCompanyId?: string;
  driveTokens?: DriveTokenCandidate[];
  companyLabel?: string;
};

const buildDriveTokenArgs = (
  driveTokens: DriveTokenCandidate[] | undefined,
): Record<string, unknown> =>
  driveTokens?.length
    ? {
        driveTokens: driveTokens.map((token) => ({
          token: token.token,
          source: token.source,
          confidence: token.confidence,
          matchReason: token.matchReason,
        })),
      }
    : {};

export const buildBpWorkflowService = (deps: {
  connectors: Connectors;
  society: SocietyService;
}) => {
  const { connectors, society } = deps;

  const resolvePortfolioCompanyId = async (
    caller: Identity,
    args: { portfolioCompanyId?: string },
  ): Promise<string> => {
    if (args.portfolioCompanyId) {
      await society.ensurePortfolioCompanyInScope(caller, args.portfolioCompanyId);
      return args.portfolioCompanyId;
    }
    throw BadRequest(
      "Provide portfolioCompanyId from resolve_entity before BP workflow tools.",
    );
  };

  const loadFounderSpreadsheet = async (
    portfolioCompanyId: string,
    founderBpFileId: string,
    driveTokens: DriveTokenCandidate[] | undefined,
  ) => {
    const fileMeta = await assertDriveFileInCompanyScope(
      connectors.drive,
      portfolioCompanyId,
      founderBpFileId,
      driveTokens,
    );
    if (!isSpreadsheetFile(fileMeta.title, fileMeta.mimeType)) {
      throw BadRequest("founderBpFileId must reference a spreadsheet (.xlsx or Google Sheet).", {
        driveFileId: founderBpFileId,
        title: fileMeta.title,
      });
    }
    const binary = await connectors.drive.fetchDocumentBinary(founderBpFileId);
    return { fileMeta, wb: readWorkbookFromBuffer(binary.buffer) };
  };

  const buildTabDraftSuggestions = (input: {
    portfolioCompanyId: string;
    mode: BpWorkflowMode;
    founderBpFile: AssembleCompanyFinancePackData["founderBpFile"];
    driveTokens: DriveTokenCandidate[] | undefined;
    companyLabel?: string;
  }): SuggestedToolCall[] => {
    if (!input.founderBpFile || (input.mode !== "transform" && input.mode !== "hybrid")) {
      return [];
    }
    const baseArgs = {
      portfolioCompanyId: input.portfolioCompanyId,
      founderBpFileId: input.founderBpFile.driveFileId,
      recommendedMode: input.mode,
      ...buildDriveTokenArgs(input.driveTokens),
      ...(input.companyLabel ? { companyLabel: input.companyLabel } : {}),
    };
    return [
      {
        toolName: "restructure_founder_bp",
        reason: "Primary BP step — structured draft + human review brief for the agent.",
        arguments: baseArgs,
      },
    ];
  };

  const assembleCompanyFinancePack = async (
    caller: Identity,
    args: BpWorkflowBaseArgs & {
      titleContains?: string;
      documentLimit?: number;
      peekFounderBpSheets?: boolean;
    },
  ) => {
    const portfolioCompanyId = await resolvePortfolioCompanyId(caller, args);
    const warnings: ToolWarning[] = [];
    const citations: Citation[] = [];

    const { files, listedBeforeFilter } = await listRankedDriveFilesForTokens(
      connectors.drive,
      portfolioCompanyId,
      args.driveTokens,
      args.titleContains,
      { bpWorkflowTitlesOnly: !args.titleContains?.trim() },
    );

    if (listedBeforeFilter === 0) {
      warnings.push({
        code: ToolWarningCodes.DRIVE_INDEX_MISS,
        message: "No Drive files matched any drive token for this company.",
        mitigation: "Pass driveTokens from resolve_entity.",
      });
    } else if (args.titleContains?.trim() && files.length === 0 && listedBeforeFilter > 0) {
      warnings.push({
        code: "DRIVE_TITLE_FILTER_EMPTY",
        message: `titleContains « ${args.titleContains.trim()} » matched 0 files.`,
        mitigation: "Omit titleContains — assemble auto-matches BP, Business Plan, DSN, loan titles.",
      });
    }

    const limit = Math.min(Math.max(args.documentLimit ?? 40, 5), 80);
    const classifiedFiles: ClassifiedDriveFile[] = files.slice(0, limit).map((file) => {
      const base = classifyBpFilename(file.title);
      return {
        driveFileId: file.driveFileId,
        title: file.title,
        mimeType: file.mimeType,
        classification: refineSpreadsheetClassification(base, file.title, file.mimeType),
        modifiedTime: file.createdAt,
      };
    });

    const founderCandidates = classifiedFiles
      .filter((f) => f.classification === "founder_bp_xlsx")
      .sort((a, b) => rankFounderBpCandidate(b) - rankFounderBpCandidate(a));

    if (founderCandidates.length > 1) {
      warnings.push({
        code: "BP_MULTIPLE_FOUNDER_CANDIDATES",
        message: `${String(founderCandidates.length)} founder BP spreadsheets found. Using top-ranked; ask the user if another scenario is intended.`,
        mitigation: "Confirm low/mid/high scenario with the finance reviewer before restructure.",
      });
    }

    let founderBpFile: AssembleCompanyFinancePackData["founderBpFile"] = null;
    let canonicalTabHits = 0;
    const canonicalTabTotal = 8;

    if (args.peekFounderBpSheets !== false && founderCandidates[0]) {
      const top = founderCandidates[0];
      try {
        const binary = await connectors.drive.fetchDocumentBinary(top.driveFileId);
        const meta = inspectWorkbookMeta(readWorkbookFromBuffer(binary.buffer));
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
          source: { system: "drive", externalId: top.driveFileId, url: undefined },
        });
      } catch {
        warnings.push({
          code: ToolWarningCodes.DRIVE_BINARY_NOT_EXTRACTABLE,
          message: `Could not peek sheet names on « ${top.title} ».`,
        });
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

    const { mode, rationale } = inferBpWorkflowMode({
      founderBpCount: inputSummary.founderBp,
      payrollInputCount: inputSummary.payroll,
      debtInputCount: inputSummary.debt,
      canonicalTabHits,
      canonicalTabTotal,
    });

    if (mode === "hybrid" && inputSummary.debt + inputSummary.payroll > 0) {
      warnings.push({
        code: "BP_HYBRID_OVERLAY_SUGGESTED",
        message: "Fresh payroll/debt files detected alongside founder BP.",
        mitigation:
          "Agent: read debt/DSN PDFs via read_company_document_excerpt before validating Financement/RH with the user.",
      });
    }

    if (mode === "generate" && inputSummary.founderBp === 0) {
      warnings.push({
        code: "BP_GENERATE_NOT_IMPLEMENTED",
        message: "Generate mode (inputs only, no founder BP) is not automated yet.",
        mitigation: "Agent works with the user from template + excerpts; draft_business_plan planned.",
      });
    }

    const nextSuggestedTools: SuggestedToolCall[] = [
      {
        toolName: "read_bp_playbook",
        reason: "Confirm workflow mode and agent/human role split.",
      },
      ...buildTabDraftSuggestions({
        portfolioCompanyId,
        mode,
        founderBpFile,
        driveTokens: args.driveTokens,
        ...(args.companyLabel !== undefined ? { companyLabel: args.companyLabel } : {}),
      }),
    ];

    if (mode === "hybrid") {
      const overlayFiles = classifiedFiles.filter(
        (f) => f.classification === "debt_input" || f.classification === "payroll_input",
      );
      for (const file of overlayFiles.slice(0, 3)) {
        nextSuggestedTools.push({
          toolName: "read_company_document_excerpt",
          reason: `Hybrid overlay: inspect « ${file.title} » before Financement/RH sign-off.`,
          arguments: {
            portfolioCompanyId,
            driveFileId: file.driveFileId,
            ...buildDriveTokenArgs(args.driveTokens),
          },
        });
      }
    }

    return wrapToolOutput(
      {
        portfolioCompanyId,
        recommendedMode: mode,
        modeRationale: rationale,
        founderBpFile,
        alternateFounderBps: founderCandidates.slice(1, 4).map((f) => ({
          driveFileId: f.driveFileId,
          title: f.title,
        })),
        classifiedFiles,
        inputSummary,
      },
      { citations, warnings, nextSuggestedTools },
    );
  };

  const composeDraftFromWorkbook = async (input: {
    caller: Identity;
    portfolioCompanyId: string;
    founderBpFileId: string;
    driveTokens: DriveTokenCandidate[] | undefined;
    recommendedMode?: BpWorkflowMode;
  }) => {
    const { fileMeta, wb } = await loadFounderSpreadsheet(
      input.portfolioCompanyId,
      input.founderBpFileId,
      input.driveTokens,
    );
    const warnings: ToolWarning[] = [];
    let placeholdersUsed = false;

    const { mappings, unmapped, duplicateFounderTabs, manualReviewTabs } =
      mapFounderWorkbookTabs(wb.SheetNames);

    if (duplicateFounderTabs.length > 0) {
      warnings.push({
        code: "BP_DUPLICATE_TAB_MAPPING",
        message: `Ignored duplicate founder tabs: ${duplicateFounderTabs.join(", ")}.`,
      });
    }

    let financementDraft;
    const debtTab = resolveDebtSourceTab(wb.SheetNames);
    if (debtTab) {
      const instruments = parseFounderDebtTab(wb, debtTab);
      if (instruments.length === 0) {
        warnings.push({
          code: "BP_DEBT_TAB_EMPTY",
          message: `No loans parsed from « ${debtTab} ».`,
        });
        placeholdersUsed = true;
      }
      const rows = instruments.map((d) => mapFounderDebtToFinancement(d).row);
      financementDraft = BpFinancementTabDraftSchema.parse({
        tabSlug: "financement",
        instruments:
          rows.length > 0
            ? rows
            : [{ label: "Placeholder — review loans", instrumentType: "private_loan", amount: 0 }],
      });
    }

    let rhDraft;
    const payrollTab = resolvePayrollSourceTab(wb.SheetNames);
    if (payrollTab) {
      const roles = parseFounderPayrollTab(wb, payrollTab);
      if (roles.length === 0) {
        warnings.push({ code: "BP_PAYROLL_TAB_EMPTY", message: `No roles parsed from « ${payrollTab} ».` });
        placeholdersUsed = true;
      }
      rhDraft = BpRhTabDraftSchema.parse({
        tabSlug: "rh",
        roles: roles.length > 0 ? roles : [{ role: "Placeholder — review headcount" }],
        sourceTab: payrollTab,
      });
    }

    let caDraft;
    const revenueTab = resolveRevenueSourceTab(wb.SheetNames);
    if (revenueTab) {
      const parsed = parseFounderRevenueTab(wb, revenueTab);
      if (parsed.pattern === "custom") {
        warnings.push({
          code: "BP_REVENUE_CUSTOM",
          message: "CA pattern unclear — agent must discuss billing model with the user.",
        });
      }
      caDraft = BpCaTabDraftSchema.parse({
        tabSlug: "ca",
        revenuePattern: parsed.pattern,
        assumptions: parsed.assumptions,
        sourceTab: revenueTab,
        ...(parsed.monthlyNewClientsByOffer.length
          ? { monthlyNewClientsByOffer: parsed.monthlyNewClientsByOffer }
          : {}),
      });
    }

    const mode = input.recommendedMode ?? "transform";
    const draft = BpBusinessPlanDraftSchema.parse({
      portfolioCompanyId: input.portfolioCompanyId,
      mode,
      sourceFounderBpFileId: input.founderBpFileId,
      tabMappings: mappings,
      ...(financementDraft ? { financement: financementDraft } : {}),
      ...(rhDraft ? { rh: rhDraft } : {}),
      ...(caDraft ? { ca: caDraft } : {}),
      manualReviewTabs,
      unmappedFounderTabs: unmapped,
      duplicateFounderTabs,
    });

    const coverage = buildCoverageReport({ draft, placeholdersUsed });

    return { fileMeta, draft, coverage, warnings, placeholdersUsed };
  };

  const restructureFounderBp = async (
    caller: Identity,
    args: BpWorkflowBaseArgs & {
      founderBpFileId: string;
      recommendedMode?: BpWorkflowMode;
    },
  ) => {
    const portfolioCompanyId = await resolvePortfolioCompanyId(caller, args);
    const composed = await composeDraftFromWorkbook({
      caller,
      portfolioCompanyId,
      founderBpFileId: args.founderBpFileId,
      driveTokens: args.driveTokens,
      ...(args.recommendedMode ? { recommendedMode: args.recommendedMode } : {}),
    });

    const companyLabel = args.companyLabel ?? portfolioCompanyId;
    const reviewBrief = buildBpReviewBrief({
      companyLabel,
      draft: composed.draft,
      coverage: composed.coverage,
      mode: composed.draft.mode,
      sourceBpTitle: composed.fileMeta.title,
    });

    if (composed.placeholdersUsed) {
      composed.warnings.push({
        code: "BP_DRAFT_PLACEHOLDER",
        message: "Draft contains placeholders — export blocked until the user fixes and re-runs restructure.",
      });
    }

    return wrapToolOutput(
      {
        portfolioCompanyId,
        sourceFile: {
          driveFileId: args.founderBpFileId,
          title: composed.fileMeta.title,
        },
        draft: composed.draft,
        coverage: composed.coverage,
        reviewBrief,
        status: "confidential_draft" as const,
      },
      {
        citations: [
          {
            label: composed.fileMeta.title,
            source: { system: "drive", externalId: args.founderBpFileId, url: undefined },
          },
        ],
        warnings: composed.warnings,
        nextSuggestedTools: [
          {
            toolName: "export_business_plan",
            reason: "Only after the user explicitly asks to export in chat.",
            arguments: {
              portfolioCompanyId,
              founderBpFileId: args.founderBpFileId,
              confirmed: false,
              ...buildDriveTokenArgs(args.driveTokens),
              ...(args.companyLabel ? { companyLabel: args.companyLabel } : {}),
            },
          },
        ],
      },
    );
  };

  const draftBpTabDebt = async (
    caller: Identity,
    args: BpWorkflowBaseArgs & { founderBpFileId: string; sourceTab?: string },
  ) => {
    const portfolioCompanyId = await resolvePortfolioCompanyId(caller, args);
    const { fileMeta, wb } = await loadFounderSpreadsheet(
      portfolioCompanyId,
      args.founderBpFileId,
      args.driveTokens,
    );
    const sourceTab = resolveDebtSourceTab(wb.SheetNames, args.sourceTab);
    if (!sourceTab) {
      throw BadRequest("No Debt/Loan tab found.", { sheetNames: wb.SheetNames });
    }
    const warnings: ToolWarning[] = [];
    const mappingNotes: string[] = [];
    const founderInstruments = parseFounderDebtTab(wb, sourceTab);
    if (founderInstruments.length === 0) {
      warnings.push({ code: "BP_DEBT_TAB_EMPTY", message: `Empty debt tab « ${sourceTab} ».` });
    }
    const financementInstruments = founderInstruments.map((debt) => {
      const mapped = mapFounderDebtToFinancement(debt);
      mappingNotes.push(...mapped.notes);
      return mapped.row;
    });
    const financementDraft = BpFinancementTabDraftSchema.parse({
      tabSlug: "financement",
      instruments:
        financementInstruments.length > 0
          ? financementInstruments
          : [{ label: "Placeholder — no loans parsed", instrumentType: "private_loan", amount: 0 }],
    });
    if (financementInstruments.length === 0) {
      warnings.push({ code: "BP_DRAFT_PLACEHOLDER", message: "Placeholder instrument in draft." });
    }
    return wrapToolOutput(
      {
        portfolioCompanyId,
        sourceFile: { driveFileId: args.founderBpFileId, title: fileMeta.title, sourceTab },
        founderInstruments,
        financementDraft,
        mappingNotes,
        status: "confidential_draft" as const,
      },
      {
        citations: [
          { label: fileMeta.title, source: { system: "drive", externalId: args.founderBpFileId, url: undefined } },
        ],
        warnings,
      },
    );
  };

  const draftBpTabPayroll = async (
    caller: Identity,
    args: BpWorkflowBaseArgs & { founderBpFileId: string; sourceTab?: string },
  ) => {
    const portfolioCompanyId = await resolvePortfolioCompanyId(caller, args);
    const { wb } = await loadFounderSpreadsheet(
      portfolioCompanyId,
      args.founderBpFileId,
      args.driveTokens,
    );
    const sourceTab = resolvePayrollSourceTab(wb.SheetNames, args.sourceTab);
    if (!sourceTab) throw BadRequest("No Payroll/RH tab found.", { sheetNames: wb.SheetNames });
    const roles = parseFounderPayrollTab(wb, sourceTab);
    const warnings: ToolWarning[] = [];
    if (roles.length === 0) {
      warnings.push({ code: "BP_PAYROLL_TAB_EMPTY", message: `Empty payroll tab « ${sourceTab} ».` });
    }
    return wrapToolOutput(
      {
        portfolioCompanyId,
        rhDraft: BpRhTabDraftSchema.parse({
          tabSlug: "rh",
          roles: roles.length > 0 ? roles : [{ role: "Placeholder — review headcount" }],
          sourceTab,
        }),
        status: "confidential_draft" as const,
      },
      { warnings },
    );
  };

  const draftBpTabRevenue = async (
    caller: Identity,
    args: BpWorkflowBaseArgs & { founderBpFileId: string; sourceTab?: string },
  ) => {
    const portfolioCompanyId = await resolvePortfolioCompanyId(caller, args);
    const { wb } = await loadFounderSpreadsheet(
      portfolioCompanyId,
      args.founderBpFileId,
      args.driveTokens,
    );
    const sourceTab = resolveRevenueSourceTab(wb.SheetNames, args.sourceTab);
    if (!sourceTab) throw BadRequest("No Revenue tab found.", { sheetNames: wb.SheetNames });
    const parsed = parseFounderRevenueTab(wb, sourceTab);
    const warnings: ToolWarning[] = [];
    if (parsed.pattern === "custom") {
      warnings.push({
        code: "BP_REVENUE_CUSTOM",
        message: "Agent must validate CA assumptions with the user before export.",
      });
    }
    return wrapToolOutput(
      {
        portfolioCompanyId,
        caDraft: BpCaTabDraftSchema.parse({
          tabSlug: "ca",
          revenuePattern: parsed.pattern,
          assumptions: parsed.assumptions,
          sourceTab,
          ...(parsed.monthlyNewClientsByOffer.length
            ? { monthlyNewClientsByOffer: parsed.monthlyNewClientsByOffer }
            : {}),
        }),
        status: "confidential_draft" as const,
      },
      { warnings },
    );
  };

  const exportBusinessPlan = async (
    caller: Identity,
    args: BpWorkflowBaseArgs & {
      founderBpFileId: string;
      confirmed: boolean;
      recommendedMode?: BpWorkflowMode;
    },
  ) => {
    if (!args.confirmed) {
      throw BadRequest(
        "export_business_plan requires confirmed: true after the user explicitly asks to export in chat.",
        { nextAction: "Present reviewBrief from restructure_founder_bp first." },
      );
    }

    const portfolioCompanyId = await resolvePortfolioCompanyId(caller, args);
    const composed = await composeDraftFromWorkbook({
      caller,
      portfolioCompanyId,
      founderBpFileId: args.founderBpFileId,
      driveTokens: args.driveTokens,
      ...(args.recommendedMode ? { recommendedMode: args.recommendedMode } : {}),
    });

    if (composed.placeholdersUsed) {
      throw BadRequest(
        "Export blocked: draft still contains placeholders. Fix with the user and re-run restructure_founder_bp.",
        { warnings: composed.warnings },
      );
    }

    const templateBinary = await connectors.drive.fetchDocumentBinary(
      BP_TEMPLATE_SOURCE.driveFileId,
    );
    const exportBuffer = applyBusinessPlanDraftToWorkbook(
      templateBinary.buffer,
      composed.draft,
    );
    const companyLabel = args.companyLabel ?? portfolioCompanyId;
    const filename = buildExportFilename(companyLabel);

    return wrapToolOutput(
      {
        portfolioCompanyId,
        filename,
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        xlsxBase64: exportBuffer.toString("base64"),
        draft: composed.draft,
        coverage: composed.coverage,
        exportPolicy: "values_only_v1" as const,
        agentNextStep:
          "Decode xlsxBase64 and help the user save the file (artifact/download in supported clients). Remind them to relink P&L / trésorerie formulas.",
        status: "exported_confidential" as const,
      },
      {
        warnings: [
          ...composed.warnings,
          {
            code: "BP_EXPORT_VALUES_ONLY",
            message: "V1 writes Financement + RH values. P&L, trésorerie, BPI keep template formulas.",
          },
        ],
      },
    );
  };

  return {
    assembleCompanyFinancePack,
    draftBpTabDebt,
    draftBpTabPayroll,
    draftBpTabRevenue,
    restructureFounderBp,
    exportBusinessPlan,
  };
};

export type BpWorkflowService = ReturnType<typeof buildBpWorkflowService>;
