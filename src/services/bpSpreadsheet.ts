import XLSX from "xlsx";
import {
  countCanonicalDetectionTabs,
  type BpFinancingInstrumentRow,
  FounderDebtInstrumentSchema,
  type FounderDebtInstrument,
} from "../playbooks/bp/template-schema.js";

export type SpreadsheetWorkbookMeta = {
  sheetNames: string[];
  canonicalDetection: ReturnType<typeof countCanonicalDetectionTabs>;
};

const LOAN_BLOCK_SKIP = new Set([
  "",
  "loan",
  "inputs",
  "cash-in",
  "payment",
  "principal",
  "interests",
  "loan due eom",
]);

const cellText = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  return String(value).trim();
};

export const readWorkbookFromBuffer = (buffer: Buffer): XLSX.WorkBook =>
  XLSX.read(buffer, { type: "buffer", cellDates: false });

export const inspectWorkbookMeta = (wb: XLSX.WorkBook): SpreadsheetWorkbookMeta => ({
  sheetNames: wb.SheetNames,
  canonicalDetection: countCanonicalDetectionTabs(wb.SheetNames),
});

export const resolveDebtSourceTab = (
  sheetNames: readonly string[],
  preferred?: string,
): string | undefined => {
  if (preferred) {
    const exact = sheetNames.find((n) => n === preferred);
    if (exact) return exact;
    const lower = preferred.toLowerCase();
    const fuzzy = sheetNames.find((n) => n.toLowerCase() === lower);
    if (fuzzy) return fuzzy;
  }
  const aliases = ["debt", "financial debt", "financement", "loan", "loans", "bnp loan"];
  for (const alias of aliases) {
    const hit = sheetNames.find((n) => n.toLowerCase() === alias);
    if (hit) return hit;
  }
  return sheetNames.find((n) => /debt|loan|financement/i.test(n));
};

export const workbookHasDebtSourceTab = (
  sheetNames: readonly string[],
): boolean => resolveDebtSourceTab(sheetNames) !== undefined;

const isLoanHeaderLabel = (label: string): boolean => {
  const lower = label.toLowerCase();
  if (LOAN_BLOCK_SKIP.has(lower)) return false;
  if (/^\d+$/.test(lower)) return false;
  return label.length >= 3;
};

const parseExcelDate = (value: unknown): number | undefined => {
  if (typeof value === "number" && value > 40_000 && value < 100_000) return value;
  return undefined;
};

const parseRate = (value: unknown): number | undefined => {
  if (typeof value !== "number") return undefined;
  if (value >= 0 && value <= 1) return value;
  if (value > 1 && value <= 100) return value / 100;
  return undefined;
};

export const parseFounderDebtTab = (
  wb: XLSX.WorkBook,
  tabName: string,
): FounderDebtInstrument[] => {
  const ws = wb.Sheets[tabName];
  if (!ws) return [];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as unknown[][];

  const instruments: FounderDebtInstrument[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const label = cellText(row[1]);
    if (!isLoanHeaderLabel(label)) continue;

    let termMonths: number | undefined;
    let annualRate: number | undefined;
    let amount: number | undefined;
    const subscriptionDate = parseExcelDate(row[2]);

    for (let j = i + 1; j < Math.min(rows.length, i + 12); j++) {
      const follow = rows[j] ?? [];
      const followLabel = cellText(follow[1]).toLowerCase();
      if (isLoanHeaderLabel(cellText(follow[1])) && j > i + 1) break;

      if (followLabel === "loan due eom") {
        const term = follow[2];
        if (typeof term === "number") termMonths = term;
      }
      if (followLabel === "interests") {
        annualRate = parseRate(follow[2]);
      }
      if (followLabel === "principal" && typeof follow[2] === "number" && follow[2] > 0) {
        amount = follow[2];
      }
    }

    const parsed = FounderDebtInstrumentSchema.parse({
      label,
      sourceTab: tabName,
      ...(subscriptionDate !== undefined ? { subscriptionDate } : {}),
      ...(annualRate !== undefined ? { annualRate } : {}),
      ...(termMonths !== undefined ? { termMonths } : {}),
      ...(amount !== undefined ? { amount } : {}),
    });
    instruments.push(parsed);
  }
  return instruments;
};

export const inferFinancingInstrumentType = (
  label: string,
): BpFinancingInstrumentRow["instrumentType"] => {
  const lower = label.toLowerCase();
  if (/bpi|bpifrance|fei|ptzi|pa\b|aide publique|subvention|dispositif/.test(lower)) {
    return "public_grant";
  }
  if (/augmentation|levée|levee|capital|series|seed|round/.test(lower)) {
    return "equity_raise";
  }
  if (/cca|oc\b|quasi|convertible/.test(lower)) {
    return "quasi_equity";
  }
  return "private_loan";
};

export const mapFounderDebtToFinancement = (
  debt: FounderDebtInstrument,
): { row: BpFinancingInstrumentRow; notes: string[] } => {
  const notes: string[] = [];
  const instrumentType = inferFinancingInstrumentType(debt.label);
  const repaymentYears =
    debt.termMonths !== undefined ? Math.max(1, Math.round(debt.termMonths / 12)) : undefined;

  const subscriptionDate =
    typeof debt.subscriptionDate === "number" ? debt.subscriptionDate : undefined;

  const amount = debt.amount ?? 0;
  if (debt.amount === undefined) {
    notes.push(`Principal not found for « ${debt.label} » — amount set to 0 pending review.`);
  }

  if (instrumentType === "public_grant") {
    return {
      row: {
        label: debt.label,
        instrumentType: "public_grant",
        amount,
        ...(subscriptionDate !== undefined ? { subscriptionDate } : {}),
        ...(debt.annualRate !== undefined ? { annualRate: debt.annualRate } : {}),
        ...(repaymentYears !== undefined ? { repaymentYears } : {}),
        ...(debt.termMonths !== undefined ? { graceMonths: 0 } : {}),
      },
      notes,
    };
  }

  if (instrumentType === "equity_raise" || instrumentType === "quasi_equity") {
    return {
      row: {
        label: debt.label,
        instrumentType,
        amount,
        ...(subscriptionDate !== undefined ? { subscriptionDate } : {}),
      },
      notes,
    };
  }

  return {
    row: {
      label: debt.label,
      instrumentType: "private_loan",
      amount,
      ...(subscriptionDate !== undefined ? { subscriptionDate } : {}),
      ...(debt.annualRate !== undefined ? { annualRate: debt.annualRate } : {}),
      ...(repaymentYears !== undefined ? { repaymentYears } : {}),
      firstPaymentPct: 1,
    },
    notes,
  };
};
