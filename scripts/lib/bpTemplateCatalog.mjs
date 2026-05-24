/** Shared BP template catalog — single source for extract + classify scripts. */

export const DRIVE_FILE_ID = "1iE3sfRF-oyGXp11BO9Uxn7xH-f--Oxo2";
export const DRIVE_FILE_NAME = "MAJ Template BP SaaS.xlsx";
export const DRIVE_FOLDER = "05. Templates BP";
export const EXPECTED_TAB_COUNT = 12;
export const OFFER_COUNT = 4;

/** @type {Record<string, { slug: string; role: string; editable: boolean; founderAliases: string[] }>} */
export const TAB_CATALOG = {
  "Input Réalisé": {
    slug: "input_realise",
    role: "Historical actuals (P&L realised + realised cash)",
    editable: true,
    founderAliases: ["Input", "Réalisé", "Actuals", "Historique"],
  },
  "Input Prévisionnel": {
    slug: "input_previsionnel",
    role: "Forecast assumptions entry point (treasury, offers, TVA, CA drivers)",
    editable: true,
    founderAliases: ["Assumptions", "Hypothèses", "Input", "Drivers"],
  },
  CA: {
    slug: "ca",
    role: "Revenue build (MRR, offers, client counts)",
    editable: false,
    founderAliases: ["Revenue", "Revenues", "MRR", "HYP-Revenues", "Topline"],
  },
  AACE: {
    slug: "aace",
    role: "External charges (marketing, subcontractors, R&D)",
    editable: false,
    founderAliases: ["Opex", "External charges", "Charges externes"],
  },
  RH: {
    slug: "rh",
    role: "Payroll / headcount by role",
    editable: true,
    founderAliases: ["Payroll", "Staff costs", "People", "RH"],
  },
  Financement: {
    slug: "financement",
    role: "Debt & equity schedules (1:1 loan mapping target)",
    editable: true,
    founderAliases: ["Debt", "Financial debt", "Loan", "BNP Loan", "Financing"],
  },
  "P&L ": {
    slug: "pl",
    role: "Computed P&L (annual)",
    editable: false,
    founderAliases: ["P&L", "Compte de résultat", "Income statement"],
  },
  "Plan de trésorerie": {
    slug: "plan_tresorerie",
    role: "12-month cash plan",
    editable: false,
    founderAliases: ["Cash", "Cash FC", "Trésorerie", "Cash flow"],
  },
  "BPI-Plan de tréso": {
    slug: "bpi_plan_treso",
    role: "BPI grant / loan cash reporting view",
    editable: false,
    founderAliases: ["BPI tréso", "BPI cash"],
  },
  "BPI - compte de résultat prévis": {
    slug: "bpi_pl",
    role: "BPI P&L reporting view (kEUR)",
    editable: false,
    founderAliases: ["BPI P&L", "BPI CR"],
  },
  "BPI - Plan de financement": {
    slug: "bpi_plan_financement",
    role: "BPI financing plan view (kEUR)",
    editable: false,
    founderAliases: ["BPI financement"],
  },
  "Tableaux Dossiers": {
    slug: "tableaux_dossiers",
    role: "Summary tables for dossiers (EBITDA coverage, YoY)",
    editable: false,
    founderAliases: ["Dossiers", "Summary"],
  },
};

export const BP_CANONICAL_TAB_NAMES = Object.keys(TAB_CATALOG);

export const BP_CANONICAL_DETECTION_TABS = [
  "Input Réalisé",
  "Input Prévisionnel",
  "CA",
  "AACE",
  "RH",
  "Financement",
  "P&L ",
  "Plan de trésorerie",
];

export const FINANCEMENT_SECTIONS = [
  { label: "Augmentation de capital", instrumentType: "equity_raise" },
  { label: "Quasi Fonds Propres", instrumentType: "quasi_equity" },
  { label: "Financement Privé", instrumentType: "private_loan" },
  { label: "Financement Public", instrumentType: "public_grant" },
];

export const FINANCEMENT_COLUMNS = [
  { key: "subscriptionDate", header: "Date de souscription", type: "excel_date" },
  { key: "amount", header: "Montant", type: "currency_eur" },
  { key: "grantPortion", header: "dont subvention", type: "currency_eur" },
  { key: "repaymentYears", header: "Durée de Rbmt (années)", type: "years" },
  { key: "annualRate", header: "Taux annuel", type: "rate_decimal" },
  { key: "graceMonths", header: "Différé (mois)", type: "months" },
  { key: "firstPaymentPct", header: "% premier versement", type: "unit_interval" },
  { key: "projectMonths", header: "Durée du projet (mois)", type: "months" },
];

/** Documented fill zones (row labels vs value columns). */
export const FILL_ZONE_HINTS = {
  "Input Réalisé": [
    {
      kind: "manual",
      label: "P&L réalisé",
      rowLabelsColumn: "A",
      valueColumns: "B-D",
      note: "Annual actuals by P&L line",
    },
    {
      kind: "computed",
      label: "Trésorerie réalisée",
      rowLabelsColumn: "F",
      valueColumns: "H-L",
      note: "Auto-filled cash actuals; fill current year only",
    },
  ],
  "Input Prévisionnel": [
    {
      kind: "manual",
      label: "Hypothèses entreprise et CA",
      rowLabelsColumn: "A",
      valueColumns: "C+",
      note: "Manual assumptions; marker « A modifier » in col C",
    },
  ],
  Financement: [
    {
      kind: "manual",
      label: "Instruments de financement",
      rowLabelsColumn: "A",
      valueColumns: "B-I",
      headerRow: 7,
      note: "One row per equity/quasi/loan/grant instrument",
    },
  ],
};

export const INPUT_PREVISIONNEL_FIELDS = [
  {
    key: "cashBalanceDate",
    label: "Montant de trésorerie à fin (date)",
    column: "C",
    type: "excel_date",
  },
  {
    key: "openingCashAmount",
    label: "Montant de trésorerie à fin (montant EUR)",
    column: "D",
    type: "currency_eur",
  },
  {
    key: "firstYearOfActivity",
    label: "Première année d'activité",
    column: "C",
    type: "boolean_oui_non",
  },
  {
    key: "forecastStartDate",
    label: "A quelle date démarre le prévisionnel",
    column: "C",
    type: "excel_date",
  },
  {
    key: "vatRate",
    label: "TVA Applicable",
    column: "D",
    type: "rate_decimal",
  },
];

/** Normalize founder tab names toward canonical matching. */
export function normalizeBpTabName(raw) {
  const trimmed = raw.trim();
  if (/^p&l\s*$/i.test(trimmed)) return "P&L ";
  return trimmed;
}

export function resolveCanonicalTabName(raw) {
  const normalized = normalizeBpTabName(raw);
  if (normalized in TAB_CATALOG) return normalized;
  const lower = normalized.toLowerCase();
  for (const name of BP_CANONICAL_TAB_NAMES) {
    if (name.toLowerCase() === lower) return name;
  }
  return undefined;
}

export function countCanonicalDetectionTabs(sheetNames) {
  const resolved = new Set(
    sheetNames.map((n) => resolveCanonicalTabName(n)).filter(Boolean),
  );
  let hits = 0;
  for (const tab of BP_CANONICAL_DETECTION_TABS) {
    if (resolved.has(tab)) hits += 1;
  }
  return { hits, total: BP_CANONICAL_DETECTION_TABS.length, resolved };
}
