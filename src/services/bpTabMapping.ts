import type { BpTabSlug } from "../playbooks/bp/template-schema.js";
import {
  BP_TAB_SLUGS,
  resolveCanonicalTabName,
  type BpCanonicalTabName,
} from "../playbooks/bp/template-schema.js";

export type FounderTabMapping = {
  founderTab: string;
  canonicalSlug: BpTabSlug;
  confidence: "exact" | "alias";
};

const SLUG_ALIASES: Record<BpTabSlug, RegExp[]> = {
  input_realise: [/réalisé/i, /realise/i, /actuals/i, /historique/i, /realized/i],
  input_previsionnel: [/^input$/i, /assumption/i, /drivers/i, /prévisionnel/i],
  ca: [/revenue/i, /revenues/i, /\bmrr\b/i, /topline/i, /bp-revenue/i, /hyp-revenue/i],
  aace: [/opex/i, /external charges/i, /charges externes/i, /bp-cost/i, /hyp-cost/i],
  rh: [/payroll/i, /people costs?/i, /staff costs?/i, /\brh\b/i, /hyp-people/i],
  financement: [/debt/i, /loan/i, /financing/i, /financement/i, /bnp loan/i],
  pl: [/^p&l/i, /compte de résultat/i, /income statement/i, /bp-overall/i],
  plan_tresorerie: [/bp-cash/i, /cash flow/i, /trésorerie/i, /tresorerie/i],
  bpi_plan_treso: [/bpi.*tr[ée]so/i],
  bpi_pl: [/bpi.*p&l/i, /bpi.*cr/i, /bpi.*résultat/i],
  bpi_plan_financement: [/bpi.*financement/i],
  tableaux_dossiers: [/tableaux dossiers/i, /^metrics$/i],
};

/** Tabs typically filled manually by the finance reviewer even after auto-parse. */
export const BP_MANUAL_REVIEW_SLUGS: BpTabSlug[] = [
  "input_realise",
  "input_previsionnel",
  "aace",
  "ca",
];

export const BP_EDITABLE_TAB_SLUGS: BpTabSlug[] = [
  "input_realise",
  "input_previsionnel",
  "rh",
  "financement",
];

export const mapFounderTabToCanonical = (founderTab: string): FounderTabMapping | null => {
  const canonical = resolveCanonicalTabName(founderTab);
  if (canonical) {
    return {
      founderTab,
      canonicalSlug: BP_TAB_SLUGS[canonical as BpCanonicalTabName],
      confidence: "exact",
    };
  }

  const normalized = founderTab.trim();
  for (const [slug, patterns] of Object.entries(SLUG_ALIASES) as [BpTabSlug, RegExp[]][]) {
    if (patterns.some((pattern) => pattern.test(normalized))) {
      return { founderTab, canonicalSlug: slug, confidence: "alias" };
    }
  }
  return null;
};

export const mapFounderWorkbookTabs = (
  sheetNames: readonly string[],
): {
  mappings: FounderTabMapping[];
  unmapped: string[];
  duplicateFounderTabs: string[];
  manualReviewTabs: BpTabSlug[];
} => {
  const mappings: FounderTabMapping[] = [];
  const unmapped: string[] = [];
  const duplicateFounderTabs: string[] = [];
  const mappedSlugs = new Set<BpTabSlug>();

  for (const tab of sheetNames) {
    const hit = mapFounderTabToCanonical(tab);
    if (!hit) {
      unmapped.push(tab);
      continue;
    }
    if (mappedSlugs.has(hit.canonicalSlug)) {
      duplicateFounderTabs.push(tab);
      continue;
    }
    mappings.push(hit);
    mappedSlugs.add(hit.canonicalSlug);
  }

  const manualReviewTabs = BP_MANUAL_REVIEW_SLUGS.filter((slug) => mappedSlugs.has(slug));

  return { mappings, unmapped, duplicateFounderTabs, manualReviewTabs };
};
