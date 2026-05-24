import type { RoleResolver } from "./roleResolver.js";
import type { CoreStore } from "../storage/coreStore.js";
import { AuthInvalid } from "../errors/index.js";

export const createDbRoleResolver = (store: CoreStore): RoleResolver =>
  async (email: string) => {
    const user = await store.getUserByEmail(email);
    if (!user) {
      throw AuthInvalid(
        `No active Tomcat user record for "${email}". Ask an admin to add you via POST /internal/users.`,
      );
    }
    return { role: user.role, team: user.team };
  };
