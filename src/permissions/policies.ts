import {
  type Identity,
  effectiveHuman,
  isInternalRole,
  hasScope,
} from "../domain/identity.js";
import type {
  Deal,
  Event,
  Note,
  PortfolioSignal,
  Startup,
} from "../domain/entities.js";

export type Action =
  | "society.read"
  | "society.write"
  | "ai.query"
  | "briefs.write"
  | "internal.read";

const TIER_ORDER: Record<
  "bronze" | "silver" | "gold" | "platinum",
  number
> = { bronze: 1, silver: 2, gold: 3, platinum: 4 };

export const can = (id: Identity, action: Action): boolean => {
  if (id.kind === "service") {
    if (!hasScope(id, action)) return false;
    if (id.onBehalfOf) return canHuman(id.onBehalfOf, action);
    return true;
  }
  return canHuman(id, action);
};

const canHuman = (
  human: Extract<Identity, { kind: "human" }>,
  action: Action,
): boolean => {
  if (action === "society.read") return true;
  if (action === "ai.query") return isInternalRole(human.role);
  if (action === "briefs.write") return isInternalRole(human.role);
  if (action === "internal.read") return isInternalRole(human.role);
  if (action === "society.write")
    return human.role === "admin" || human.role === "investor_relations";
  return false;
};

export const canSeeStartup = (id: Identity, startup: Startup): boolean => {
  const human = effectiveHuman(id);
  if (human && isInternalRole(human.role)) return true;
  if (startup.visibilityTier === "internal_only") return false;
  if (!human || !human.investorTier) return false;
  return TIER_ORDER[human.investorTier] >= TIER_ORDER[startup.visibilityTier];
};

export const canSeeDeal = (id: Identity, deal: Deal): boolean => {
  const human = effectiveHuman(id);
  if (human && isInternalRole(human.role)) return true;
  return deal.visibilityTier === "shared_with_investors";
};

export const canSeeNote = (id: Identity, note: Note): boolean => {
  const human = effectiveHuman(id);
  if (human && isInternalRole(human.role)) {
    return note.sensitivity !== "confidential" || human.role === "admin";
  }
  return note.sensitivity === "public" || note.sensitivity === "investor_visible";
};

export const canSeeSignal = (id: Identity, signal: PortfolioSignal): boolean => {
  const human = effectiveHuman(id);
  if (human && isInternalRole(human.role)) return true;
  return signal.visibilityTier === "shared_with_investors";
};

export const canSeeSignalForInvestor = (
  id: Identity,
  signal: PortfolioSignal,
  investorPortfolioCompanyIds: ReadonlySet<string>,
): boolean => {
  if (!canSeeSignal(id, signal)) return false;
  const human = effectiveHuman(id);
  if (human && isInternalRole(human.role)) return true;
  return investorPortfolioCompanyIds.has(signal.portfolioCompanyId);
};

export const canSeeEvent = (
  id: Identity,
  event: Event,
  investorId: string | undefined,
): boolean => {
  const human = effectiveHuman(id);
  if (human && isInternalRole(human.role)) return true;
  if (event.visibility === "internal_only") return false;
  if (event.visibility === "public") return true;
  return investorId !== undefined && event.invitedInvestorIds.includes(investorId);
};
