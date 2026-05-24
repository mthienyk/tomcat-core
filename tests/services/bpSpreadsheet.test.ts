import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import {
  mapFounderDebtToFinancement,
  parseFounderDebtTab,
  readWorkbookFromBuffer,
  resolveDebtSourceTab,
} from "../../src/services/bpSpreadsheet.js";

const ESWIT_PATH = "/tmp/bp-study/eswit.xlsx";

describe("bpSpreadsheet", () => {
  it("resolves Debt tab aliases", () => {
    expect(resolveDebtSourceTab(["Assumptions", "Debt", "Payroll"])).toBe("Debt");
    expect(resolveDebtSourceTab(["Payroll"], "Financial debt")).toBeUndefined();
  });

  it("parses eSwit Debt tab into founder instruments", () => {
    if (!existsSync(ESWIT_PATH)) return;
    const wb = readWorkbookFromBuffer(readFileSync(ESWIT_PATH));
    const tab = resolveDebtSourceTab(wb.SheetNames);
    expect(tab).toBe("Debt");

    const instruments = parseFounderDebtTab(wb, tab!);
    expect(instruments.length).toBeGreaterThanOrEqual(3);
    expect(instruments.some((i) => /bpifrance/i.test(i.label))).toBe(true);

    const mapped = instruments.map((d) => mapFounderDebtToFinancement(d));
    const types = new Set(mapped.map((m) => m.row.instrumentType));
    expect(types.has("public_grant")).toBe(true);
    expect(mapped.every((m) => m.row.amount !== undefined)).toBe(true);
  });
});
