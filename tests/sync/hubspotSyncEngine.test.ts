import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  computeNotesFingerprint,
  syncHubspotCompanyActivity,
} from "../../src/sync/hubspotActivitySync.js";
import type { Note } from "../../src/domain/entities.js";
import {
  extractCompanyIdsFromWebhookEvents,
  normalizeHubspotRequestUri,
  verifyHubspotWebhook,
  verifyHubspotWebhookV1,
  verifyHubspotWebhookV3,
} from "../../src/sync/verifyHubspotWebhook.js";

const sampleNotes: Note[] = [
  {
    id: "n1",
    startupId: "1",
    authorEmail: "a@tomcat.eu",
    body: "M2 strong team",
    sensitivity: "internal",
    createdAt: "2026-01-01T00:00:00.000Z",
    source: { system: "hubspot", externalId: "n1" },
  },
];

describe("computeNotesFingerprint", () => {
  it("is stable for the same note set", () => {
    expect(computeNotesFingerprint(sampleNotes)).toBe(
      computeNotesFingerprint([...sampleNotes].reverse()),
    );
  });
});

describe("verifyHubspotWebhookV1", () => {
  it("accepts private-app v1 signatures", () => {
    const secret = "client-secret-uuid";
    const rawBody = '[{"objectId":123,"subscriptionType":"company.propertyChange"}]';
    const signature = createHash("sha256")
      .update(`${secret}${rawBody}`, "utf8")
      .digest("hex");

    expect(
      verifyHubspotWebhookV1({ clientSecret: secret, rawBody, signature }),
    ).toBe(true);
  });
});

describe("verifyHubspotWebhookV3", () => {
  const secret = "test-client-secret";
  const method = "POST";
  const requestUri = "/webhooks/hubspot";
  const rawBody = '[{"objectId":123,"subscriptionType":"company.propertyChange"}]';
  const timestamp = "1710000000000";
  const nowMs = 1710000001000;

  const sign = (): string => {
    const source = `${method}${requestUri}${rawBody}${timestamp}`;
    return createHmac("sha256", secret).update(source, "utf8").digest("base64");
  };

  it("accepts a valid v3 signature", () => {
    const result = verifyHubspotWebhookV3({
      clientSecret: secret,
      method,
      requestUri,
      rawBody,
      signatureV3: sign(),
      timestampHeader: timestamp,
      nowMs,
    });
    expect(result).toEqual({ ok: true, version: "v3" });
  });
});

describe("verifyHubspotWebhook", () => {
  it("prefers v1 when private app sends only X-HubSpot-Signature", () => {
    const secret = "client-secret-uuid";
    const rawBody = '[{"objectId":123,"subscriptionType":"company.propertyChange"}]';
    const signature = createHash("sha256")
      .update(`${secret}${rawBody}`, "utf8")
      .digest("hex");

    const result = verifyHubspotWebhook({
      clientSecret: secret,
      method: "POST",
      requestUri: "/webhooks/hubspot",
      rawBody,
      signatureV1: signature,
      signatureVersion: "v1",
    });

    expect(result).toEqual({ ok: true, version: "v1" });
  });
});

describe("extractCompanyIdsFromWebhookEvents", () => {
  it("collects company object ids", () => {
    const ids = extractCompanyIdsFromWebhookEvents([
      { objectId: 42, subscriptionType: "company.propertyChange" },
      { objectId: 99, subscriptionType: "contact.creation" },
    ]);
    expect(ids).toEqual(["42"]);
  });
});

describe("normalizeHubspotRequestUri", () => {
  it("decodes query string components", () => {
    expect(normalizeHubspotRequestUri("/webhooks/hubspot?x=hello%20world")).toBe(
      "/webhooks/hubspot?x=hello world",
    );
  });
});

describe("syncHubspotCompanyActivity", () => {
  it("upserts activity and company sync state", async () => {
    const store = {
      getStartupById: async () => undefined,
      insertStartupIfAbsent: async () => true,
      getHubspotCompanySyncState: async () => undefined,
      upsertDeal: async () => undefined,
      upsertNote: async () => undefined,
      upsertMeeting: async () => undefined,
      upsertHubspotCompanySyncState: async () => undefined,
    };
    const connectors = {
      hubspot: {
        getStartupById: async () => ({
          id: "42",
          name: "Acme",
          sectors: ["saas"],
          stage: "unknown",
          country: undefined,
          description: undefined,
          visibilityTier: "internal_only",
          sources: [{ system: "hubspot", externalId: "42" }],
        }),
        listDealsForStartup: async () => [],
        listNotesForStartup: async () => sampleNotes,
        listMeetingsForStartup: async () => [],
      },
    };

    const result = await syncHubspotCompanyActivity({
      store: store as never,
      connectors: connectors as never,
      companyId: "42",
    });

    expect(result.notes).toBe(1);
    expect(result.notesFingerprint).toHaveLength(64);
    expect(result.startupEnsure).toBe("created");
    expect(result.skipped).toBeUndefined();
  });

  it("skips HubSpot fetch when reconcile watermark is unchanged", async () => {
    const store = {
      getStartupById: async () => ({
        id: "42",
        name: "Acme",
        sectors: ["saas"],
        stage: "unknown",
        country: undefined,
        description: undefined,
        visibilityTier: "internal_only",
        sources: [{ system: "hubspot", externalId: "42" }],
      }),
      insertStartupIfAbsent: async () => false,
      getHubspotCompanySyncState: async () => ({
        companyId: "42",
        lastActivitySyncAt: "2026-01-01T00:00:00.000Z",
        lastHubspotModifiedAt: "2026-01-02T00:00:00.000Z",
        notesCount: 3,
        dealsCount: 1,
        meetingsCount: 0,
        notesFingerprint: "abc",
        updatedAt: "2026-01-02T00:00:00.000Z",
      }),
      upsertDeal: async () => undefined,
      upsertNote: async () => undefined,
      upsertMeeting: async () => undefined,
      upsertHubspotCompanySyncState: async () => undefined,
    };
    const connectors = {
      hubspot: {
        getStartupById: async () => undefined,
        listDealsForStartup: async () => {
          throw new Error("should not fetch");
        },
        listNotesForStartup: async () => {
          throw new Error("should not fetch");
        },
        listMeetingsForStartup: async () => {
          throw new Error("should not fetch");
        },
      },
    };

    const result = await syncHubspotCompanyActivity({
      store: store as never,
      connectors: connectors as never,
      companyId: "42",
      hubspotModifiedAt: "2026-01-02T00:00:00.000Z",
    });

    expect(result.skipped).toBe(true);
    expect(result.notes).toBe(3);
  });
});
