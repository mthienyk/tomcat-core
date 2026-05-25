export type CrmMemorySearchTemplate = {
  id: string;
  label: string;
  chunkKind: "recap" | "investment_lens";
  searchTexts: string[];
};

export const CRM_MEMORY_SEARCH_TEMPLATES: CrmMemorySearchTemplate[] = [
  {
    id: "payroll_b2b_silae",
    label: "Payroll B2B — Silae/PayFit, canal EC",
    chunkKind: "recap",
    searchTexts: [
      "NessPay-style SaaS paie intégrée Silae/PayFit, distribution via cabinets "
      + "comptables, avance sur salaire PME. Connecteurs paie natifs, churn et NRR "
      + "par cohorte.",
    ],
  },
  {
    id: "hr_talent_smb",
    label: "HR Tech SMB — entretiens, GPEC, blue-collar",
    chunkKind: "recap",
    searchTexts: [
      "HR Tech SaaS entretiens annuels et GPEC pour PME/ETI blue-collar. Churn "
      + "très faible, contrats upfront multi-années, CVR demo faible, inbound à "
      + "scaler.",
    ],
  },
  {
    id: "proptech_gestion_locative",
    label: "Proptech — gestion locative, mandataire B2C",
    chunkKind: "recap",
    searchTexts: [
      "Pinql-style app gestion locative pour proprio particuliers et foncières. "
      + "Bail digital, état des lieux, quittancement automatique. Mandataire B2C, "
      + "wedge B2B foncières au nb de lots.",
    ],
  },
  {
    id: "creator_plg_churn",
    label: "Creator/PLG — churn élevé, pivot KA",
    chunkKind: "investment_lens",
    searchTexts: [
      "Plateforme creator marketing PLG, churn mensuel élevé, usage one-shot "
      + "recherche influenceurs, pricing bas, pivot Key Accounts non prouvé.",
    ],
  },
];
