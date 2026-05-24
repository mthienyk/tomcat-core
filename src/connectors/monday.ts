import { ConnectorFailed, ConnectorNotConfigured, CoreError } from "../errors/index.js";
import type { Event, PortfolioCompany, PortfolioSignal } from "../domain/entities.js";
import type { MondayConnector } from "./types.js";
import { createHttpClient } from "./http.js";

const MONDAY_API = "https://api.monday.com/v2";

// Portfolio company boards are identified by emoji in their name (💗 = invested, 👩‍🚀 = supported).
// Operational boards (Sprints, Tâches, Capacity…) and sub-items boards are excluded.
const PORTFOLIO_EMOJI_RE = /[\u{1F300}-\u{1F9FF}]/u;

function isPortfolioBoard(name: string): boolean {
  return !name.startsWith("Sous-éléments") && PORTFOLIO_EMOJI_RE.test(name);
}

// Strip emoji and trailing whitespace to get the clean company name.
// This name is used as the cross-connector identifier (matched against HubSpot and Drive).
function toCompanyName(boardName: string): string {
  return boardName
    .replace(/[\u{1F300}-\u{1F9FF}\u{200D}\u{FE0F}]/gu, "")
    .trim();
}

type BoardRaw = {
  id: string;
  name: string;
  state: string;
  updated_at: string | null;
};

export const createUnconfiguredMondayConnector = (): MondayConnector => ({
  listPortfolio: () =>
    Promise.reject(ConnectorNotConfigured("monday", "listPortfolio")),
  listSignals: () =>
    Promise.reject(ConnectorNotConfigured("monday", "listSignals")),
  listUpcomingEvents: () =>
    Promise.reject(ConnectorNotConfigured("monday", "listUpcomingEvents")),
});

export const createHttpMondayConnector = (token: string): MondayConnector => {
  const client = createHttpClient({
    connector: "monday",
    baseUrl: MONDAY_API,
    defaultHeaders: {
      Authorization: token,
      "Content-Type": "application/json",
    },
    timeoutMs: 20_000,
    maxAttempts: 3,
  });

  const query = async <T>(gql: string): Promise<T> => {
    const json = await client.json<{ data?: T; errors?: { message: string }[] }>(
      "",
      { method: "POST", body: { query: gql } },
    );
    if (json.errors?.length) {
      throw ConnectorFailed(
        json.errors[0]?.message ?? "Monday API returned errors",
        { errors: json.errors },
      );
    }
    if (!json.data) throw ConnectorFailed("Monday API returned no data");
    return json.data;
  };

  const fetchAllBoards = async (): Promise<BoardRaw[]> => {
    const boards: BoardRaw[] = [];
    let page = 1;
    while (true) {
      const data = await query<{ boards: BoardRaw[] }>(
        `{ boards(limit: 50, page: ${page}, state: active) { id name state updated_at } }`,
      );
      const batch = data.boards;
      boards.push(...batch);
      if (batch.length < 50) break;
      page++;
    }
    return boards;
  };

  return {
    async listPortfolio(): Promise<PortfolioCompany[]> {
      try {
        const boards = await fetchAllBoards();
        return boards
          .filter((b) => isPortfolioBoard(b.name))
          .map((b): PortfolioCompany => ({
            // Use the clean company name as the cross-system ID so HubSpot and Drive
            // can resolve it by name without storing HubSpot IDs in Monday.
            id: toCompanyName(b.name),
            startupId: toCompanyName(b.name),
            // Monday boards don't carry investedAt; use last update as an approximation.
            investedAt: b.updated_at ?? new Date().toISOString(),
            ownershipPct: undefined,
            status: "active",
          }));
      } catch (err) {
        if (err instanceof CoreError) throw err;
        throw ConnectorFailed("monday.listPortfolio failed", { cause: String(err) });
      }
    },

    // Portfolio signals are not sourced from Monday today (no team ritual, no dedicated board).
    // Digest and briefs rely on Signal Hub + HubSpot; Monday is the portco directory only.
    async listSignals(_sinceDays: number): Promise<PortfolioSignal[]> {
      return [];
    },

    // No events board exists in the current Monday workspace.
    async listUpcomingEvents(): Promise<Event[]> {
      return [];
    },
  };
};
