import { describe, expect, it, vi } from "vitest";
import { CoreError } from "../../src/errors/index.js";
import { createDbRoleResolver } from "../../src/auth/dbRoleResolver.js";
import type { CoreStore, UserRecord } from "../../src/storage/coreStore.js";

const storeMock = (options: {
  user?: UserRecord;
  insertUserIfAbsent?: CoreStore["insertUserIfAbsent"];
  findUserByEmail?: CoreStore["findUserByEmail"];
}): CoreStore => {
  let user = options.user;
  const findUserByEmail =
    options.findUserByEmail ??
    vi.fn().mockImplementation(async () => user);
  const insertUserIfAbsent =
    options.insertUserIfAbsent ??
    vi.fn().mockImplementation(async (candidate: UserRecord) => {
      if (user) return false;
      user = candidate;
      return true;
    });

  return {
    findUserByEmail,
    insertUserIfAbsent,
  } as unknown as CoreStore;
};

const resolverOpts = { autoProvisionDomains: ["tomcat.eu"] };

describe("createDbRoleResolver", () => {
  it("returns role for an active user", async () => {
    const resolver = createDbRoleResolver(
      storeMock({
        user: {
          email: "team@tomcat.eu",
          role: "admin",
          team: undefined,
          active: true,
        },
      }),
      resolverOpts,
    );
    await expect(resolver("Team@tomcat.eu")).resolves.toEqual({
      role: "admin",
      team: undefined,
    });
  });

  it("rejects inactive users", async () => {
    const resolver = createDbRoleResolver(
      storeMock({
        user: {
          email: "former@tomcat.eu",
          role: "internal_team",
          team: undefined,
          active: false,
        },
      }),
      resolverOpts,
    );
    await expect(resolver("former@tomcat.eu")).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof CoreError
        && error.code === "AUTH_INVALID"
        && error.details?.["reason"] === "access_revoked",
    );
  });

  it("auto-provisions @tomcat.eu on first login without overwriting", async () => {
    const insertUserIfAbsent = vi.fn().mockResolvedValue(true);
    const findUserByEmail = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        email: "new@tomcat.eu",
        role: "internal_team",
        team: undefined,
        active: true,
      });

    const resolver = createDbRoleResolver(
      storeMock({ insertUserIfAbsent, findUserByEmail }),
      resolverOpts,
    );

    await expect(resolver("new@tomcat.eu")).resolves.toEqual({
      role: "internal_team",
      team: undefined,
    });
    expect(insertUserIfAbsent).toHaveBeenCalledWith({
      email: "new@tomcat.eu",
      role: "internal_team",
      team: undefined,
      active: true,
    });
  });

  it("returns an existing admin when auto-provision races admin insert", async () => {
    const insertUserIfAbsent = vi.fn().mockResolvedValue(false);
    const findUserByEmail = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        email: "new@tomcat.eu",
        role: "admin",
        team: undefined,
        active: true,
      });

    const resolver = createDbRoleResolver(
      storeMock({ insertUserIfAbsent, findUserByEmail }),
      resolverOpts,
    );

    await expect(resolver("new@tomcat.eu")).resolves.toEqual({
      role: "admin",
      team: undefined,
    });
  });

  it("rejects unknown users outside auto-provision domains", async () => {
    const resolver = createDbRoleResolver(storeMock({}), resolverOpts);
    await expect(resolver("guest@example.com")).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof CoreError
        && error.code === "AUTH_INVALID"
        && error.details?.["reason"] === "user_not_provisioned",
    );
  });
});
