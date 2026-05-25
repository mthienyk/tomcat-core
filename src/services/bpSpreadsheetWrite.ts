import XLSX from "xlsx";
import type {
  BpBusinessPlanDraft,
  BpFinancingInstrumentRow,
} from "../playbooks/bp/template-schema.js";
import { readWorkbookFromBuffer, writeWorkbookToBuffer } from "./bpSpreadsheet.js";

const FINANCEMENT_SECTION_ROWS: Record<
  BpFinancingInstrumentRow["instrumentType"],
  { start: number; end: number }
> = {
  equity_raise: { start: 9, end: 10 },
  quasi_equity: { start: 12, end: 14 },
  private_loan: { start: 16, end: 18 },
  public_grant: { start: 21, end: 23 },
};

const clearRows = (ws: XLSX.WorkSheet, startRow: number, endRow: number): void => {
  for (let row = startRow; row <= endRow; row += 1) {
    for (let col = 1; col <= 9; col += 1) {
      const addr = XLSX.utils.encode_cell({ r: row - 1, c: col - 1 });
      delete ws[addr];
    }
  }
};

const setCell = (ws: XLSX.WorkSheet, row: number, col: number, value: unknown): void => {
  const addr = XLSX.utils.encode_cell({ r: row - 1, c: col - 1 });
  ws[addr] = { t: typeof value === "number" ? "n" : "s", v: value };
};

const writeFinancementInstrument = (
  ws: XLSX.WorkSheet,
  row: number,
  instrument: BpFinancingInstrumentRow,
): void => {
  setCell(ws, row, 1, instrument.label);
  if (instrument.subscriptionDate !== undefined) {
    setCell(ws, row, 2, instrument.subscriptionDate);
  }
  if (instrument.amount !== undefined) {
    setCell(ws, row, 3, instrument.amount);
  }
  if (instrument.instrumentType === "public_grant" && instrument.grantPortion !== undefined) {
    setCell(ws, row, 4, instrument.grantPortion);
  }
  if ("repaymentYears" in instrument && instrument.repaymentYears !== undefined) {
    setCell(ws, row, 5, instrument.repaymentYears);
  }
  if ("annualRate" in instrument && instrument.annualRate !== undefined) {
    setCell(ws, row, 6, instrument.annualRate);
  }
  if ("graceMonths" in instrument && instrument.graceMonths !== undefined) {
    setCell(ws, row, 7, instrument.graceMonths);
  }
  if ("firstPaymentPct" in instrument && instrument.firstPaymentPct !== undefined) {
    setCell(ws, row, 8, instrument.firstPaymentPct);
  }
  if (instrument.instrumentType === "public_grant" && instrument.projectMonths !== undefined) {
    setCell(ws, row, 9, instrument.projectMonths);
  }
};

export const applyBusinessPlanDraftToWorkbook = (
  templateBuffer: Buffer,
  draft: BpBusinessPlanDraft,
): Buffer => {
  const wb = readWorkbookFromBuffer(templateBuffer);

  if (draft.financement && wb.Sheets.Financement) {
    const ws = wb.Sheets.Financement;
    for (const section of Object.values(FINANCEMENT_SECTION_ROWS)) {
      clearRows(ws, section.start, section.end);
    }
    const rowCursor: Record<BpFinancingInstrumentRow["instrumentType"], number> = {
      equity_raise: FINANCEMENT_SECTION_ROWS.equity_raise.start,
      quasi_equity: FINANCEMENT_SECTION_ROWS.quasi_equity.start,
      private_loan: FINANCEMENT_SECTION_ROWS.private_loan.start,
      public_grant: FINANCEMENT_SECTION_ROWS.public_grant.start,
    };
    for (const instrument of draft.financement.instruments) {
      if (/placeholder/i.test(instrument.label)) continue;
      const row = rowCursor[instrument.instrumentType];
      const maxRow = FINANCEMENT_SECTION_ROWS[instrument.instrumentType].end;
      if (row > maxRow) continue;
      writeFinancementInstrument(ws, row, instrument);
      rowCursor[instrument.instrumentType] = row + 1;
    }
  }

  if (draft.rh && wb.Sheets.RH) {
    const ws = wb.Sheets.RH;
    let row = 4;
    for (const role of draft.rh.roles) {
      if (/placeholder/i.test(role.role)) continue;
      setCell(ws, row, 1, role.role);
      if (role.headcount !== undefined) setCell(ws, row, 2, role.headcount);
      if (role.monthlyGross !== undefined) setCell(ws, row, 3, role.monthlyGross);
      if (role.employerCost !== undefined) setCell(ws, row, 4, role.employerCost);
      row += 1;
      if (row > 30) break;
    }
  }

  return writeWorkbookToBuffer(wb);
};

export const buildExportFilename = (companyLabel: string): string => {
  const safe = companyLabel.replace(/[^\w.-]+/g, "_").slice(0, 40);
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `BP_Tomcat_${safe}_${stamp}.xlsx`;
};
