export type InternalRole =
  | "admin"
  | "internal_team"
  | "finance"
  | "investor_relations"
  | "portfolio_ops";

export type ExternalRole = "external_investor" | "service_client";

export type Role = InternalRole | ExternalRole;

export const INTERNAL_ROLES: ReadonlySet<InternalRole> = new Set([
  "admin",
  "internal_team",
  "finance",
  "investor_relations",
  "portfolio_ops",
]);

export const isInternalRole = (role: Role): role is InternalRole =>
  INTERNAL_ROLES.has(role as InternalRole);

export type HumanIdentity = {
  kind: "human";
  email: string;
  domain: string;
  role: Role;
  team: string | undefined;
  investorId: string | undefined;
};

export type ServiceIdentity = {
  kind: "service";
  clientId: string;
  scopes: string[];
  onBehalfOf: HumanIdentity | undefined;
};

export type Identity = HumanIdentity | ServiceIdentity;

export const effectiveHuman = (id: Identity): HumanIdentity | undefined =>
  id.kind === "human" ? id : id.onBehalfOf;

export const hasScope = (id: Identity, scope: string): boolean => {
  if (id.kind === "service") return id.scopes.includes(scope);
  return true;
};
