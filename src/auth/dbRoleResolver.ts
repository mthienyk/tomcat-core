import type { RoleResolver } from "./roleResolver.js";
import type { CoreStore, UserRecord } from "../storage/coreStore.js";
import { AuthInvalid } from "../errors/index.js";
import { accessRevokedMessage } from "./authHints.js";
import { emailDomain, normalizeEmail } from "./email.js";

export type DbRoleResolverOptions = {
  autoProvisionDomains: string[];
};

export const createDbRoleResolver = (
  store: CoreStore,
  opts: DbRoleResolverOptions,
): RoleResolver =>
  async (email: string) => {
    const normalizedEmail = normalizeEmail(email);
    const existing = await store.findUserByEmail(normalizedEmail);
    if (existing) {
      if (!existing.active) {
        throw AuthInvalid(accessRevokedMessage(normalizedEmail), {
          reason: "access_revoked",
        });
      }
      return { role: existing.role, team: existing.team };
    }

    const domain = emailDomain(normalizedEmail);
    if (!opts.autoProvisionDomains.includes(domain)) {
      throw AuthInvalid(
        `No Tomcat user record for "${normalizedEmail}". Ask an admin to add you via POST /internal/users.`,
        { reason: "user_not_provisioned" },
      );
    }

    const provisioned: UserRecord = {
      email: normalizedEmail,
      role: "internal_team",
      team: undefined,
      active: true,
    };
    await store.insertUserIfAbsent(provisioned);

    const resolved = await store.findUserByEmail(normalizedEmail);
    if (!resolved) {
      throw AuthInvalid(
        `Could not provision Tomcat user for "${normalizedEmail}". Retry or contact an admin.`,
        { reason: "user_not_provisioned" },
      );
    }
    if (!resolved.active) {
      throw AuthInvalid(accessRevokedMessage(normalizedEmail), {
        reason: "access_revoked",
      });
    }
    return { role: resolved.role, team: resolved.team };
  };
