import { createHash } from "crypto";
import XLSX from "xlsx";
import {
  BP_CANONICAL_DETECTION_TABS,
  DRIVE_FILE_ID,
  DRIVE_FILE_NAME,
  DRIVE_FOLDER,
  EXPECTED_TAB_COUNT,
  FILL_ZONE_HINTS,
  FINANCEMENT_COLUMNS,
  FINANCEMENT_SECTIONS,
  INPUT_PREVISIONNEL_FIELDS,
  OFFER_COUNT,
  TAB_CATALOG,
} from "./bpTemplateCatalog.mjs";

function cellText(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function isMostlyEmpty(row, startCol = 1) {
  return row.slice(startCol).every((c) => !cellText(c));
}

function sheetRows(ws) {
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
}

function detectFillRuleRow(rows) {
  for (let rowIndex = 0; rowIndex < Math.min(rows.length, 6); rowIndex++) {
    const row = rows[rowIndex];
    const texts = row.map(cellText);
    const manualIdx = texts.findIndex((t) => t === "A modifier");
    const autoIdx = texts.findIndex((t) => t.startsWith("remplissage automatique"));
    if (manualIdx >= 0 || autoIdx >= 0) {
      return { row: rowIndex + 1, manualMarkerCol: manualIdx >= 0 ? XLSX.utils.encode_col(manualIdx) : undefined, autoMarkerCol: autoIdx >= 0 ? XLSX.utils.encode_col(autoIdx) : undefined };
    }
  }
  return undefined;
}

function extractLabelRows(rows, limit = 40) {
  const fields = [];
  for (let i = 0; i < Math.min(rows.length, limit); i++) {
    const row = rows[i];
    const label = cellText(row[0]);
    if (!label || label.length > 80) continue;
    if (/^Règles remplissage|^Hypothèses|^Données sur|^Détail de|^Par la performance/.test(label)) {
      continue;
    }
    const looksLikeSection =
      isMostlyEmpty(row, 1) && !/\d/.test(label) && label.length < 45 && !label.endsWith(":");
    if (looksLikeSection) {
      fields.push({ kind: "section", row: i + 1, label });
      continue;
    }
    if (label.endsWith(":") || row.slice(1, 4).some((c) => cellText(c))) {
      fields.push({ kind: "field", row: i + 1, label: label.replace(/:$/, "") });
    }
  }
  return fields;
}

function extractFinancementStructure(rows) {
  const headerRowIdx = rows.findIndex((row) =>
    row.map(cellText).includes("Date de souscription"),
  );
  if (headerRowIdx < 0) {
    throw new Error("Financement tab: header row with « Date de souscription » not found");
  }

  const headerRow = rows[headerRowIdx];
  const columns = FINANCEMENT_COLUMNS.map((col) => {
    const idx = headerRow.map(cellText).indexOf(col.header);
    return {
      ...col,
      colIndex: idx >= 0 ? idx : undefined,
      colLetter: idx >= 0 ? XLSX.utils.encode_col(idx) : undefined,
    };
  });

  const missingCols = columns.filter((c) => c.colIndex === undefined);
  if (missingCols.length > 0) {
    throw new Error(
      `Financement tab: missing columns: ${missingCols.map((c) => c.header).join(", ")}`,
    );
  }

  const instruments = [];
  let currentSection = null;
  for (let i = headerRowIdx + 1; i < Math.min(rows.length, headerRowIdx + 25); i++) {
    const row = rows[i];
    const label = cellText(row[0]);
    if (!label) continue;
    const section = FINANCEMENT_SECTIONS.find((s) => s.label === label);
    if (section) {
      currentSection = section;
      continue;
    }
    if (!currentSection) continue;
    if (/^\d{4}$/.test(label) || label === "Cash in") break;
    instruments.push({
      section: currentSection.label,
      instrumentType: currentSection.instrumentType,
      row: i + 1,
      labelTemplate: label,
      sample: Object.fromEntries(columns.map((c) => [c.key, row[c.colIndex]])),
    });
  }

  return { headerRow: headerRowIdx + 1, columns, instruments };
}

export function analyzeWorkbook(wb, sourceMeta) {
  const extractedAt = new Date().toISOString().slice(0, 10);

  const missingTabs = Object.keys(TAB_CATALOG).filter((t) => !wb.SheetNames.includes(t));
  if (missingTabs.length > 0) {
    throw new Error(`Template missing expected tabs: ${missingTabs.join(", ")}`);
  }

  const extraTabs = wb.SheetNames.filter((n) => !(n in TAB_CATALOG));
  if (extraTabs.length > 0) {
    throw new Error(`Template has unexpected tabs: ${extraTabs.join(", ")}`);
  }

  if (wb.SheetNames.length !== EXPECTED_TAB_COUNT) {
    throw new Error(`Expected ${EXPECTED_TAB_COUNT} tabs, got ${wb.SheetNames.length}`);
  }

  const sheets = wb.SheetNames.map((name) => {
    const meta = TAB_CATALOG[name];
    const ws = wb.Sheets[name];
    const rows = sheetRows(ws);
    const fillRuleRow = detectFillRuleRow(rows);
    const fillZones = (FILL_ZONE_HINTS[name] ?? []).map((zone) => ({
      ...zone,
      ruleRow: fillRuleRow?.row,
    }));
    const labelRows = extractLabelRows(rows);

    const sheet = {
      name,
      ...meta,
      fillRuleRow,
      fillZones,
      labelRows: labelRows.slice(0, 25),
    };

    if (name === "Financement") {
      sheet.financement = extractFinancementStructure(rows);
    }
    if (name === "Input Prévisionnel") {
      sheet.inputFields = INPUT_PREVISIONNEL_FIELDS;
      sheet.offerRows = Array.from({ length: OFFER_COUNT }, (_, i) => ({
        offerIndex: i + 1,
        label: `Offre ${i + 1}`,
        pricingCol: "B",
        setupCol: "C",
      }));
    }
    if (name === "CA") {
      sheet.revenuePattern = "monthly_mrr_multi_offer";
      sheet.offerCount = OFFER_COUNT;
    }
    return sheet;
  });

  return {
    source: {
      driveFileId: DRIVE_FILE_ID,
      driveFileName: DRIVE_FILE_NAME,
      driveFolder: DRIVE_FOLDER,
      sharedDriveId: sourceMeta.sharedDriveId,
      contentSha256: sourceMeta.contentSha256,
    },
    extractedAt,
    tabCount: wb.SheetNames.length,
    detectionTabs: BP_CANONICAL_DETECTION_TABS,
    sheets,
  };
}

export function analyzeWorkbookBuffer(buffer, sharedDriveId) {
  const contentSha256 = createHash("sha256").update(buffer).digest("hex");
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: false });
  return analyzeWorkbook(wb, { sharedDriveId, contentSha256 });
}

export function renderSpec(spec) {
  const lines = [
    "# Tomcat BP Template Spec",
    "",
    "> Auto-generated by `scripts/extract-bp-template-spec.mjs`. Do not edit by hand.",
    "",
    `Extracted: **${spec.extractedAt}**`,
    `Source: \`${spec.source.driveFolder} / ${spec.source.driveFileName}\` (Drive id \`${spec.source.driveFileId}\`)`,
    `SHA256: \`${spec.source.contentSha256}\``,
    "",
    "## Overview",
    "",
    `- **Tabs:** ${spec.tabCount} (canonical Tomcat SaaS template)`,
    "- **V1 export:** values only (formulas relink in V2)",
    "- **Benchmark:** Financement 1:1, P&L ±5%, trésorerie ±10%, RH ±5%",
    "",
    "## Canonical tabs",
    "",
    "| Tab | Slug | Role | Editable | Founder aliases |",
    "| --- | --- | --- | --- | --- |",
  ];

  for (const s of spec.sheets) {
    lines.push(
      `| ${s.name} | \`${s.slug}\` | ${s.role} | ${s.editable ? "yes" : "computed"} | ${s.founderAliases.join(", ")} |`,
    );
  }

  lines.push("", "## Tab details", "");

  for (const s of spec.sheets) {
    lines.push(`### ${s.name} (\`${s.slug}\`)`, "");
    lines.push(`- **Role:** ${s.role}`);
    if (s.fillZones?.length) {
      lines.push("", "**Fill zones:**", "");
      lines.push("| Kind | Label | Row labels | Values | Note |");
      lines.push("| --- | --- | --- | --- | --- |");
      for (const z of s.fillZones) {
        lines.push(
          `| ${z.kind} | ${z.label} | col ${z.rowLabelsColumn} | cols ${z.valueColumns} | ${z.note ?? ""} |`,
        );
      }
    }
    if (s.revenuePattern) {
      lines.push(`- **Revenue pattern (default):** \`${s.revenuePattern}\` (${s.offerCount} offers)`);
    }
    if (s.inputFields) {
      lines.push("", "**Key input fields (Input Prévisionnel):**", "");
      lines.push("| Key | Label | Col | Type |");
      lines.push("| --- | --- | --- | --- |");
      for (const f of s.inputFields) {
        lines.push(`| \`${f.key}\` | ${f.label} | ${f.column} | ${f.type} |`);
      }
      lines.push("", `**Offers:** ${OFFER_COUNT} tiers (Offre 1–${OFFER_COUNT})`);
    }
    if (s.financement) {
      lines.push("", "**Financement instrument columns:**", "");
      lines.push("| Key | Header | Col | Type |");
      lines.push("| --- | --- | --- | --- |");
      for (const c of s.financement.columns) {
        lines.push(`| \`${c.key}\` | ${c.header} | ${c.colLetter} | ${c.type} |`);
      }
      lines.push("", "**Sections → instrument types:**", "");
      for (const sec of FINANCEMENT_SECTIONS) {
        lines.push(`- ${sec.label} → \`${sec.instrumentType}\``);
      }
      lines.push("", "**Sample instrument rows (template placeholders):**", "");
      for (const inst of s.financement.instruments) {
        lines.push(`- Row ${inst.row}: \`${inst.labelTemplate}\` (${inst.instrumentType})`);
      }
    }
    if (s.labelRows.length) {
      lines.push("", "**Early row labels:**", "");
      for (const r of s.labelRows.slice(0, 10)) {
        lines.push(`- ${r.kind === "section" ? "Section" : "Field"} (row ${r.row}): ${r.label}`);
      }
    }
    lines.push("");
  }

  lines.push(
    "## Founder debt source (transform mode)",
    "",
    "Founder BPs (e.g. eSwit `Debt` tab) use monthly schedules (Principal / Interests rows),",
    "not the Financement instrument grid. Map via `FounderDebtInstrumentSchema` before drafting.",
    "",
    "## Regeneration",
    "",
    "```bash",
    "npm run extract:bp-template",
    "# or from a local copy:",
    "node scripts/extract-bp-template-spec.mjs --local /tmp/bp-study/template_maj.xlsx",
    "```",
    "",
  );
  return lines.join("\n");
}

function tsString(value) {
  return JSON.stringify(value);
}

export function renderSchema(spec) {
  const tabEntries = spec.sheets.map((s) => `  ${tsString(s.name)}: ${tsString(s.slug)}`);
  const detectionTabs = spec.detectionTabs.map((t) => `  ${tsString(t)},`).join("\n");

  return `/**
 * Canonical Tomcat BP template schema (Zod).
 * Auto-generated by scripts/extract-bp-template-spec.mjs — do not edit by hand.
 * Regenerate: npm run extract:bp-template
 */
import { z } from "zod";

export const BP_TEMPLATE_SOURCE = {
  driveFileId: ${tsString(spec.source.driveFileId)},
  driveFileName: ${tsString(spec.source.driveFileName)},
  driveFolder: ${tsString(spec.source.driveFolder)},
  sharedDriveId: ${tsString(spec.source.sharedDriveId)},
  contentSha256: ${tsString(spec.source.contentSha256)},
  extractedAt: ${tsString(spec.extractedAt)},
  tabCount: ${spec.tabCount},
} as const;

export const BP_CANONICAL_TAB_NAMES = [
${spec.sheets.map((s) => `  ${tsString(s.name)},`).join("\n")}
] as const;

export type BpCanonicalTabName = (typeof BP_CANONICAL_TAB_NAMES)[number];

export const BP_TAB_SLUGS = {
${tabEntries.join(",\n")},
} as const;

export type BpTabSlug = (typeof BP_TAB_SLUGS)[BpCanonicalTabName];

export const BpTabSlugSchema = z.enum([
${spec.sheets.map((s) => `  ${tsString(s.slug)},`).join("\n")}
]);

export const BpTemplateMetaSchema = z.object({
  source: z.object({
    driveFileId: z.string(),
    driveFileName: z.string(),
    driveFolder: z.string(),
    sharedDriveId: z.string(),
    contentSha256: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  extractedAt: z.string().regex(/^\\d{4}-\\d{2}-\\d{2}$/),
  tabCount: z.literal(${spec.tabCount}),
});

export const BpRevenuePatternSchema = z.enum([
  "monthly_mrr_multi_offer",
  "annual_subscription",
  "usage_based",
  "custom",
]);

export const BpFinancingInstrumentTypeSchema = z.enum([
  "equity_raise",
  "quasi_equity",
  "private_loan",
  "public_grant",
]);

const financingBase = { label: z.string().min(1) };

export const BpFinancingEquityRowSchema = z.object({
  ...financingBase,
  instrumentType: z.literal("equity_raise"),
  subscriptionDate: z.number().optional(),
  amount: z.number().optional(),
}).strict();

export const BpFinancingQuasiEquityRowSchema = z.object({
  ...financingBase,
  instrumentType: z.literal("quasi_equity"),
  subscriptionDate: z.number().optional(),
  amount: z.number().optional(),
}).strict();

export const BpFinancingPrivateLoanRowSchema = z.object({
  ...financingBase,
  instrumentType: z.literal("private_loan"),
  subscriptionDate: z.number().optional(),
  amount: z.number(),
  repaymentYears: z.number().optional(),
  annualRate: z.number().min(0).max(1).optional(),
  graceMonths: z.number().optional(),
  firstPaymentPct: z.number().min(0).max(1).optional(),
}).strict();

export const BpFinancingPublicGrantRowSchema = z.object({
  ...financingBase,
  instrumentType: z.literal("public_grant"),
  subscriptionDate: z.number().optional(),
  amount: z.number(),
  grantPortion: z.number().optional(),
  repaymentYears: z.number().optional(),
  annualRate: z.number().min(0).max(1).optional(),
  graceMonths: z.number().optional(),
  projectMonths: z.number().optional(),
}).strict();

export const BpFinancingInstrumentRowSchema = z.discriminatedUnion("instrumentType", [
  BpFinancingEquityRowSchema,
  BpFinancingQuasiEquityRowSchema,
  BpFinancingPrivateLoanRowSchema,
  BpFinancingPublicGrantRowSchema,
]);

export const BpFinancementTabDraftSchema = z.object({
  tabSlug: z.literal("financement"),
  instruments: z.array(BpFinancingInstrumentRowSchema).min(1),
});

/** Founder BP debt tab (e.g. eSwit « Debt »): monthly schedule, not instrument grid. */
export const FounderDebtPaymentRowSchema = z.object({
  periodIndex: z.number().int().optional(),
  principal: z.number().optional(),
  interest: z.number().optional(),
  payment: z.number().optional(),
  balanceEnd: z.number().optional(),
});

export const FounderDebtInstrumentSchema = z.object({
  label: z.string().min(1),
  sourceTab: z.string().optional(),
  subscriptionDate: z.union([z.number(), z.string()]).optional(),
  amount: z.number().optional(),
  annualRate: z.number().min(0).max(1).optional(),
  termMonths: z.number().int().optional(),
  schedule: z.array(FounderDebtPaymentRowSchema).optional(),
});

export const BpOfferPricingSchema = z.object({
  offerIndex: z.number().int().min(1).max(${OFFER_COUNT}),
  monthlyPricing: z.number().optional(),
  setupFee: z.number().optional(),
});

export const BpInputPrevisionnelSchema = z.object({
  cashBalanceDate: z.number().optional(),
  openingCashAmount: z.number().optional(),
  firstYearOfActivity: z.boolean().optional(),
  forecastStartDate: z.number().optional(),
  vatRate: z.number().min(0).max(1).optional(),
  offers: z.array(BpOfferPricingSchema).max(${OFFER_COUNT}).optional(),
});

export const BpWorkflowModeSchema = z.enum(["transform", "generate", "hybrid"]);

export const BP_CANONICAL_TAB_NAME_SET: ReadonlySet<string> = new Set(BP_CANONICAL_TAB_NAMES);

export const BP_CANONICAL_DETECTION_TABS = [
${detectionTabs}
] as const satisfies readonly BpCanonicalTabName[];

export function normalizeBpTabName(raw: string): string {
  const trimmed = raw.trim();
  if (/^p&l\\s*$/i.test(trimmed)) return "P&L ";
  return trimmed;
}

export function resolveCanonicalTabName(raw: string): BpCanonicalTabName | undefined {
  const normalized = normalizeBpTabName(raw);
  if (BP_CANONICAL_TAB_NAME_SET.has(normalized)) {
    return normalized as BpCanonicalTabName;
  }
  const lower = normalized.toLowerCase();
  for (const name of BP_CANONICAL_TAB_NAMES) {
    if (name.toLowerCase() === lower) return name;
  }
  return undefined;
}

export function countCanonicalDetectionTabs(sheetNames: readonly string[]): {
  hits: number;
  total: number;
  isCanonical: boolean;
} {
  const resolved = new Set(
    sheetNames
      .map((n) => resolveCanonicalTabName(n))
      .filter((n): n is BpCanonicalTabName => n !== undefined),
  );
  let hits = 0;
  for (const tab of BP_CANONICAL_DETECTION_TABS) {
    if (resolved.has(tab)) hits += 1;
  }
  return {
    hits,
    total: BP_CANONICAL_DETECTION_TABS.length,
    isCanonical: hits === BP_CANONICAL_DETECTION_TABS.length,
  };
}

export type BpFinancingInstrumentType = z.infer<typeof BpFinancingInstrumentTypeSchema>;
export type BpFinancingInstrumentRow = z.infer<typeof BpFinancingInstrumentRowSchema>;
export type BpFinancementTabDraft = z.infer<typeof BpFinancementTabDraftSchema>;
export type FounderDebtInstrument = z.infer<typeof FounderDebtInstrumentSchema>;
export type BpInputPrevisionnel = z.infer<typeof BpInputPrevisionnelSchema>;
export type BpWorkflowMode = z.infer<typeof BpWorkflowModeSchema>;
`;
}
