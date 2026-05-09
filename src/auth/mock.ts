import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { AuthInvalid } from "../errors/index.js";
import type { Identity, InvestorTier, Role } from "../domain/identity.js";
import type { IdentityResolver } from "./types.js";

const MockHumanSchema = z.object({
  kind: z.literal("human"),
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
  investorId: z.string().optional(),
  investorTier: z.enum(["bronze", "silver", "gold", "platinum"]).optional(),
});

const MockServiceSchema = z.object({
  kind: z.literal("service"),
  clientId: z.string().min(1),
  scopes: z.array(z.string()).min(1),
  onBehalfOfEmail: z.string().email().optional(),
  onBehalfOfRole: z
    .enum([
      "admin",
      "internal_team",
      "finance",
      "investor_relations",
      "portfolio_ops",
      "external_investor",
    ])
    .optional(),
  onBehalfOfInvestorId: z.string().min(1).optional(),
});

const HEADER = "x-mock-identity";

export const createMockResolver = (): IdentityResolver => ({
  name: "mock",
  resolve: async (req: FastifyRequest): Promise<Identity | undefined> => {
    const raw = req.headers[HEADER];
    if (typeof raw !== "string" || !raw) return undefined;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw AuthInvalid("X-Mock-Identity is not valid JSON");
    }

    const human = MockHumanSchema.safeParse(parsed);
    if (human.success) {
      const role: Role = human.data.role;
      const tier: InvestorTier | undefined = human.data.investorTier;
      return {
        kind: "human",
        email: human.data.email,
        domain: human.data.email.split("@")[1] ?? "",
        role,
        team: undefined,
        investorId: human.data.investorId,
        investorTier: tier,
      };
    }

    const service = MockServiceSchema.safeParse(parsed);
    if (service.success) {
      const onBehalfOf =
        service.data.onBehalfOfEmail && service.data.onBehalfOfRole
          ? {
              kind: "human" as const,
              email: service.data.onBehalfOfEmail,
              domain: service.data.onBehalfOfEmail.split("@")[1] ?? "",
              role: service.data.onBehalfOfRole as Role,
              team: undefined,
              investorId: service.data.onBehalfOfInvestorId,
              investorTier: undefined,
            }
          : undefined;
      return {
        kind: "service",
        clientId: service.data.clientId,
        scopes: service.data.scopes,
        onBehalfOf,
      };
    }

    throw AuthInvalid("X-Mock-Identity does not match any identity schema");
  },
});
