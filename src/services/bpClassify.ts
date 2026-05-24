import type { BpWorkflowMode } from "../playbooks/bp/template-schema.js";

export type BpDriveFileClassification =
  | "template_ref"
  | "founder_bp_xlsx"
  | "founder_bp_other"
  | "payroll_input"
  | "debt_input"
  | "analysis"
  | "tomcat_labeled"
  | "other";

export type ClassifiedDriveFile = {
  driveFileId: string;
  title: string;
  mimeType: string | undefined;
  classification: BpDriveFileClassification;
  modifiedTime: string | undefined;
};

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const GOOGLE_SHEET_MIME = "application/vnd.google-apps.spreadsheet";

export const isSpreadsheetFile = (
  title: string,
  mimeType: string | undefined,
): boolean => {
  const lower = title.toLowerCase();
  if (mimeType === XLSX_MIME || mimeType === GOOGLE_SHEET_MIME) return true;
  return lower.endsWith(".xlsx") || lower.endsWith(".xls");
};

export const classifyBpFilename = (name: string): BpDriveFileClassification => {
  const n = name.toLowerCase();
  if (/template|maj template|old bp saas/.test(n)) return "template_ref";
  if (/analysis|synthèse|synth|m2|questions m2|due diligence|\bdd\b/.test(n)) {
    return "analysis";
  }
  if (/tomcat bp|bp tomcat| - tomcat|tomcat -/.test(n)) return "tomcat_labeled";
  if (/dsn|bulletin|paie|payroll/.test(n)) return "payroll_input";
  if (/prêt|pret|loan|échéancier|echeancier|financement|bpi|emprunt/.test(n)) {
    return "debt_input";
  }
  if (/business plan|bp financier|bp saas|fundraising|previsionnel|prévisionnel/.test(n)) {
    return "founder_bp_other";
  }
  if (/\bbp\b/.test(n)) return "founder_bp_other";
  return "other";
};

export const refineSpreadsheetClassification = (
  base: BpDriveFileClassification,
  title: string,
  mimeType: string | undefined,
): BpDriveFileClassification => {
  if (!isSpreadsheetFile(title, mimeType)) return base;
  if (base === "template_ref" || base === "analysis" || base === "payroll_input" || base === "debt_input") {
    return base;
  }
  if (base === "tomcat_labeled" || base === "founder_bp_other" || base === "other") {
    if (/business plan|\bbp\b|financier|previsionnel|prévisionnel/.test(title.toLowerCase())) {
      return "founder_bp_xlsx";
    }
  }
  if (/\bbp\b|business plan|financier/.test(title.toLowerCase())) {
    return "founder_bp_xlsx";
  }
  return base;
};

export const rankFounderBpCandidate = (file: ClassifiedDriveFile): number => {
  const t = file.title.toLowerCase();
  let score = file.classification === "founder_bp_xlsx" ? 80 : 40;
  if (/business plan|bp financier|bp tomcat|tomcat bp/.test(t)) score += 15;
  if (/analysis|synth|m2|supply finder/.test(t)) score -= 50;
  if (/template/.test(t)) score -= 100;
  if (file.modifiedTime) score += 1;
  return score;
};

export type BpModeSignals = {
  founderBpCount: number;
  payrollInputCount: number;
  debtInputCount: number;
  canonicalTabHits: number;
  canonicalTabTotal: number;
};

export const inferBpWorkflowMode = (
  signals: BpModeSignals,
): { mode: BpWorkflowMode; rationale: string } => {
  const hasFounderBp = signals.founderBpCount > 0;
  const hasFreshInputs = signals.payrollInputCount > 0 || signals.debtInputCount > 0;
  const isCanonical =
    signals.canonicalTabTotal > 0
    && signals.canonicalTabHits === signals.canonicalTabTotal;

  if (hasFounderBp && hasFreshInputs) {
    return {
      mode: "hybrid",
      rationale:
        "Founder BP spreadsheet(s) plus payroll/debt inputs detected. Restructure the BP then overlay RH/Financement from fresh inputs.",
    };
  }
  if (hasFounderBp) {
    if (isCanonical) {
      return {
        mode: "transform",
        rationale:
          "Founder BP detected with canonical Tomcat tab names. Review deltas before export; full restructure may be unnecessary.",
      };
    }
    return {
      mode: "transform",
      rationale:
        "Founder/custom BP spreadsheet without canonical tabs. Map founder tabs to the Tomcat template (typical ~70% of cases).",
    };
  }
  if (hasFreshInputs) {
    return {
      mode: "generate",
      rationale:
        "Payroll and/or debt inputs present without a usable founder BP. Draft from structured inputs into the canonical template.",
    };
  }
  return {
    mode: "generate",
    rationale:
      "No founder BP or payroll/debt inputs identified on Drive. Gather DSN export, loan schedules, or accounting history before drafting.",
  };
};
