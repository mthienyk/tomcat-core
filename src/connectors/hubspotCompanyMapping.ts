import type { Sector, Stage, Startup } from "../domain/entities.js";
import type { StartupDirectoryTier } from "../domain/startupDirectory.js";
import {
  computeStartupDirectoryTier,
  isHubspotInvestorCompany,
  parseHubspotCompanyTypes,
  visibilityTierForDirectoryTier,
} from "./hubspotCompanyEligibility.js";

export type HubspotCompanyProperties = Record<string, string | null>;

export { isHubspotInvestorCompany, parseHubspotCompanyTypes };

const SECTOR_MAP: Partial<Record<string, Sector>> = {
  "Future of Work": "saas",
  "Impact / Tech for good": "climate",
  PropTech: "marketplace",
  "Consumer Engagement": "consumer",
  "IT, Cyber & IA": "deeptech",
  "Future of Finance": "fintech",
  Autres: "other",
};

const STAGE_MAP: Partial<Record<string, Stage>> = {
  Seed: "seed",
  "Série A": "series_a",
  "Série B": "series_b",
};

export const mapHubspotVisibilityTier = (
  lifecycle: string | null | undefined,
): Startup["visibilityTier"] => {
  if (lifecycle === "customer") return "shared_with_investors";
  return "internal_only";
};

const initialDirectoryTier = (
  properties: HubspotCompanyProperties,
): StartupDirectoryTier =>
  computeStartupDirectoryTier({
    hubspotLifecycle: properties.lifecyclestage,
    hubspotCompanyType: properties.type_d_entreprise,
    hasInvestedDeal: false,
    isPortfolio: false,
  });

export const mapHubspotCompanyToStartup = (input: {
  id: string;
  properties: HubspotCompanyProperties;
}): Startup => {
  const p = input.properties;
  const sector = SECTOR_MAP[p.type_d_industrie ?? ""] ?? "other";
  const country = p.country?.trim();
  const description = p.description?.trim();
  const directoryTier = initialDirectoryTier(p);

  return {
    id: input.id,
    name: p.name ?? "",
    sectors: [sector],
    stage: STAGE_MAP[p.stade_d_intervention ?? ""] ?? "unknown",
    country: country || undefined,
    description: description || undefined,
    visibilityTier: visibilityTierForDirectoryTier(directoryTier),
    directoryTier,
    hubspotLifecycle: p.lifecyclestage ?? undefined,
    hubspotCompanyType: p.type_d_entreprise ?? undefined,
    sources: [{ system: "hubspot", externalId: input.id, url: undefined }],
  };
};

export const HUBSPOT_STARTUP_DIRECTORY_PROPERTIES = [
  "name",
  "country",
  "description",
  "lifecyclestage",
  "stade_d_intervention",
  "type_d_industrie",
  "type_d_entreprise",
] as const;
