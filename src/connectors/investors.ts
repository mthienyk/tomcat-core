import { ConnectorNotConfigured } from "../errors/index.js";
import type { InvestorsConnector } from "./types.js";

export const createUnconfiguredInvestorsConnector = (): InvestorsConnector => ({
  getInvestorById: async () =>
    Promise.reject(ConnectorNotConfigured("investors", "getInvestorById")),
});
