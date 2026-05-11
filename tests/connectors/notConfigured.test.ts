import { describe, expect, it } from "vitest";
import { createUnconfiguredHubspotConnector } from "../../src/connectors/hubspot.js";
import { createUnconfiguredMondayConnector } from "../../src/connectors/monday.js";
import { createUnconfiguredDriveConnector } from "../../src/connectors/drive.js";
import { CoreError } from "../../src/errors/index.js";

const expectNotConfigured = async (promise: Promise<unknown>) => {
  await expect(promise).rejects.toMatchObject<Partial<CoreError>>({
    code: "CONNECTOR_NOT_CONFIGURED",
    status: 503,
  });
};

describe("unconfigured connectors", () => {
  describe("hubspot", () => {
    const hs = createUnconfiguredHubspotConnector();
    it("listStartups → 503", () => expectNotConfigured(hs.listStartups()));
    it("listNotesForStartup → 503", () => expectNotConfigured(hs.listNotesForStartup("x")));
    it("listDealsForStartup → 503", () => expectNotConfigured(hs.listDealsForStartup("x")));
    it("listMeetingsForStartup → 503", () => expectNotConfigured(hs.listMeetingsForStartup("x")));
  });

  describe("monday", () => {
    const mon = createUnconfiguredMondayConnector();
    it("listPortfolio → 503", () => expectNotConfigured(mon.listPortfolio()));
    it("listSignals → 503", () => expectNotConfigured(mon.listSignals(30)));
    it("listUpcomingEvents → 503", () => expectNotConfigured(mon.listUpcomingEvents()));
  });

  describe("drive", () => {
    const drv = createUnconfiguredDriveConnector();
    it("listBoardPacksForCompany → 503", () =>
      expectNotConfigured(drv.listBoardPacksForCompany("Aistos")));
    it("fetchDocumentText → 503", () => expectNotConfigured(drv.fetchDocumentText("file-id")));
  });
});
