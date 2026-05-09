import { ConnectorFailed, ConnectorNotConfigured } from "../errors/index.js";
import type { MondayConnector } from "./types.js";

export const createUnconfiguredMondayConnector = (): MondayConnector => ({
  listPortfolio: async () =>
    Promise.reject(ConnectorNotConfigured("monday", "listPortfolio")),
  listSignals: async () =>
    Promise.reject(ConnectorNotConfigured("monday", "listSignals")),
  listUpcomingEvents: async () =>
    Promise.reject(ConnectorNotConfigured("monday", "listUpcomingEvents")),
});

export const createHttpMondayConnector = (_token: string): MondayConnector => {
  const notImplemented = (op: string): never => {
    throw ConnectorFailed(
      `Monday connector "${op}" not yet implemented. Provide MONDAY_API_TOKEN and complete the GraphQL client.`,
    );
  };
  return {
    listPortfolio: async () => notImplemented("listPortfolio"),
    listSignals: async () => notImplemented("listSignals"),
    listUpcomingEvents: async () => notImplemented("listUpcomingEvents"),
  };
};
