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

export const buildConnectors = (config: AppConfig): Connectors => {
  const driveJson = config.connectors.driveServiceAccountJson?.trim();
  const driveFile = config.connectors.driveServiceAccountFile?.trim();
  const driveCredentialsSource =
    (driveJson && driveJson.length > 0 ? driveJson : undefined) ??
    (driveFile && driveFile.length > 0 ? driveFile : undefined);

  return {
    hubspot: config.connectors.hubspotToken
      ? createHttpHubspotConnector(config.connectors.hubspotToken)
      : createUnconfiguredHubspotConnector(),
    drive: driveCredentialsSource
      ? createHttpDriveConnector(driveCredentialsSource, config.connectors.driveSharedDriveId)
      : createUnconfiguredDriveConnector(),
    monday: config.connectors.mondayToken
      ? createHttpMondayConnector(config.connectors.mondayToken)
      : createUnconfiguredMondayConnector(),
    investors: createUnconfiguredInvestorsConnector(),
  };
};
