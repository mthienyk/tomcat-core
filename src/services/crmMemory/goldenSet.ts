import type { CrmMemoryChunkKind } from "../../domain/crmMemory.js";

export type GoldenQuery = {
  queryId: string;
  searchTexts?: string[];
  noteId?: string;
  chunkKind?: CrmMemoryChunkKind;
  sinceDays?: number;
  limit?: number;
  expectedTop3?: string[];
  expectedInTop10?: string[];
  expectLowRegime?: boolean;
  notes?: string;
};

export const CRM_MEMORY_GOLDEN_QUERIES: GoldenQuery[] = [
  {
    queryId: "payroll_b2b_silae_payfit",
    searchTexts: [
      "NessPay-style SaaS paie intégrée Silae/PayFit, distribution via cabinets "
      + "comptables, avance sur salaire PME. Connecteurs paie natifs, churn et NRR "
      + "par cohorte.",
    ],
    chunkKind: "recap",
    sinceDays: 1095,
    limit: 10,
    expectedTop3: ["NessPay", "Empowill", "Vysion"],
    expectedInTop10: ["Spayr", "Wobee"],
    notes: "Payroll wedge with accountant channel and payroll connectors",
  },
  {
    queryId: "proptech_gestion_locative_b2c_mandataire",
    searchTexts: [
      "Pinql-style app gestion locative pour proprio particuliers et foncières. "
      + "Bail digital, état des lieux, quittancement automatique. Mandataire B2C, "
      + "wedge B2B foncières au nb de lots.",
    ],
    chunkKind: "recap",
    sinceDays: 1095,
    limit: 10,
    expectedTop3: ["Pinql", "Nopillo", "Avis-Locataire"],
    expectedInTop10: ["Qlower", "Qeeps", "SmartGarant", "ImmoLevier"],
    notes: "Operational proptech vocabulary, not industry jargon (GED, AC3)",
  },
  {
    queryId: "creator_marketing_churn_plg",
    searchTexts: [
      "Plateforme creator marketing PLG, churn mensuel élevé, usage one-shot "
      + "recherche influenceurs, pricing bas, pivot Key Accounts non prouvé.",
    ],
    chunkKind: "investment_lens",
    sinceDays: 1095,
    limit: 10,
    expectedTop3: ["Tenors", "Bowo", "MeltingSpot"],
    notes: "Judgment-profile search; noteId Favikon anchor is higher signal",
  },
  {
    queryId: "hr_talent_smb_blue_collar",
    searchTexts: [
      "HR Tech SaaS entretiens annuels et GPEC pour PME/ETI blue-collar. Churn "
      + "très faible, contrats upfront multi-années, CVR demo faible, inbound à "
      + "scaler.",
    ],
    chunkKind: "recap",
    sinceDays: 1095,
    limit: 10,
    expectedTop3: ["Empowill", "Wobee"],
    expectedInTop10: ["Noota", "Moha"],
    notes: "HR talent management, not payroll core",
  },
  {
    queryId: "negative_question_format",
    searchTexts: [
      "Quelles boîtes similaires avons-nous déjà vues sur la paie pour PME ?",
    ],
    chunkKind: "recap",
    sinceDays: 1095,
    limit: 10,
    expectLowRegime: true,
    notes: "Anti-pattern — question format should trigger regimeSignals.scoreLevel low",
  },
  {
    queryId: "anchor_favikon_note",
    noteId: "84190149041",
    sinceDays: 1095,
    limit: 10,
    expectedTop3: ["Tenors", "Bowo", "MeltingSpot"],
    notes: "note_anchor baseline from Favikon M1 note",
  },
];
