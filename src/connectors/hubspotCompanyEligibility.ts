import type { Startup } from "../domain/entities.js";
import type { StartupDirectoryTier } from "../domain/startupDirectory.js";
import type { HubspotCompanyProperties } from "./hubspotCompanyMapping.js";

export const HUBSPOT_INVESTOR_COMPANY_TYPES = new Set([
  "Investisseur Business Angel",
  "Investisseur VC / FO",
  "INVESTISSEUR",
]);

export const HUBSPOT_STARTUP_COMPANY_TYPE = "START-UP";

export const HUBSPOT_ALUMNI_LIFECYCLE_STAGES = new Set(["evangelist", "98121635"]);

export const parseHubspotCompanyTypes = (
  value: string | null | undefined,
): string[] => {
  if (!value?.trim()) return [];
  return value.split(";").map((part) => part.trim()).filter(Boolean);
};

export const isHubspotInvestorCompany = (
  properties: HubspotCompanyProperties,
): boolean =>
  parseHubspotCompanyTypes(properties.type_d_entreprise).some((type) =>
    HUBSPOT_INVESTOR_COMPANY_TYPES.has(type),
  );

export const isHubspotPartnerOnlyCompany = (
  properties: HubspotCompanyProperties,
): boolean => {
  const types = parseHubspotCompanyTypes(properties.type_d_entreprise);
  return types.length > 0 && types.every((type) => type === "BUSINESS PARTNER");
};

/**
 * HubSpot directory ingest filter (companies/search pre-filter is lifecycle-only).
 * Drops investor/partner noise and dealflow rows with no START-UP tag.
 * Customer/alumni/exit rows stay for deal-based reclassification in Postgres.
 */
export const passesHubspotDirectoryIngestFilter = (
  properties: HubspotCompanyProperties,
): boolean => {
  if (isHubspotInvestorCompany(properties)) return false;
  if (isHubspotPartnerOnlyCompany(properties)) return false;

  const lifecycle = properties.lifecyclestage ?? "";
  const types = parseHubspotCompanyTypes(properties.type_d_entreprise);

  if (lifecycle === "opportunity") {
    return types.includes(HUBSPOT_STARTUP_COMPANY_TYPE);
  }

  return lifecycle === "customer"
    || lifecycle === "evangelist"
    || lifecycle === "98121635";
};

export const computeStartupDirectoryTier = (input: {
  hubspotLifecycle: string | null | undefined;
  hubspotCompanyType: string | null | undefined;
  hasInvestedDeal: boolean;
  isPortfolio: boolean;
}): StartupDirectoryTier => {
  if (input.isPortfolio) return "portfolio";

  const lifecycle = input.hubspotLifecycle ?? "";
  const hasStartupType = parseHubspotCompanyTypes(input.hubspotCompanyType).includes(
    HUBSPOT_STARTUP_COMPANY_TYPE,
  );

  if (input.hasInvestedDeal) {
    if (HUBSPOT_ALUMNI_LIFECYCLE_STAGES.has(lifecycle)) return "alumni";
    return "invested";
  }

  if (lifecycle === "opportunity" && hasStartupType) return "dealflow";

  return "excluded";
};

export const visibilityTierForDirectoryTier = (
  tier: StartupDirectoryTier,
): Startup["visibilityTier"] => {
  if (
    tier === "portfolio"
    || tier === "invested"
    || tier === "alumni"
  ) {
    return "shared_with_investors";
  }
  return "internal_only";
};
