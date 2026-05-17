import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AuthRequired, BadRequest } from "../../errors/index.js";
import type { SignalHubService } from "../../services/signalHub/index.js";
import type { AuthMiddleware } from "../middlewareTypes.js";

const AddWatchedBody = z.object({
  displayName: z.string().min(1),
  linkedinUrl: z.string().url().optional(),
  linkedinIdentifier: z.string().min(1).optional(),
  startupId: z.string().min(1).optional(),
  kind: z.enum(["person", "company"]).optional(),
  priority: z.enum(["hot", "warm", "cold"]).optional(),
});

const SetPriorityBody = z.object({
  priority: z.enum(["hot", "warm", "cold"]),
});

const RefreshBody = z.object({
  watchedId: z.string().min(1),
  source: z.enum(["serper_public", "unipile"]).optional(),
  unipileAccountId: z.string().min(1).optional(),
});

const FreezeBody = z.object({
  reason: z.string().min(1),
  durationHours: z.number().int().positive().max(168).optional(),
});

const KillBody = z.object({
  reason: z.string().min(1),
});

const parse = <T>(schema: z.ZodType<T>, body: unknown, context: string): T => {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw BadRequest(`Invalid body for ${context}`, { issues: result.error.issues });
  }
  return result.data;
};

export const registerSignalRoutes = (
  app: FastifyInstance,
  auth: AuthMiddleware,
  signalHub: SignalHubService,
): void => {
  // --- Watchlist ---

  app.get(
    "/signals/watched",
    { preHandler: auth.requirePermission("society.read") },
    async (req) => {
      if (!req.identity) throw AuthRequired();
      const priority = (req.query as { priority?: string }).priority as
        | "hot"
        | "warm"
        | "cold"
        | undefined;
      return signalHub.listWatched(req.identity, priority);
    },
  );

  app.post(
    "/signals/watched",
    { preHandler: auth.requirePermission("briefs.write") },
    async (req) => {
      if (!req.identity) throw AuthRequired();
      const body = parse(AddWatchedBody, req.body, "POST /signals/watched");
      return signalHub.addWatched(req.identity, {
        displayName: body.displayName,
        ...(body.linkedinUrl !== undefined ? { linkedinUrl: body.linkedinUrl } : {}),
        ...(body.linkedinIdentifier !== undefined ? { linkedinIdentifier: body.linkedinIdentifier } : {}),
        ...(body.startupId !== undefined ? { startupId: body.startupId } : {}),
        ...(body.kind !== undefined ? { kind: body.kind } : {}),
        ...(body.priority !== undefined ? { priority: body.priority } : {}),
      });
    },
  );

  app.put(
    "/signals/watched/:watchedId/priority",
    { preHandler: auth.requirePermission("briefs.write") },
    async (req) => {
      if (!req.identity) throw AuthRequired();
      const { watchedId } = req.params as { watchedId: string };
      const body = parse(SetPriorityBody, req.body, "PUT /signals/watched/:id/priority");
      await signalHub.setPriority(req.identity, watchedId, body.priority);
      return { updated: true };
    },
  );

  // --- Signals ---

  app.get(
    "/signals/recent",
    { preHandler: auth.requirePermission("society.read") },
    async (req) => {
      if (!req.identity) throw AuthRequired();
      const q = req.query as Record<string, string>;
      const filter: Parameters<typeof signalHub.listEvents>[1] = {
        limit: q["limit"] ? Math.min(Number(q["limit"]), 200) : 50,
      };
      if (q["watchedId"]) filter.watchedId = q["watchedId"];
      if (q["startupId"]) filter.startupId = q["startupId"];
      if (q["source"]) filter.source = q["source"];
      if (q["signalType"]) filter.signalType = q["signalType"];
      if (q["sinceIso"]) filter.sinceIso = q["sinceIso"];
      if (q["textContains"]) filter.textContains = q["textContains"];
      return signalHub.listEvents(req.identity, filter);
    },
  );

  // --- Entity resolution ---

  app.get(
    "/signals/resolve",
    { preHandler: auth.requirePermission("society.read") },
    async (req) => {
      if (!req.identity) throw AuthRequired();
      const q = req.query as { query?: string };
      if (!q.query) throw BadRequest("query param required");
      return signalHub.resolveEntity(req.identity, q.query);
    },
  );

  // --- Refresh (async) ---

  app.post(
    "/signals/refresh",
    { preHandler: auth.requirePermission("briefs.write") },
    async (req) => {
      if (!req.identity) throw AuthRequired();
      const body = parse(RefreshBody, req.body, "POST /signals/refresh");
      return signalHub.requestRefresh(req.identity, {
        watchedId: body.watchedId,
        ...(body.source !== undefined ? { source: body.source } : {}),
        ...(body.unipileAccountId !== undefined ? { unipileAccountId: body.unipileAccountId } : {}),
      });
    },
  );

  // --- Unipile account management (internal_team only) ---

  app.get(
    "/signals/unipile/accounts",
    { preHandler: auth.requirePermission("briefs.write") },
    async (req) => {
      if (!req.identity) throw AuthRequired();
      return signalHub.listUnipileAccounts(req.identity);
    },
  );

  app.post(
    "/signals/unipile/accounts/:accountId/freeze",
    { preHandler: auth.requirePermission("briefs.write") },
    async (req) => {
      if (!req.identity) throw AuthRequired();
      const { accountId } = req.params as { accountId: string };
      const body = parse(FreezeBody, req.body, "POST /signals/unipile/accounts/:id/freeze");
      const durationMs = body.durationHours
        ? body.durationHours * 3_600_000
        : undefined;
      await signalHub.freezeUnipileAccount(req.identity, accountId, body.reason, durationMs);
      return { frozen: true, accountId };
    },
  );

  app.post(
    "/signals/unipile/accounts/:accountId/unfreeze",
    { preHandler: auth.requirePermission("briefs.write") },
    async (req) => {
      if (!req.identity) throw AuthRequired();
      const { accountId } = req.params as { accountId: string };
      await signalHub.unfreezeUnipileAccount(req.identity, accountId);
      return { unfrozen: true, accountId };
    },
  );

  app.post(
    "/signals/unipile/accounts/:accountId/kill",
    { preHandler: auth.requirePermission("briefs.write") },
    async (req) => {
      if (!req.identity) throw AuthRequired();
      const { accountId } = req.params as { accountId: string };
      const body = parse(KillBody, req.body, "POST /signals/unipile/accounts/:id/kill");
      await signalHub.killUnipileAccount(req.identity, accountId, body.reason);
      return { killed: true, accountId };
    },
  );
};
