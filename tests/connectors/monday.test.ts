import { describe, expect, it, vi, beforeEach } from "vitest";
import { createHttpMondayConnector } from "../../src/connectors/monday.js";

const makeMonday = (boards: unknown[]) =>
  vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () =>
      Promise.resolve({
        data: { boards },
      }),
  } as unknown as Response);

describe("createHttpMondayConnector", () => {
  beforeEach(() => vi.unstubAllGlobals());

  describe("listPortfolio", () => {
    it("returns only boards with emoji in their name", async () => {
      vi.stubGlobal(
        "fetch",
        makeMonday([
          { id: "1", name: "Aistos 👩‍🚀💗", state: "active", updated_at: "2025-01-01T00:00:00Z" },
          { id: "2", name: "Kabaun 💗", state: "active", updated_at: "2025-03-01T00:00:00Z" },
          { id: "3", name: "Tâches", state: "active", updated_at: "2025-01-01T00:00:00Z" },
          { id: "4", name: "Sous-éléments de Aistos 👩‍🚀💗", state: "active", updated_at: "2025-01-01T00:00:00Z" },
          { id: "5", name: "Sprints", state: "active", updated_at: "2025-01-01T00:00:00Z" },
        ]),
      );

      const mon = createHttpMondayConnector("token");
      const portfolio = await mon.listPortfolio();

      expect(portfolio).toHaveLength(2);
      expect(portfolio.map((p) => p.id)).toEqual(["Aistos", "Kabaun"]);
    });

    it("sets id and startupId to the normalized company name (no emoji)", async () => {
      vi.stubGlobal(
        "fetch",
        makeMonday([
          { id: "10", name: "Seedext 💗", state: "active", updated_at: "2024-06-01T00:00:00Z" },
        ]),
      );

      const mon = createHttpMondayConnector("token");
      const [company] = await mon.listPortfolio();

      expect(company.id).toBe("Seedext");
      expect(company.startupId).toBe("Seedext");
      expect(company.status).toBe("active");
      expect(company.ownershipPct).toBeUndefined();
    });

    it("uses board updated_at as investedAt approximation", async () => {
      vi.stubGlobal(
        "fetch",
        makeMonday([
          { id: "11", name: "Bloom 💗", state: "active", updated_at: "2024-09-15T12:00:00Z" },
        ]),
      );

      const mon = createHttpMondayConnector("token");
      const [company] = await mon.listPortfolio();
      expect(company.investedAt).toBe("2024-09-15T12:00:00Z");
    });
  });

  describe("listSignals", () => {
    it("returns empty array (no signal board in current workspace)", async () => {
      const mon = createHttpMondayConnector("token");
      expect(await mon.listSignals(30)).toEqual([]);
    });
  });

  describe("listUpcomingEvents", () => {
    it("returns empty array (no events board in current workspace)", async () => {
      const mon = createHttpMondayConnector("token");
      expect(await mon.listUpcomingEvents()).toEqual([]);
    });
  });
});
