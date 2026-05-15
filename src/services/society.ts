import { Forbidden, NotFound } from "../errors/index.js";
import type { Identity } from "../domain/identity.js";
import type {
  Event,
  Investor,
  PortfolioSignal,
  Startup,
} from "../domain/entities.js";
import {
  canSeeEvent,
  canSeeSignalForInvestor,
  canSeeStartup,
} from "../permissions/policies.js";
import { redactStartup } from "../permissions/redact.js";
import type { Connectors } from "../connectors/registry.js";

export type SocietyHome = {
  investor: { id: string; name: string; tier: string };
  visibleStartups: Startup[];
  upcomingEvents: Event[];
  recentSignals: PortfolioSignal[];
};

export const buildSocietyService = (deps: { connectors: Connectors }) => {
  const { connectors } = deps;

  const findInvestor = async (id: string): Promise<Investor> => {
    const investor = await connectors.investors.getInvestorById(id);
    if (!investor) throw NotFound(`Investor ${id} not found`);
    return investor;
  };

  const guardInvestorAccess = (caller: Identity, investorId: string): void => {
    if (caller.kind === "human" && caller.role === "external_investor") {
      if (caller.investorId !== investorId) {
        throw Forbidden("Investor can only access its own scope");
      }
    }
    if (caller.kind === "service") {
      const delegated = caller.onBehalfOf;
      if (!delegated) {
        throw Forbidden(
          "Service caller must include delegated investor identity for Society",
        );
      }
      if (delegated.role !== "external_investor" || !delegated.investorId) {
        throw Forbidden(
          "Delegated identity must be an external investor with investorId",
        );
      }
      if (delegated.investorId !== investorId) {
        throw Forbidden("Investor can only access its own scope");
      }
    }
  };

  const portfolioScopeForCaller = async (
    caller: Identity,
    requestedPortfolioCompanyId: string,
  ): Promise<ReadonlySet<string>> => {
    if (caller.kind === "human") {
      if (caller.role !== "external_investor") {
        return new Set([requestedPortfolioCompanyId]);
      }
      if (!caller.investorId) {
        throw Forbidden("External investor identity must include investorId");
      }
      const investor = await findInvestor(caller.investorId);
      return new Set(investor.portfolioCompanyIds);
    }

    const delegated = caller.onBehalfOf;
    if (
      !delegated ||
      delegated.role !== "external_investor" ||
      !delegated.investorId
    ) {
      throw Forbidden(
        "Service caller must include delegated investor identity for Society",
      );
    }
    const investor = await findInvestor(delegated.investorId);
    return new Set(investor.portfolioCompanyIds);
  };

  return {
    getInvestorHome: async (
      caller: Identity,
      investorId: string,
    ): Promise<SocietyHome> => {
      guardInvestorAccess(caller, investorId);
      const investor = await findInvestor(investorId);

      const [allStartups, events, signals] = await Promise.all([
        connectors.hubspot.listStartups(),
        connectors.monday.listUpcomingEvents(),
        connectors.monday.listSignals(30),
      ]);

      const portfolioSet = new Set(investor.portfolioCompanyIds);

      const visibleStartups = allStartups
        .filter((s) => canSeeStartup(caller, s))
        .map((s) => redactStartup(caller, s));

      const upcomingEvents = events.filter((e) =>
        canSeeEvent(caller, e, investorId),
      );

      const recentSignals = signals.filter((s) =>
        canSeeSignalForInvestor(caller, s, portfolioSet),
      );

      return {
        investor: { id: investor.id, name: investor.name, tier: investor.tier },
        visibleStartups,
        upcomingEvents,
        recentSignals,
      };
    },

    getPortfolioSignals: async (
      caller: Identity,
      portfolioCompanyId: string,
      sinceDays: number,
    ): Promise<PortfolioSignal[]> => {
      const portfolioSet = await portfolioScopeForCaller(caller, portfolioCompanyId);
      if (!portfolioSet.has(portfolioCompanyId)) {
        throw Forbidden("Portfolio company is outside caller scope");
      }
      const signals = await connectors.monday.listSignals(sinceDays);

      return signals
        .filter((s) => s.portfolioCompanyId === portfolioCompanyId)
        .filter((s) => canSeeSignalForInvestor(caller, s, portfolioSet));
    },

    ensurePortfolioCompanyInScope: async (
      caller: Identity,
      portfolioCompanyId: string,
    ): Promise<void> => {
      const portfolioSet = await portfolioScopeForCaller(caller, portfolioCompanyId);
      if (!portfolioSet.has(portfolioCompanyId)) {
        throw Forbidden("Portfolio company is outside caller scope");
      }
    },
  };
};

export type SocietyService = ReturnType<typeof buildSocietyService>;
