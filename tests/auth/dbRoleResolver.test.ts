import { describe, expect, it, vi } from "vitest";
import { CoreError } from "../../src/errors/index.js";
import { createDbRoleResolver } from "../../src/auth/dbRoleResolver.js";
import type { CoreStore, UserRecord } from "../../src/storage/coreStore.js";

const storeWithUser = (user: UserRecord | undefined): CoreStore =>
  ({
    getUserByEmail: vi.fn().mockResolvedValue(user),
  }) as unknown as CoreStore;

describe("createDbRoleResolver", () => {
  it("returns role for an active user", async () => {
    const resolver = createDbRoleResolver(
      storeWithUser({
        email: "team@tomcat.eu",
        role: "admin",
        team: undefined,
        active: true,
      }),
    );
    await expect(resolver("team@tomcat.eu")).resolves.toEqual({
      role: "admin",
      team: undefined,
    });
  });

  it("rejects unknown or inactive users", async () => {
    const resolver = createDbRoleResolver(storeWithUser(undefined));
    await expect(resolver("unknown@tomcat.eu")).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof CoreError && error.code === "AUTH_INVALID",
    );
  });
});
