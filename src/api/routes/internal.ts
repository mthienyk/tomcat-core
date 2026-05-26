import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AuthRequired, BadRequest } from "../../errors/index.js";
import type { BoardBriefService } from "../../services/boardBrief.js";
import type { CoreStore } from "../../storage/coreStore.js";
import type { AuthMiddleware } from "../middlewareTypes.js";
import type { McpOAuthService } from "../../auth/mcpOauth/service.js";
import { normalizeEmail } from "../../auth/email.js";

const BoardPrepBody = z.object({ portfolioCompanyId: z.string().min(1) });

const InvestorBody = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  email: z.string().email().nullish().transform((v) => v ?? undefined),
  tier: z.string().min(1),
  sectorsOfInterest: z.array(z.string()).default([]),
  portfolioCompanyIds: z.array(z.string()).default([]),
});

const UserBody = z.object({
  email: z.string().email(),
  role: z.enum([
    "admin",
    "internal_team",
    "finance",
    "investor_relations",
    "portfolio_ops",
    "external_investor",
    "service_client",
  ]),
  team: z.string().optional(),
  active: z.boolean().default(true),
});

const SocietyMemberBody = z.object({
  memberId: z.string().min(1),
  email: z.string().email(),
  kind: z.enum(["society_member", "founder"]),
  tier: z.string().min(1),
  investorId: z.string().min(1).nullish().transform((v) => v ?? undefined),
  active: z.boolean().default(true),
});

export const registerInternalRoutes = (
  app: FastifyInstance,
  auth: AuthMiddleware,
  boardBrief: BoardBriefService,
): void => {
  app.post(
    "/internal/briefs/board-prep",
    { preHandler: auth.requirePermission("briefs.write") },
    async (req) => {
      if (!req.identity) throw AuthRequired();
      const parsed = BoardPrepBody.safeParse(req.body);
      if (!parsed.success) {
        throw BadRequest("Invalid body", { issues: parsed.error.issues });
      }
      return boardBrief.legacyBoardPrepBody(
        req.identity,
        parsed.data.portfolioCompanyId,
      );
    },
  );
};

export const registerAdminRoutes = (
  app: FastifyInstance,
  auth: AuthMiddleware,
  store: CoreStore,
  mcpOauth?: McpOAuthService,
): void => {
  app.get(
    "/internal/investors",
    { preHandler: auth.requirePermission("internal.read") },
    async (req) => {
      if (!req.identity) throw AuthRequired();
      return store.listInvestors();
    },
  );

  app.post(
    "/internal/investors",
    { preHandler: auth.requirePermission("admin.write") },
    async (req) => {
      if (!req.identity) throw AuthRequired();
      const parsed = InvestorBody.safeParse(req.body);
      if (!parsed.success) {
        throw BadRequest("Invalid investor body", { issues: parsed.error.issues });
      }
      const investor: import("../../domain/entities.js").Investor = {
        ...parsed.data,
        email: parsed.data.email,
        sectorsOfInterest: parsed.data.sectorsOfInterest as import("../../domain/entities.js").Sector[],
      };
      await store.upsertInvestor(investor);
      return store.getInvestorById(parsed.data.id);
    },
  );

  app.get(
    "/internal/users",
    { preHandler: auth.requirePermission("internal.read") },
    async (req) => {
      if (!req.identity) throw AuthRequired();
      return store.listUsers();
    },
  );

  app.post(
    "/internal/users",
    { preHandler: auth.requirePermission("admin.write") },
    async (req) => {
      if (!req.identity) throw AuthRequired();
      const parsed = UserBody.safeParse(req.body);
      if (!parsed.success) {
        throw BadRequest("Invalid user body", { issues: parsed.error.issues });
      }
      const user = {
        email: normalizeEmail(parsed.data.email),
        role: parsed.data.role as import("../../domain/identity.js").Role,
        team: parsed.data.team,
        active: parsed.data.active,
      };
      await store.upsertUser(user);
      if (!user.active) {
        await mcpOauth?.revokeAllSessionsForEmail(user.email);
      }
      return store.getUserByEmail(parsed.data.email);
    },
  );

  app.get(
    "/internal/sync/freshness",
    { preHandler: auth.requirePermission("internal.read") },
    async (req) => {
      if (!req.identity) throw AuthRequired();
      return store.listFreshness();
    },
  );

  app.get(
    "/internal/sync/queue/hubspot.activity",
    { preHandler: auth.requirePermission("internal.read") },
    async (req) => {
      if (!req.identity) throw AuthRequired();
      return store.getSyncQueueStats("hubspot.activity");
    },
  );

  app.get(
    "/internal/society-members",
    { preHandler: auth.requirePermission("internal.read") },
    async (req) => {
      if (!req.identity) throw AuthRequired();
      return store.listSocietyMembers();
    },
  );

  app.post(
    "/internal/society-members",
    { preHandler: auth.requirePermission("admin.write") },
    async (req) => {
      if (!req.identity) throw AuthRequired();
      const parsed = SocietyMemberBody.safeParse(req.body);
      if (!parsed.success) {
        throw BadRequest("Invalid society member body", {
          issues: parsed.error.issues,
        });
      }
      const member: import("../../domain/society.js").SocietyMember = {
        memberId: parsed.data.memberId,
        email: parsed.data.email,
        kind: parsed.data.kind,
        tier: parsed.data.tier,
        investorId: parsed.data.investorId,
        active: parsed.data.active,
      };
      await store.upsertSocietyMember(member);
      return store.getSocietyMemberByEmail(parsed.data.email);
    },
  );
};
