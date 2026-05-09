import type { AppConfig } from "../config/env.js";
import {
  createHttpHubspotConnector,
  createUnconfiguredHubspotConnector,
} from "./hubspot.js";
import {
  createHttpDriveConnector,
  createUnconfiguredDriveConnector,
} from "./drive.js";
import {
  createHttpMondayConnector,
  createUnconfiguredMondayConnector,
} from "./monday.js";
import { createUnconfiguredInvestorsConnector } from "./investors.js";
import type {
  DriveConnector,
  HubspotConnector,
  InvestorsConnector,
  MondayConnector,
} from "./types.js";

export type Connectors = {
  hubspot: HubspotConnector;
  drive: DriveConnector;
  monday: MondayConnector;
  investors: InvestorsConnector;
};

export const buildConnectors = (config: AppConfig): Connectors => ({
  hubspot: config.connectors.hubspotToken
    ? createHttpHubspotConnector(config.connectors.hubspotToken)
    : createUnconfiguredHubspotConnector(),
  drive: config.connectors.driveServiceAccountJson
    ? createHttpDriveConnector(config.connectors.driveServiceAccountJson)
    : createUnconfiguredDriveConnector(),
  monday: config.connectors.mondayToken
    ? createHttpMondayConnector(config.connectors.mondayToken)
    : createUnconfiguredMondayConnector(),
  investors: createUnconfiguredInvestorsConnector(),
});
