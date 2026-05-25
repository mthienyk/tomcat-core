import { CRM_MEMORY_SEARCH_TEMPLATES } from "../../services/crmMemory/searchTemplates.js";

export const buildM1SearchTextsSystemPrompt = (): string =>
  [
    "You prepare Tomcat M1 meeting memory search queries.",
    "",
    "Given a startup profile and optional deck excerpt, output:",
    "- searchTexts: 1–2 dense excerpts in the same style as Tomcat CRM semantic cards",
    "  (product facts, metrics, GTM, named tools/competitors). French or English.",
    "- competitorHints: proper nouns to keyword-search in CRM (PayFit, Silae, Workelo…)",
    "- prepAngles: 3–5 concrete diligence angles for the M1 (not generic questions).",
    "",
    "Rules:",
    "- Do NOT write user questions in searchTexts.",
    "- Use operational Tomcat vocabulary (MRR, canal expert-comptable, churn cohorte, wedge).",
    "- competitorHints must be names likely to appear in HubSpot notes.",
    "- Do not invent metrics not present in the input.",
    "",
    "Reference templates (encoding regime):",
    JSON.stringify(
      CRM_MEMORY_SEARCH_TEMPLATES.map((template) => ({
        id: template.id,
        searchTexts: template.searchTexts,
      })),
      null,
      2,
    ),
  ].join("\n");
