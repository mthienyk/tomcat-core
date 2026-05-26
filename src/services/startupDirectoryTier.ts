import type { Startup } from "../domain/entities.js";
import {
  computeStartupDirectoryTier,
  visibilityTierForDirectoryTier,
} from "../connectors/hubspotCompanyEligibility.js";
import type { CoreStore } from "../storage/coreStore.js";
import { matchConfidence, normalizeEntityKey } from "./entityResolution.js";

const portfolioMatch = (
  startupName: string,
  portfolioCompanyId: string,
): boolean => {
  if (normalizeEntityKey(startupName) === normalizeEntityKey(portfolioCompanyId)) {
    return true;
  }
  return (
    matchConfidence(portfolioCompanyId, startupName).confidence >= 0.88
    || matchConfidence(startupName, portfolioCompanyId).confidence >= 0.88
  );
};

export const recomputeStartupDirectoryTiers = async (
  store: CoreStore,
): Promise<{ updated: number }> => {
  const [startups, portfolioCompanies, investedStartupIds] = await Promise.all([
    store.listStartups(),
    store.listPortfolioCompanies(),
    store.listInvestedStartupIds(),
  ]);

  const invested = new Set(investedStartupIds);
  let updated = 0;

  for (const startup of startups) {
    const isPortfolio = portfolioCompanies.some((row) =>
      portfolioMatch(startup.name, row.id),
    );
    const directoryTier = computeStartupDirectoryTier({
      hubspotLifecycle: startup.hubspotLifecycle,
      hubspotCompanyType: startup.hubspotCompanyType,
      hasInvestedDeal: invested.has(startup.id),
      isPortfolio,
    });
    const visibilityTier = visibilityTierForDirectoryTier(directoryTier);

    if (
      startup.directoryTier === directoryTier
      && startup.visibilityTier === visibilityTier
    ) {
      continue;
    }

    await store.updateStartupDirectoryClassification({
      id: startup.id,
      directoryTier,
      visibilityTier,
    });
    updated += 1;
  }

  return { updated };
};

export const recomputeStartupDirectoryTierById = async (
  store: CoreStore,
  startupId: string,
): Promise<void> => {
  const startup = await store.getStartupById(startupId);
  if (!startup) return;

  const [portfolioCompanies, investedStartupIds] = await Promise.all([
    store.listPortfolioCompanies(),
    store.listInvestedStartupIds(),
  ]);

  const isPortfolio = portfolioCompanies.some((row) =>
    portfolioMatch(startup.name, row.id),
  );
  const directoryTier = computeStartupDirectoryTier({
    hubspotLifecycle: startup.hubspotLifecycle,
    hubspotCompanyType: startup.hubspotCompanyType,
    hasInvestedDeal: investedStartupIds.includes(startupId),
    isPortfolio,
  });
  const visibilityTier = visibilityTierForDirectoryTier(directoryTier);

  if (
    startup.directoryTier === directoryTier
    && startup.visibilityTier === visibilityTier
  ) {
    return;
  }

  await store.updateStartupDirectoryClassification({
    id: startup.id,
    directoryTier,
    visibilityTier,
  });
};

export type StartupDirectoryClassification = Pick<
  Startup,
  "id" | "directoryTier" | "visibilityTier"
>;
