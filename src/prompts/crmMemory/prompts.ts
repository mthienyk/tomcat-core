import type { CrmMemorySemanticCardOutput } from "./semanticCardSchema.js";

const TOMCAT_CONTEXT = `# Tomcat CRM memory context

Tomcat is a venture investor and startup accelerator based in France. The investment team tracks
startups in HubSpot from first contact through diligence (M1, M2, board) to portfolio monitoring.

## What HubSpot notes are

Notes are free-text CRM records attached to a startup company. They are written by Tomcat team
members after calls, meetings, or diligence steps. They are the institutional memory of what Tomcat
has seen, thought, and decided on a deal.

Important note types:

- **M1/M2 synthesis**: long structured notes after selection meetings (often 500+ words). They
  contain market view, team assessment, product/GTM read, red flags, and open questions. Often
  tagged in the body with patterns like \`M1\`, \`M2\`, \`M0\`, \`exec summary\`.
- **Board notes**: updates after portfolio board meetings.
- **Ops notes**: short follow-ups, scheduling, admin. Low retrieval value unless they contain
  substantive judgment.

## Who writes notes

- **Élie** (\`elie.dupredesaintmaur@tomcat.eu\`): M1 selection meetings (~45 min prep, 1h15 call,
  45 min synthesis note). His notes are high-value for prep on similar deals.
- **Kevin and others**: sourcing, pipeline updates, investor relations context.
- **Patrice/Jeremy**: portfolio board debriefs.

## What we want to retrieve

When someone prepares an M1 on a new startup, they ask: **"Have we already seen something
similar? What did we conclude?"**

Similarity is not keyword matching. Two startups can be comparable because they:

- address the same buyer problem (e.g. payroll B2B churn),
- use a similar GTM motion (PLG vs enterprise sales),
- show the same red flags (logo wall, inflated team claims),
- operate in adjacent markets even if HubSpot sector tags differ.

## Extraction rules

- Extract only what is stated or reasonably implied in the note and startup context.
- Separate **facts** (what the company does, metrics cited) from **Tomcat judgment** (concerns,
  market view, recommendation tone).
- Do not invent metrics, customers, or outcomes.
- Prefer French or English matching the source note language.
- Short ops notes: keep recap minimal; do not over-interpret.`;

const GOLDEN_INPUT = {
  startup: {
    name: "Favikon",
    sectors: ["consumer"],
    stage: "unknown",
    country: "France",
    description:
      "Favikon is the first AI powered creator marketing platform that provides brands with actionable insights for their social media strategy.",
  },
  note: {
    authorEmail: "elie.dupredesaintmaur@tomcat.eu",
    createdAt: "2025-07-24T16:16:21.368Z",
    body: "Debrief M1 avec Favikon (déjà vu en M1 et no go en 2023). Exec Sum: sur le papier c'est top (CEO US-centric, ESCP/ScPo, 2e XP co-founder ex-Techstars, 110k MRR, rentable). Mais churn de ouf 11-12%/mois (rétention 12 mois ~0), usage one-shot recherche créateurs inchangé depuis 2 ans, pricing 20-100€/m, cap table éclatée (60% co-founders, BSAR floor 12m€), ADN full PLG incompatible avec pivot Key Accounts. Conclusion: no go. ICP créateur (20€/m, 1200 clients, churn 11%) + TPE/PME (100€/m, 550 clients, churn 12%). Logos Orange/UberEats vendus très cheap. 3e ICP KA (ACV 5-15k€) annoncé pour Oct, zéro client, offre à bâtir.",
  },
};

const GOLDEN_OUTPUT: CrmMemorySemanticCardOutput = {
  noteKind: "m1_m2",
  recap:
    "Favikon — plateforme marketing influenceurs / dashboard perf créateurs pour marques. 110 k€ MRR, rentable. Deux ICPs PLG : créateurs (20 €/m) et TPE/PME (100 €/m), usage one-shot recherche d'influenceurs. Churn 11–12 %/mois. Déjà vu en M1 et no go en 2023.",
  investmentLens:
    "Profil CEO impressionnant et efficience capital réelle, mais fondamentaux inchangés depuis 2023 : churn catastrophique, usage one-shot, pricing bas, ADN PLG incompatible avec pivot Key Accounts annoncé sans track record. Cap table tendue post-BSAR floor 12 M€. CEO fuit le sales-led et vend du futur. Conclusion M1 : no go.",
  markets: ["creator marketing", "influenceur B2B", "social media analytics"],
  customerSegments: [
    "créateurs de contenu",
    "TPE/PME",
    "Key accounts (pipe, non prouvé)",
  ],
  businessModel: "SaaS mensuel PLG (20 €/m créateurs, 100 €/m TPE/PME)",
  gtmMotion:
    "Full PLG inbound ; pivot Key Accounts annoncé sans track record commercial",
  redFlags: [
    "Churn 11–12 %/mois (rétention 12 mois ~0)",
    "Usage one-shot inchangé depuis 2 ans",
    "Pricing bas malgré logos enterprise",
    "CEO fuit le sales-led",
    "Cap table tendue + BSAR floor 12 M€",
    "Déjà no go en 2023, problèmes identiques",
  ],
  positiveSignals: [
    "110 k€ MRR rentable",
    "CAC faible, payback ~2 mois",
    "Efficience capital depuis 2020",
    "CEO profil US / Techstars",
  ],
  competitorNames: [],
  tomcatTake:
    "No go : métriques top-line trompeuses masquant un produit one-shot à churn structurel ; pivot KA non crédible sans changement d'ADN commercial.",
  questionsToReuse: [
    "Churn mensuel par segment et rétention cohorte 12 mois ?",
    "Part des clients TPE/PME qui n'utilisent que la recherche d'influenceurs ?",
    "Track record et pipeline Key Accounts (ACV 5–15 k€) ?",
    "Impact des BSAR récents sur la prochaine levée ?",
  ],
  confidence: "high",
  language: "fr",
};

export const buildSemanticCardSystemPrompt = (): string =>
  [
    TOMCAT_CONTEXT,
    "",
    "## Example",
    "",
    "Transform the CRM note input into the semantic card output below.",
    "",
    "Input:",
    JSON.stringify(GOLDEN_INPUT, null, 2),
    "",
    "Output:",
    JSON.stringify(GOLDEN_OUTPUT, null, 2),
  ].join("\n");

export const buildHydeSystemPrompt = (): string =>
  [
    TOMCAT_CONTEXT,
    "",
    "You help Tomcat retrieve similar historical startup cases from CRM memory.",
    "Given a reference startup profile or a user question, produce 1-3 short hypothetical",
    "M1/M2 synthesis excerpts that would match comparable companies Tomcat has already seen.",
    "Write as dense CRM note excerpts, not keyword lists.",
  ].join("\n");
