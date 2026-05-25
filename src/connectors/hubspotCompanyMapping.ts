import type { Sector, Stage, Startup } from "../domain/entities.js";

export type HubspotCompanyProperties = Record<string, string | null>;

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

export const HUBSPOT_INVESTOR_COMPANY_TYPES = new Set([
  "Investisseur Business Angel",
  "Investisseur VC / FO",
  "INVESTISSEUR",
]);

export const mapHubspotVisibilityTier = (
  lifecycle: string | null | undefined,
): Startup["visibilityTier"] => {
  if (lifecycle === "customer") return "shared_with_investors";
  return "internal_only";
};

export const isHubspotInvestorCompany = (
  properties: HubspotCompanyProperties,
): boolean =>
  HUBSPOT_INVESTOR_COMPANY_TYPES.has(properties.type_d_entreprise ?? "");

export const mapHubspotCompanyToStartup = (input: {
  id: string;
  properties: HubspotCompanyProperties;
}): Startup => {
  const p = input.properties;
  const sector = SECTOR_MAP[p.type_d_industrie ?? ""] ?? "other";
  const country = p.country?.trim();
  const description = p.description?.trim();

  return {
    id: input.id,
    name: p.name ?? "",
    sectors: [sector],
    stage: STAGE_MAP[p.stade_d_intervention ?? ""] ?? "unknown",
    country: country || undefined,
    description: description || undefined,
    visibilityTier: mapHubspotVisibilityTier(p.lifecyclestage),
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
