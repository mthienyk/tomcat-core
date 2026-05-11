import { ConnectorFailed, ConnectorNotConfigured, CoreError } from "../errors/index.js";
import type {
  Deal,
  Meeting,
  Note,
  NoteSensitivity,
  Sector,
  Stage,
  Startup,
} from "../domain/entities.js";
import type { HubspotConnector } from "./types.js";

const HUBSPOT_BASE = "https://api.hubapi.com";

// Tomcat's "Verticales" custom field → domain Sector
const SECTOR_MAP: Partial<Record<string, Sector>> = {
  "Future of Work": "saas",
  "Impact / Tech for good": "climate",
  "PropTech": "marketplace",
  "Consumer Engagement": "consumer",
  "IT, Cyber & IA": "deeptech",
  "Future of Finance": "fintech",
  "Autres": "other",
};

// stade_d_intervention → domain Stage
const STAGE_MAP: Partial<Record<string, Stage>> = {
  Seed: "seed",
  "Série A": "series_a",
  "Série B": "series_b",
};

// HubSpot mixes startups and investors in the same company object type.
// The team plans to reorganize. Until then, filter by startup-relevant lifecycle stages
// and post-filter companies explicitly tagged as investors via type_d_entreprise.
const STARTUP_LIFECYCLE_STAGES = ["opportunity", "customer", "evangelist", "98121635"];
const INVESTOR_COMPANY_TYPES = new Set([
  "Investisseur Business Angel",
  "Investisseur VC / FO",
  "INVESTISSEUR",
]);

// HubSpot custom deal stage IDs (fetched from pipeline /crm/v3/pipelines/deals/default)
const WIN_STAGES = new Set(["98068834", "1056771923"]); // Win, TS Signée
const DILIGENCE_STAGES = new Set(["1301108408", "4339385", "2142183", "7837604", "1206453096", "2142185"]); // GO M1?, M1-M4, Closing
const LOST_STAGES = new Set(["closedlost", "145515299"]); // No Go, Lost
const PASSED_STAGES = new Set(["1040480305"]); // Refus M0

function mapDealStatus(stageId: string): Deal["status"] {
  if (WIN_STAGES.has(stageId)) return "invested";
  if (DILIGENCE_STAGES.has(stageId)) return "diligence";
  if (LOST_STAGES.has(stageId)) return "lost";
  if (PASSED_STAGES.has(stageId)) return "passed";
  return "screening";
}

function mapVisibilityTier(lifecycle: string | null | undefined): Startup["visibilityTier"] {
  if (lifecycle === "customer") return "gold";
  if (lifecycle === "opportunity") return "bronze";
  return "internal_only";
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function hasDelimitedIds(value: string | null | undefined): boolean {
  if (!value) return false;
  return value.split(";").some((part) => part.trim().length > 0);
}

function mapNoteSensitivity(properties: Record<string, string | null>): NoteSensitivity {
  if (hasDelimitedIds(properties.hs_shared_user_ids)) return "investor_visible";
  if (hasDelimitedIds(properties.hs_shared_team_ids)) return "investor_visible";
  return "internal";
}

function chunk<T>(arr: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
    arr.slice(i * size, (i + 1) * size),
  );
}

export const createUnconfiguredHubspotConnector = (): HubspotConnector => ({
  listStartups: () =>
    Promise.reject(ConnectorNotConfigured("hubspot", "listStartups")),
  listDealsForStartup: () =>
    Promise.reject(ConnectorNotConfigured("hubspot", "listDealsForStartup")),
  listMeetingsForStartup: () =>
    Promise.reject(ConnectorNotConfigured("hubspot", "listMeetingsForStartup")),
  listNotesForStartup: () =>
    Promise.reject(ConnectorNotConfigured("hubspot", "listNotesForStartup")),
});

export const createHttpHubspotConnector = (token: string): HubspotConnector => {
  const authHeader = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  const get = async (path: string, params: Record<string, string> = {}): Promise<unknown> => {
    const url = new URL(`${HUBSPOT_BASE}${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res = await fetch(url.toString(), { headers: authHeader });
    if (!res.ok) throw new Error(`HubSpot GET ${path} → HTTP ${res.status}`);
    return res.json();
  };

  const post = async (path: string, body: unknown): Promise<unknown> => {
    const res = await fetch(`${HUBSPOT_BASE}${path}`, {
      method: "POST",
      headers: authHeader,
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HubSpot POST ${path} → HTTP ${res.status}`);
    return res.json();
  };

  const paginateSearch = async <T>(path: string, body: Record<string, unknown>): Promise<T[]> => {
    const results: T[] = [];
    let after: string | undefined;
    do {
      const payload = after ? { ...body, after } : { ...body };
      const data = await post(path, payload) as { results?: T[]; paging?: { next?: { after?: string } } };
      results.push(...(data.results ?? []));
      after = data.paging?.next?.after;
    } while (after);
    return results;
  };

  // Owner ID → email, lazily populated once per connector instance.
  // Includes archived owners so that historical notes authored by former team members
  // resolve to a real email rather than falling back to "owner:<id>".
  let ownerCache: Map<string, string> | null = null;
  const resolveOwnerEmail = async (ownerId: string): Promise<string> => {
    if (!ownerCache) {
      const [active, archived] = await Promise.all([
        get("/crm/v3/owners") as Promise<{ results?: { id: string; email: string }[] }>,
        get("/crm/v3/owners?archived=true") as Promise<{ results?: { id: string; email: string }[] }>,
      ]);
      ownerCache = new Map([
        ...(active.results ?? []).map((o): [string, string] => [String(o.id), o.email]),
        ...(archived.results ?? []).map((o): [string, string] => [String(o.id), o.email]),
      ]);
    }
    return ownerCache.get(ownerId) ?? `owner:${ownerId}`;
  };

  // Accept numeric HubSpot ID or company name (cross-connector use from Monday)
  const resolveCompanyId = async (startupId: string): Promise<string> => {
    if (/^\d+$/.test(startupId)) return startupId;
    const data = await post("/crm/v3/objects/companies/search", {
      filterGroups: [{ filters: [{ propertyName: "name", operator: "EQ", value: startupId }] }],
      properties: ["name"],
      limit: 1,
    }) as { results?: { id: string }[] };
    const found = data.results?.[0];
    if (!found) throw ConnectorFailed(`HubSpot company not found: "${startupId}"`);
    return found.id;
  };

  const getAssociatedIds = async (
    fromType: string,
    fromId: string,
    toType: string,
  ): Promise<string[]> => {
    const data = await get(
      `/crm/v4/objects/${fromType}/${fromId}/associations/${toType}`,
    ) as { results?: { toObjectId: number | string }[] };
    return (data.results ?? []).map((a) => String(a.toObjectId));
  };

  return {
    async listStartups() {
      try {
        type HsCompany = {
          id: string;
          properties: Record<string, string | null>;
        };

        // Filter to startup-relevant lifecycle stages only.
        // Secondary post-filter removes companies explicitly tagged as investors.
        // This is a workaround for HubSpot mixing startups and investors — the team
        // plans to reorganize the CRM structure in a future iteration.
        const companies = await paginateSearch<HsCompany>(
          "/crm/v3/objects/companies/search",
          {
            filterGroups: [
              {
                filters: [
                  {
                    propertyName: "lifecyclestage",
                    operator: "IN",
                    values: STARTUP_LIFECYCLE_STAGES,
                  },
                ],
              },
            ],
            properties: [
              "name",
              "country",
              "description",
              "lifecyclestage",
              "stade_d_intervention",
              "type_d_industrie",
              "type_d_entreprise",
            ],
            limit: 100,
          },
        );

        return companies
          .filter((c) => !INVESTOR_COMPANY_TYPES.has(c.properties.type_d_entreprise ?? ""))
          .map((c): Startup => {
            const p = c.properties;
            const sector = SECTOR_MAP[p.type_d_industrie ?? ""] ?? "other";
            const country = p.country?.trim();
            const description = p.description?.trim();
            return {
              id: c.id,
              name: p.name ?? "",
              sectors: [sector],
              stage: STAGE_MAP[p.stade_d_intervention ?? ""] ?? "pre_seed",
              country: country || undefined,
              description: description || undefined,
              visibilityTier: mapVisibilityTier(p.lifecyclestage),
              sources: [{ system: "hubspot", externalId: c.id, url: undefined }],
            };
          });
      } catch (err) {
        if (err instanceof CoreError) throw err;
        throw ConnectorFailed("hubspot.listStartups failed", { cause: String(err) });
      }
    },

    async listNotesForStartup(startupId) {
      try {
        const companyId = await resolveCompanyId(startupId);
        const noteIds = await getAssociatedIds("companies", companyId, "notes");
        if (noteIds.length === 0) return [];

        const notes: Note[] = [];
        for (const batch of chunk(noteIds, 100)) {
          const data = await post("/crm/v3/objects/notes/batch/read", {
            properties: [
              "hs_note_body",
              "hs_timestamp",
              "hubspot_owner_id",
              "hs_shared_user_ids",
              "hs_shared_team_ids",
            ],
            inputs: batch.map((id) => ({ id })),
          }) as { results?: { id: string; properties: Record<string, string | null>; createdAt: string }[] };

          for (const n of data.results ?? []) {
            const authorEmail = await resolveOwnerEmail(n.properties.hubspot_owner_id ?? "");
            notes.push({
              id: n.id,
              startupId: companyId,
              authorEmail,
              body: stripHtml(n.properties.hs_note_body ?? ""),
              sensitivity: mapNoteSensitivity(n.properties),
              createdAt: n.properties.hs_timestamp ?? n.createdAt,
              source: { system: "hubspot", externalId: n.id, url: undefined },
            });
          }
        }
        return notes;
      } catch (err) {
        if (err instanceof CoreError) throw err;
        throw ConnectorFailed("hubspot.listNotesForStartup failed", { cause: String(err) });
      }
    },

    async listDealsForStartup(startupId) {
      try {
        const companyId = await resolveCompanyId(startupId);
        const dealIds = await getAssociatedIds("companies", companyId, "deals");
        if (dealIds.length === 0) return [];

        const deals: Deal[] = [];
        for (const batch of chunk(dealIds, 100)) {
          const data = await post("/crm/v3/objects/deals/batch/read", {
            properties: ["dealname", "dealstage", "amount", "closedate", "hubspot_owner_id", "hs_lastmodifieddate"],
            inputs: batch.map((id) => ({ id })),
          }) as { results?: { id: string; properties: Record<string, string | null>; updatedAt: string }[] };

          for (const d of data.results ?? []) {
            const ownerEmail = await resolveOwnerEmail(d.properties.hubspot_owner_id ?? "");
            const stageId = d.properties.dealstage ?? "";
            deals.push({
              id: d.id,
              startupId: companyId,
              ownerEmail,
              status: mapDealStatus(stageId),
              amountEur: d.properties.amount ? parseFloat(d.properties.amount) : undefined,
              updatedAt: d.properties.hs_lastmodifieddate ?? d.properties.closedate ?? d.updatedAt,
              visibilityTier: WIN_STAGES.has(stageId) ? "shared_with_investors" : "internal_only",
            });
          }
        }
        return deals;
      } catch (err) {
        if (err instanceof CoreError) throw err;
        throw ConnectorFailed("hubspot.listDealsForStartup failed", { cause: String(err) });
      }
    },

    async listMeetingsForStartup(startupId) {
      try {
        const companyId = await resolveCompanyId(startupId);
        const meetingIds = await getAssociatedIds("companies", companyId, "meetings");
        if (meetingIds.length === 0) return [];

        const meetings: Meeting[] = [];
        for (const batch of chunk(meetingIds, 100)) {
          const data = await post("/crm/v3/objects/meetings/batch/read", {
            properties: ["hs_meeting_title", "hs_meeting_start_time", "hs_attendee_owner_ids", "hubspot_owner_id"],
            inputs: batch.map((id) => ({ id })),
          }) as { results?: { id: string; properties: Record<string, string | null>; createdAt: string }[] };

          for (const m of data.results ?? []) {
            const attendeeIds = (m.properties.hs_attendee_owner_ids ?? "")
              .split(";")
              .filter(Boolean);
            const attendees = await Promise.all(attendeeIds.map(resolveOwnerEmail));
            meetings.push({
              id: m.id,
              startupId: companyId,
              subject: m.properties.hs_meeting_title ?? "Meeting",
              attendees,
              occurredAt: m.properties.hs_meeting_start_time ?? m.createdAt,
              source: { system: "hubspot", externalId: m.id, url: undefined },
            });
          }
        }
        return meetings;
      } catch (err) {
        if (err instanceof CoreError) throw err;
        throw ConnectorFailed("hubspot.listMeetingsForStartup failed", { cause: String(err) });
      }
    },
  };
};
