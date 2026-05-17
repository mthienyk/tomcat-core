import type { RoleResolver } from "./roleResolver.js";
import type { CoreStore } from "../storage/coreStore.js";
import { placeholderRoleResolver } from "./roleResolver.js";

export const createDbRoleResolver = (store: CoreStore): RoleResolver =>
  async (email: string) => {
    const user = await store.getUserByEmail(email);
    if (!user) {
      // Unknown email: fall back to domain heuristic and resolve synchronously.
      return placeholderRoleResolver(email) as Awaited<ReturnType<RoleResolver>>;
    }
    return { role: user.role, team: user.team };
  };
