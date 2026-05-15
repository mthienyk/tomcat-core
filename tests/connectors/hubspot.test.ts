import { describe, expect, it, vi, beforeEach } from "vitest";
import { createHttpHubspotConnector } from "../../src/connectors/hubspot.js";
import { CoreError } from "../../src/errors/index.js";

// Minimal fetch mock factory
const makeFetch =
  (responses: Record<string, unknown>) =>
  (url: string, opts?: RequestInit): Promise<Response> => {
    const path = new URL(url).pathname;
    const method = opts?.method ?? "GET";
    const key = `${method} ${path}`;
    const body = responses[key] ?? responses[path];
    if (body === undefined) throw new Error(`Unmocked fetch: ${key}`);
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(body),
    } as Response);
  };

const OWNERS_RESPONSE = {
  results: [{ id: "100", email: "alice@tomcat.eu" }],
};

const COMPANY_RESPONSE = {
  results: [
    {
      id: "999",
      properties: {
        name: "Aistos",
        country: "",
        description: null,
        lifecyclestage: "customer",
        stade_d_intervention: "Seed",
        type_d_industrie: "IT, Cyber & IA",
      },
    },
  ],
  paging: undefined,
};

describe("createHttpHubspotConnector", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  describe("listStartups", () => {
    it("maps company fields to Startup domain type", async () => {
      vi.stubGlobal(
        "fetch",
        makeFetch({
          // listStartups now uses the search API (POST) to filter by lifecycle stage
          "POST /crm/v3/objects/companies/search": COMPANY_RESPONSE,
        }),
      );
      const hs = createHttpHubspotConnector("fake-token");
      const startups = await hs.listStartups();

      expect(startups).toHaveLength(1);
      expect(startups[0]).toMatchObject({
        id: "999",
        name: "Aistos",
        sectors: ["deeptech"],
        stage: "seed",
        visibilityTier: "gold",
      });
      expect(startups[0]?.country).toBeUndefined();
    });

    it("excludes companies tagged as investors via type_d_entreprise", async () => {
      vi.stubGlobal(
        "fetch",
        makeFetch({
          "POST /crm/v3/objects/companies/search": {
            results: [
              { ...COMPANY_RESPONSE.results[0] },
              {
                id: "888",
                properties: {
                  name: "Some VC Fund",
                  country: null,
                  description: null,
                  lifecyclestage: "customer",
                  stade_d_intervention: null,
                  type_d_industrie: null,
                  type_d_entreprise: "Investisseur VC / FO",
                },
              },
            ],
          },
        }),
      );
      const hs = createHttpHubspotConnector("fake-token");
      const startups = await hs.listStartups();
      expect(startups).toHaveLength(1);
      expect(startups[0].name).toBe("Aistos");
    });

    it("maps unknown industry to 'other'", async () => {
      vi.stubGlobal(
        "fetch",
        makeFetch({
          "POST /crm/v3/objects/companies/search": {
            results: [
              {
                id: "1",
                properties: {
                  name: "X",
                  country: null,
                  description: null,
                  lifecyclestage: "opportunity",
                  stade_d_intervention: null,
                  type_d_industrie: "Some Unknown Vertical",
                  type_d_entreprise: null,
                },
              },
            ],
          },
        }),
      );
      const hs = createHttpHubspotConnector("fake-token");
      const [startup] = await hs.listStartups();
      expect(startup.sectors).toEqual(["other"]);
      expect(startup.stage).toBe("unknown");
      expect(startup.visibilityTier).toBe("bronze");
    });

    it("wraps HTTP errors as ConnectorFailed (502)", async () => {
      vi.stubGlobal("fetch", () =>
        Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({}) } as Response),
      );
      const hs = createHttpHubspotConnector("bad-token");
      await expect(hs.listStartups()).rejects.toMatchObject<Partial<CoreError>>({
        code: "CONNECTOR_FAILED",
        status: 502,
      });
    });
  });

  describe("listNotesForStartup", () => {
    it("returns empty array when no associations exist", async () => {
      vi.stubGlobal(
        "fetch",
        makeFetch({
          "GET /crm/v4/objects/companies/42/associations/notes": { results: [] },
        }),
      );
      const hs = createHttpHubspotConnector("fake-token");
      const notes = await hs.listNotesForStartup("42");
      expect(notes).toEqual([]);
    });

    it("fetches and maps notes with HTML body stripped", async () => {
      vi.stubGlobal(
        "fetch",
        makeFetch({
          "GET /crm/v4/objects/companies/42/associations/notes": {
            results: [{ toObjectId: 1001 }],
          },
          "POST /crm/v3/objects/notes/batch/read": {
            results: [
              {
                id: "1001",
                properties: {
                  hs_note_body: "<p>Hello <b>World</b></p>",
                  hs_timestamp: "2025-01-01T10:00:00Z",
                  hubspot_owner_id: "100",
                  hs_shared_user_ids: null,
                  hs_shared_team_ids: null,
                },
                createdAt: "2025-01-01T10:00:00Z",
              },
            ],
          },
          "GET /crm/v3/owners": OWNERS_RESPONSE,
        }),
      );
      const hs = createHttpHubspotConnector("fake-token");
      const notes = await hs.listNotesForStartup("42");

      expect(notes).toHaveLength(1);
      expect(notes[0].body).toBe("Hello World");
      expect(notes[0].authorEmail).toBe("alice@tomcat.eu");
      expect(notes[0].sensitivity).toBe("internal");
      expect(notes[0].source.system).toBe("hubspot");
    });

    it("maps shared notes to investor_visible sensitivity", async () => {
      vi.stubGlobal(
        "fetch",
        makeFetch({
          "GET /crm/v4/objects/companies/42/associations/notes": {
            results: [{ toObjectId: 1002 }],
          },
          "POST /crm/v3/objects/notes/batch/read": {
            results: [
              {
                id: "1002",
                properties: {
                  hs_note_body: "<p>Shared update</p>",
                  hs_timestamp: "2025-02-01T10:00:00Z",
                  hubspot_owner_id: "100",
                  hs_shared_user_ids: "200;201",
                  hs_shared_team_ids: null,
                },
                createdAt: "2025-02-01T10:00:00Z",
              },
            ],
          },
          "GET /crm/v3/owners": OWNERS_RESPONSE,
        }),
      );
      const hs = createHttpHubspotConnector("fake-token");
      const notes = await hs.listNotesForStartup("42");
      expect(notes[0]?.sensitivity).toBe("investor_visible");
    });

    it("resolves company by name when startupId is not numeric", async () => {
      vi.stubGlobal(
        "fetch",
        makeFetch({
          "POST /crm/v3/objects/companies/search": {
            results: [{ id: "42" }],
          },
          "GET /crm/v4/objects/companies/42/associations/notes": { results: [] },
        }),
      );
      const hs = createHttpHubspotConnector("fake-token");
      const notes = await hs.listNotesForStartup("Aistos");
      expect(notes).toEqual([]);
    });
  });

  describe("listDealsForStartup", () => {
    it("maps Win stage to 'invested' and sets visibilityTier", async () => {
      vi.stubGlobal(
        "fetch",
        makeFetch({
          "GET /crm/v4/objects/companies/42/associations/deals": {
            results: [{ toObjectId: 200 }],
          },
          "POST /crm/v3/objects/deals/batch/read": {
            results: [
              {
                id: "200",
                properties: {
                  dealname: "Aistos - APOLLO",
                  dealstage: "98068834",
                  amount: "50000",
                  closedate: "2024-01-10T00:00:00Z",
                  hubspot_owner_id: "100",
                  hs_lastmodifieddate: "2025-01-10T00:00:00Z",
                },
                updatedAt: "2025-01-10T00:00:00Z",
              },
            ],
          },
          "GET /crm/v3/owners": OWNERS_RESPONSE,
        }),
      );
      const hs = createHttpHubspotConnector("fake-token");
      const deals = await hs.listDealsForStartup("42");

      expect(deals).toHaveLength(1);
      expect(deals[0].status).toBe("invested");
      expect(deals[0].amountEur).toBe(50000);
      expect(deals[0].visibilityTier).toBe("shared_with_investors");
      expect(deals[0].ownerEmail).toBe("alice@tomcat.eu");
    });

    it("maps closedlost to 'lost'", async () => {
      vi.stubGlobal(
        "fetch",
        makeFetch({
          "GET /crm/v4/objects/companies/42/associations/deals": {
            results: [{ toObjectId: 201 }],
          },
          "POST /crm/v3/objects/deals/batch/read": {
            results: [
              {
                id: "201",
                properties: {
                  dealname: "X - No Go",
                  dealstage: "closedlost",
                  amount: null,
                  closedate: "2024-06-01T00:00:00Z",
                  hubspot_owner_id: "100",
                  hs_lastmodifieddate: null,
                },
                updatedAt: "2024-06-01T00:00:00Z",
              },
            ],
          },
          "GET /crm/v3/owners": OWNERS_RESPONSE,
        }),
      );
      const hs = createHttpHubspotConnector("fake-token");
      const deals = await hs.listDealsForStartup("42");
      expect(deals[0].status).toBe("lost");
      expect(deals[0].visibilityTier).toBe("internal_only");
    });
  });

  describe("listMeetingsForStartup", () => {
    it("maps meeting fields and resolves attendee emails", async () => {
      vi.stubGlobal(
        "fetch",
        makeFetch({
          "GET /crm/v4/objects/companies/42/associations/meetings": {
            results: [{ toObjectId: 300 }],
          },
          "POST /crm/v3/objects/meetings/batch/read": {
            results: [
              {
                id: "300",
                properties: {
                  hs_meeting_title: "Kick-off Aistos",
                  hs_meeting_start_time: "2025-03-01T09:00:00Z",
                  hs_attendee_owner_ids: "100",
                  hubspot_owner_id: "100",
                },
                createdAt: "2025-03-01T09:00:00Z",
              },
            ],
          },
          "GET /crm/v3/owners": OWNERS_RESPONSE,
        }),
      );
      const hs = createHttpHubspotConnector("fake-token");
      const meetings = await hs.listMeetingsForStartup("42");

      expect(meetings).toHaveLength(1);
      expect(meetings[0].subject).toBe("Kick-off Aistos");
      expect(meetings[0].attendees).toEqual(["alice@tomcat.eu"]);
      expect(meetings[0].source.system).toBe("hubspot");
    });
  });
});
