import { describe, expect, it } from "vitest";
import {
  computeStartupDirectoryTier,
  isHubspotInvestorCompany,
  isHubspotPartnerOnlyCompany,
  passesHubspotDirectoryIngestFilter,
  visibilityTierForDirectoryTier,
} from "../../src/connectors/hubspotCompanyEligibility.js";

describe("hubspotCompanyEligibility", () => {
  it("detects investor tags in multi-select type_d_entreprise", () => {
    expect(
      isHubspotInvestorCompany({
        type_d_entreprise: "Investisseur Business Angel;START-UP",
      }),
    ).toBe(true);
  });

  it("excludes partner-only companies", () => {
    expect(
      isHubspotPartnerOnlyCompany({ type_d_entreprise: "BUSINESS PARTNER" }),
    ).toBe(true);
    expect(
      passesHubspotDirectoryIngestFilter({
        lifecyclestage: "customer",
        type_d_entreprise: "BUSINESS PARTNER",
      }),
    ).toBe(false);
  });

  it("requires START-UP type for dealflow lifecycle ingest", () => {
    expect(
      passesHubspotDirectoryIngestFilter({
        lifecyclestage: "opportunity",
        type_d_entreprise: null,
      }),
    ).toBe(false);
    expect(
      passesHubspotDirectoryIngestFilter({
        lifecyclestage: "opportunity",
        type_d_entreprise: "START-UP",
      }),
    ).toBe(true);
  });

  it("classifies portfolio and invested tiers from HubSpot + deals + Monday", () => {
    expect(
      computeStartupDirectoryTier({
        hubspotLifecycle: "customer",
        hubspotCompanyType: "START-UP",
        hasInvestedDeal: true,
        isPortfolio: true,
      }),
    ).toBe("portfolio");

    expect(
      computeStartupDirectoryTier({
        hubspotLifecycle: "customer",
        hubspotCompanyType: "START-UP",
        hasInvestedDeal: true,
        isPortfolio: false,
      }),
    ).toBe("invested");

    expect(
      computeStartupDirectoryTier({
        hubspotLifecycle: "evangelist",
        hubspotCompanyType: "START-UP",
        hasInvestedDeal: true,
        isPortfolio: false,
      }),
    ).toBe("alumni");

    expect(
      computeStartupDirectoryTier({
        hubspotLifecycle: "opportunity",
        hubspotCompanyType: "START-UP",
        hasInvestedDeal: false,
        isPortfolio: false,
      }),
    ).toBe("dealflow");

    expect(
      computeStartupDirectoryTier({
        hubspotLifecycle: "customer",
        hubspotCompanyType: "START-UP",
        hasInvestedDeal: false,
        isPortfolio: false,
      }),
    ).toBe("excluded");
  });

  it("maps investor-visible tiers for Society", () => {
    expect(visibilityTierForDirectoryTier("portfolio")).toBe(
      "shared_with_investors",
    );
    expect(visibilityTierForDirectoryTier("dealflow")).toBe("internal_only");
    expect(visibilityTierForDirectoryTier("excluded")).toBe("internal_only");
  });
});
