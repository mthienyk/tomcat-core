import { ConnectorFailed, ConnectorNotConfigured } from "../errors/index.js";
import type { HubspotConnector } from "./types.js";

export const createUnconfiguredHubspotConnector = (): HubspotConnector => ({
  listStartups: async () =>
    Promise.reject(ConnectorNotConfigured("hubspot", "listStartups")),
  listDealsForStartup: async () =>
    Promise.reject(ConnectorNotConfigured("hubspot", "listDealsForStartup")),
  listMeetingsForStartup: async () =>
    Promise.reject(ConnectorNotConfigured("hubspot", "listMeetingsForStartup")),
  listNotesForStartup: async () =>
    Promise.reject(ConnectorNotConfigured("hubspot", "listNotesForStartup")),
});

export const createHttpHubspotConnector = (_token: string): HubspotConnector => {
  const notImplemented = (op: string): never => {
    throw ConnectorFailed(
      `HubSpot connector "${op}" not yet implemented. Provide HUBSPOT_API_TOKEN and complete the HTTP client.`,
    );
  };
  return {
    listStartups: async () => notImplemented("listStartups"),
    listDealsForStartup: async () => notImplemented("listDealsForStartup"),
    listMeetingsForStartup: async () => notImplemented("listMeetingsForStartup"),
    listNotesForStartup: async () => notImplemented("listNotesForStartup"),
  };
};
