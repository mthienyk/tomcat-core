import type { Role } from "../domain/identity.js";

export type ResolvedRole = {
  role: Role;
  team: string | undefined;
};

export type RoleResolver = (email: string) => ResolvedRole | Promise<ResolvedRole>;

export const placeholderRoleResolver: RoleResolver = (email) => {
  if (email.endsWith("@tomcat.eu")) {
    return { role: "internal_team", team: undefined };
  }
  return { role: "external_investor", team: undefined };
};
