import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BP_CANONICAL_DETECTION_TABS,
  BP_CANONICAL_TAB_NAME_SET,
  BP_CANONICAL_TAB_NAMES,
  BP_TEMPLATE_SOURCE,
  BpFinancementTabDraftSchema,
  BpFinancingPrivateLoanRowSchema,
  BpInputPrevisionnelSchema,
  BpTemplateMetaSchema,
  FounderDebtInstrumentSchema,
  countCanonicalDetectionTabs,
  normalizeBpTabName,
  resolveCanonicalTabName,
} from "../../src/playbooks/bp/template-schema.js";

const ROOT = join(import.meta.dirname, "../..");
const TEMPLATE_MAJ = "/tmp/bp-study/template_maj.xlsx";
const TEMPLATE_OLD = "/tmp/bp-study/template_old.xlsx";

describe("bp template schema", () => {
  it("matches extracted template metadata with sha256", () => {
    const meta = BpTemplateMetaSchema.parse({
      source: {
        driveFileId: BP_TEMPLATE_SOURCE.driveFileId,
        driveFileName: BP_TEMPLATE_SOURCE.driveFileName,
        driveFolder: BP_TEMPLATE_SOURCE.driveFolder,
        sharedDriveId: BP_TEMPLATE_SOURCE.sharedDriveId,
        contentSha256: BP_TEMPLATE_SOURCE.contentSha256,
      },
      extractedAt: BP_TEMPLATE_SOURCE.extractedAt,
      tabCount: BP_TEMPLATE_SOURCE.tabCount,
    });
    expect(meta.tabCount).toBe(12);
    expect(meta.source.contentSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("lists 12 canonical tab names including P&L trailing space", () => {
    expect(BP_CANONICAL_TAB_NAMES).toHaveLength(12);
    expect(BP_CANONICAL_TAB_NAMES).toContain("P&L ");
    expect(BP_CANONICAL_TAB_NAME_SET.has("Financement")).toBe(true);
  });

  it("detection tabs are subset of canonical names", () => {
    for (const tab of BP_CANONICAL_DETECTION_TABS) {
      expect(BP_CANONICAL_TAB_NAME_SET.has(tab)).toBe(true);
    }
  });

  it("normalizes P&L tab name variants", () => {
    expect(normalizeBpTabName("P&L")).toBe("P&L ");
    expect(resolveCanonicalTabName("p&l")).toBe("P&L ");
    expect(resolveCanonicalTabName("Financement")).toBe("Financement");
    expect(resolveCanonicalTabName("Debt")).toBeUndefined();
  });

  it("counts canonical detection tabs", () => {
    const all = countCanonicalDetectionTabs([...BP_CANONICAL_TAB_NAMES]);
    expect(all.isCanonical).toBe(true);
    expect(all.hits).toBe(8);

    const partial = countCanonicalDetectionTabs(["CA", "RH", "Debt"]);
    expect(partial.isCanonical).toBe(false);
    expect(partial.hits).toBe(2);
  });

  it("validates private loan instrument with required amount", () => {
    const row = BpFinancingPrivateLoanRowSchema.parse({
      label: "Prêt BNP",
      instrumentType: "private_loan",
      subscriptionDate: 45383,
      amount: 50000,
      repaymentYears: 5,
      annualRate: 0.0452,
      graceMonths: 0,
      firstPaymentPct: 1,
    });
    expect(row.instrumentType).toBe("private_loan");
    expect(() =>
      BpFinancingPrivateLoanRowSchema.parse({
        label: "Prêt BNP",
        instrumentType: "private_loan",
      }),
    ).toThrow();
  });

  it("rejects equity row with loan-only fields via discriminated union", () => {
    expect(() =>
      BpFinancementTabDraftSchema.parse({
        tabSlug: "financement",
        instruments: [
          {
            label: "Levée",
            instrumentType: "equity_raise",
            repaymentYears: 5,
          },
        ],
      }),
    ).toThrow();
  });

  it("validates financement tab draft envelope", () => {
    const draft = BpFinancementTabDraftSchema.parse({
      tabSlug: "financement",
      instruments: [
        {
          label: "Prêt BNP",
          instrumentType: "private_loan",
          amount: 50000,
        },
      ],
    });
    expect(draft.instruments).toHaveLength(1);
  });

  it("validates split opening cash fields", () => {
    const input = BpInputPrevisionnelSchema.parse({
      cashBalanceDate: 45413,
      openingCashAmount: 9857,
      vatRate: 0.2,
    });
    expect(input.openingCashAmount).toBe(9857);
    expect(input.cashBalanceDate).toBe(45413);
  });

  it("validates founder debt schedule (eSwit-style source)", () => {
    const debt = FounderDebtInstrumentSchema.parse({
      label: "Bpifrance - PA",
      sourceTab: "Debt",
      annualRate: 0.03,
      termMonths: 32,
      schedule: [{ periodIndex: 1, principal: 0, interest: 0 }],
    });
    expect(debt.sourceTab).toBe("Debt");
  });
});

describe("extract bp template script", () => {
  it("dry-runs successfully on template_maj", () => {
    if (!existsSync(TEMPLATE_MAJ)) return;
    const out = execSync(
      `node scripts/extract-bp-template-spec.mjs --local ${TEMPLATE_MAJ} --dry-run`,
      { cwd: ROOT, encoding: "utf8" },
    );
    expect(out).toContain("Dry run OK");
  });

  it("fails on template_old with missing tabs", () => {
    if (!existsSync(TEMPLATE_OLD)) return;
    expect(() =>
      execSync(`node scripts/extract-bp-template-spec.mjs --local ${TEMPLATE_OLD} --dry-run`, {
        cwd: ROOT,
        stdio: "pipe",
      }),
    ).toThrow();
  });
});

describe("bp playbook dist layout", () => {
  it("dist/playbooks/bp contains markdown after build", () => {
    execSync("npm run build", { cwd: ROOT, stdio: "pipe" });
    const playbookPath = join(ROOT, "dist/playbooks/bp/playbook.md");
    const specPath = join(ROOT, "dist/playbooks/bp/template-spec.md");
    expect(existsSync(playbookPath)).toBe(true);
    expect(existsSync(specPath)).toBe(true);
    expect(readFileSync(playbookPath, "utf8")).toContain("Three workflow modes");
  });
});
