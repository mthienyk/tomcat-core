import { describe, expect, it, vi } from "vitest";
import { ensureHubspotStartupForCompany } from "../../src/sync/ensureHubspotStartup.js";
import type { Startup } from "../../src/domain/entities.js";

const sampleStartup: Startup = {
  id: "51125394087",
  name: "Oscar AI",
  sectors: ["saas"],
  stage: "unknown",
  country: undefined,
  description: undefined,
  visibilityTier: "internal_only",
  sources: [{ system: "hubspot", externalId: "51125394087" }],
};

describe("ensureHubspotStartupForCompany", () => {
  it("returns exists when the startup is already in the directory", async () => {
    const store = {
      getStartupById: vi.fn(async () => sampleStartup),
      insertStartupIfAbsent: vi.fn(async () => false),
    };
    const connectors = {
      hubspot: {
        getStartupById: vi.fn(async () => sampleStartup),
      },
    };

    const result = await ensureHubspotStartupForCompany({
      store: store as never,
      connectors: connectors as never,
      companyId: sampleStartup.id,
    });

    expect(result).toBe("exists");
    expect(connectors.hubspot.getStartupById).not.toHaveBeenCalled();
  });

  it("inserts a startup fetched from HubSpot when absent locally", async () => {
    const store = {
      getStartupById: vi.fn(async () => undefined),
      insertStartupIfAbsent: vi.fn(async () => true),
    };
    const connectors = {
      hubspot: {
        getStartupById: vi.fn(async () => sampleStartup),
      },
    };

    const result = await ensureHubspotStartupForCompany({
      store: store as never,
      connectors: connectors as never,
      companyId: sampleStartup.id,
    });

    expect(result).toBe("created");
    expect(store.insertStartupIfAbsent).toHaveBeenCalledWith(sampleStartup);
  });

  it("returns missing when HubSpot has no company record", async () => {
    const store = {
      getStartupById: vi.fn(async () => undefined),
      insertStartupIfAbsent: vi.fn(async () => true),
    };
    const connectors = {
      hubspot: {
        getStartupById: vi.fn(async () => undefined),
      },
    };

    const result = await ensureHubspotStartupForCompany({
      store: store as never,
      connectors: connectors as never,
      companyId: "missing",
    });

    expect(result).toBe("missing");
    expect(store.insertStartupIfAbsent).not.toHaveBeenCalled();
  });
});
