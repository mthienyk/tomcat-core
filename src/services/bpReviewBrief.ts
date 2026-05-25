import type { BpBusinessPlanDraft, BpTabSlug } from "../playbooks/bp/template-schema.js";
import { BP_EDITABLE_TAB_SLUGS } from "./bpTabMapping.js";

export type BpCoverageReport = {
  editableTabsTotal: number;
  editableTabsAutoFilled: number;
  autoFillPct: number;
  manualReviewTabs: BpTabSlug[];
  computedTabsFormulaLinked: BpTabSlug[];
  placeholdersUsed: boolean;
};

/** Structured brief for the agent to present to the human finance reviewer. */
export type BpReviewBrief = {
  summaryForChat: string;
  confirmBeforeExport: string[];
  agentTasks: string[];
};

const COMPUTED_TAB_SLUGS: BpTabSlug[] = [
  "ca",
  "aace",
  "pl",
  "plan_tresorerie",
  "bpi_plan_treso",
  "bpi_pl",
  "bpi_plan_financement",
  "tableaux_dossiers",
];

export const buildCoverageReport = (input: {
  draft: BpBusinessPlanDraft;
  placeholdersUsed: boolean;
}): BpCoverageReport => {
  const filled = new Set<BpTabSlug>();
  if (input.draft.financement) filled.add("financement");
  if (input.draft.rh) filled.add("rh");

  const editableTabsAutoFilled = BP_EDITABLE_TAB_SLUGS.filter((slug) => filled.has(slug)).length;

  return {
    editableTabsTotal: BP_EDITABLE_TAB_SLUGS.length,
    editableTabsAutoFilled,
    autoFillPct: Math.round((editableTabsAutoFilled / BP_EDITABLE_TAB_SLUGS.length) * 100),
    manualReviewTabs: input.draft.manualReviewTabs,
    computedTabsFormulaLinked: COMPUTED_TAB_SLUGS,
    placeholdersUsed: input.placeholdersUsed,
  };
};

export const buildBpReviewBrief = (input: {
  companyLabel: string;
  draft: BpBusinessPlanDraft;
  coverage: BpCoverageReport;
  mode: string;
  sourceBpTitle: string;
  hybridDebtFiles?: string[];
}): BpReviewBrief => {
  const lines = [
    `**BP Tomcat — ${input.companyLabel}**`,
    `Mode: ${input.mode}. Source: « ${input.sourceBpTitle} ».`,
    `Auto-rempli: ${String(input.coverage.editableTabsAutoFilled)}/${String(input.coverage.editableTabsTotal)} onglets éditables Tomcat (${String(input.coverage.autoFillPct)} %).`,
  ];

  if (input.coverage.placeholdersUsed) {
    lines.push("⚠ Des placeholders sont présents — ne pas exporter sans correction.");
  }

  if (input.draft.unmappedFounderTabs.length > 0) {
    lines.push(
      `Onglets founder non mappés: ${input.draft.unmappedFounderTabs.join(", ")}.`,
    );
  }

  const confirmBeforeExport = [
    "Valider le mapping Financement vs prêts réels (1:1).",
    "Vérifier RH / effectifs et recrutements futurs avec le fondateur.",
    "Valider le modèle CA (MRR vs annuel vs usage) — expliciter les hypothèses.",
    "Revoir charges d'exploitation (AACE) et Input Réalisé — non auto-remplis.",
    "Confirmer explicitement « exporte le BP » avant export_business_plan.",
  ];

  const agentTasks = [
    "Présenter ce brief à l'utilisateur en français, onglet par onglet.",
    "Pour CA et AACE: raisonner sur le contexte fondateur, pas de règles keywords.",
    "Si mode hybrid: lire les PDF prêts/DSN via read_company_document_excerpt avant de conclure Financement/RH.",
    "Ne pas appeler export_business_plan tant que l'utilisateur n'a pas explicitement demandé l'export.",
    "Après export xlsx: rappeler que P&L / trésorerie / BPI restent formula-linked — relink manuel dans Excel.",
  ];

  if (input.hybridDebtFiles?.length) {
    agentTasks.unshift(
      `Lire ${String(input.hybridDebtFiles.length)} fichier(s) prêt/DSN sur Drive avant validation Financement.`,
    );
  }

  if (input.draft.ca?.revenuePattern === "custom") {
    confirmBeforeExport.unshift(
      "Modèle revenu « custom » — session de validation CA avec le fondateur obligatoire.",
    );
  }

  return {
    summaryForChat: lines.join("\n"),
    confirmBeforeExport,
    agentTasks,
  };
};
