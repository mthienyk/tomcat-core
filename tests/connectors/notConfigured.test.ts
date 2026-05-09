import { describe, expect, it } from "vitest";
import { createUnconfiguredHubspotConnector } from "../../src/connectors/hubspot.js";
import { CoreError } from "../../src/errors/index.js";

describe("unconfigured connectors", () => {
  it("fails with an explicit 503 instead of returning fake data", async () => {
    await expect(
      createUnconfiguredHubspotConnector().listStartups(),
    ).rejects.toMatchObject<Partial<CoreError>>({
      code: "CONNECTOR_NOT_CONFIGURED",
      status: 503,
    });
  });
});
