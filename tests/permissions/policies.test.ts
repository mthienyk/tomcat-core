import { describe, expect, it } from "vitest";
import {
  can,
  canSeeDeal,
  canSeeNote,
  canSeeSignalForInvestor,
  canSeeStartup,
} from "../../src/permissions/policies.js";
import type { Identity } from "../../src/domain/identity.js";
import type {
  Deal,
  Note,
  PortfolioSignal,
  Startup,
} from "../../src/domain/entities.js";

const internal: Identity = {
  kind: "human",
  email: "alice@tomcat.eu",
  domain: "tomcat.eu",
  role: "internal_team",
  team: undefined,
  investorId: undefined,
};

const investor: Identity = {
  kind: "human",
  email: "investor@example.test",
  domain: "example.test",
  role: "external_investor",
  team: undefined,
  investorId: "investor_1",
};

const startup = (
  tier: Startup["visibilityTier"],
): Startup => ({
  id: "stp_x",
  name: "X",
  sectors: ["saas"],
  stage: "seed",
  country: undefined,
  description: undefined,
  visibilityTier: tier,
  sources: [],
});

describe("can()", () => {
  it("allows internal team to query AI", () => {
    expect(can(internal, "ai.query")).toBe(true);
  });
  it("denies external investor from AI query", () => {
    expect(can(investor, "ai.query")).toBe(false);
  });
  it("requires service token to have scope", () => {
    const svc: Identity = {
      kind: "service",
      clientId: "society",
      scopes: ["society.read"],
      onBehalfOf: undefined,
    };
    expect(can(svc, "society.read")).toBe(true);
    expect(can(svc, "ai.query")).toBe(false);
  });
});

describe("canSeeStartup()", () => {
  it("internal sees everything including internal_only", () => {
    expect(canSeeStartup(internal, startup("internal_only"))).toBe(true);
    expect(canSeeStartup(internal, startup("shared_with_investors"))).toBe(true);
  });
  it("investor sees shared_with_investors startups", () => {
    expect(canSeeStartup(investor, startup("shared_with_investors"))).toBe(true);
  });
  it("investor cannot see internal_only", () => {
    expect(canSeeStartup(investor, startup("internal_only"))).toBe(false);
  });
});

describe("canSeeDeal()", () => {
  const baseDeal: Deal = {
    id: "d",
    startupId: "s",
    ownerEmail: "o",
    status: "screening",
    amountEur: undefined,
    updatedAt: "2026-01-01",
    visibilityTier: "internal_only",
  };
  it("blocks external investor from internal_only deal", () => {
    expect(canSeeDeal(investor, baseDeal)).toBe(false);
  });
  it("allows external investor on shared deal", () => {
    expect(
      canSeeDeal(investor, { ...baseDeal, visibilityTier: "shared_with_investors" }),
    ).toBe(true);
  });
});

describe("canSeeNote()", () => {
  const note = (sensitivity: Note["sensitivity"]): Note => ({
    id: "n",
    startupId: "s",
    authorEmail: "a@tomcat.eu",
    body: "x",
    sensitivity,
    createdAt: "2026-01-01",
    source: { system: "hubspot", externalId: "1", url: undefined },
  });
  it("hides internal/confidential from external", () => {
    expect(canSeeNote(investor, note("internal"))).toBe(false);
    expect(canSeeNote(investor, note("confidential"))).toBe(false);
    expect(canSeeNote(investor, note("investor_visible"))).toBe(true);
  });
  it("hides confidential from non-admin internals", () => {
    expect(canSeeNote(internal, note("confidential"))).toBe(false);
    expect(canSeeNote(internal, note("internal"))).toBe(true);
  });
});

describe("canSeeSignalForInvestor()", () => {
  const signal: PortfolioSignal = {
    id: "s1",
    portfolioCompanyId: "portfolio_1",
    kind: "hire",
    summary: "x",
    detectedAt: "2026-01-01",
    sourceUrl: undefined,
    visibilityTier: "shared_with_investors",
  };
  it("allows investor that owns the portfolio company", () => {
    expect(
      canSeeSignalForInvestor(investor, signal, new Set(["portfolio_1"])),
    ).toBe(true);
  });
  it("blocks investor that does not own the portfolio company", () => {
    expect(canSeeSignalForInvestor(investor, signal, new Set([]))).toBe(false);
  });
  it("blocks any investor on internal_only signal", () => {
    expect(
      canSeeSignalForInvestor(
        investor,
        { ...signal, visibilityTier: "internal_only" },
        new Set(["portfolio_1"]),
      ),
    ).toBe(false);
  });
});
