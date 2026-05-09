import { describe, expect, it } from "vitest";
import {
  createServiceTokenResolver,
  signServiceToken,
} from "../../src/auth/serviceToken.js";
import { CoreError } from "../../src/errors/index.js";

const SECRET = "x".repeat(48);
const TOKEN_OPTIONS = {
  secret: SECRET,
  issuer: "tomcat-core",
  audience: "tomcat-core",
};

const fakeReq = (token: string | undefined) =>
  ({
    headers: token ? { "x-service-token": token } : {},
  }) as unknown as Parameters<
    ReturnType<typeof createServiceTokenResolver>["resolve"]
  >[0];

describe("ServiceTokenResolver", () => {
  const resolver = createServiceTokenResolver({
    secret: SECRET,
    issuer: "tomcat-core",
    audience: "tomcat-core",
    registeredClients: [{ clientId: "society", scopes: ["society.read"] }],
  });

  it("resolves a valid signed token", async () => {
    const token = await signServiceToken(TOKEN_OPTIONS, {
      sub: "society",
      scopes: ["society.read"],
      exp: Math.floor(Date.now() / 1000) + 60,
    });
    const id = await resolver.resolve(fakeReq(token));
    expect(id?.kind).toBe("service");
    expect(id?.kind === "service" && id.clientId).toBe("society");
  });

  it("rejects expired tokens", async () => {
    const token = await signServiceToken(TOKEN_OPTIONS, {
      sub: "society",
      scopes: ["society.read"],
      exp: Math.floor(Date.now() / 1000) - 10,
    });
    await expect(resolver.resolve(fakeReq(token))).rejects.toBeInstanceOf(CoreError);
  });

  it("rejects unknown client ids", async () => {
    const token = await signServiceToken(TOKEN_OPTIONS, {
      sub: "ghost-client",
      scopes: ["society.read"],
      exp: Math.floor(Date.now() / 1000) + 60,
    });
    await expect(resolver.resolve(fakeReq(token))).rejects.toBeInstanceOf(CoreError);
  });

  it("filters out scopes the client did not register", async () => {
    const token = await signServiceToken(TOKEN_OPTIONS, {
      sub: "society",
      scopes: ["society.read", "ai.query"],
      exp: Math.floor(Date.now() / 1000) + 60,
    });
    const id = await resolver.resolve(fakeReq(token));
    expect(id?.kind === "service" && id.scopes).toEqual(["society.read"]);
  });

  it("returns undefined when no header present", async () => {
    expect(await resolver.resolve(fakeReq(undefined))).toBeUndefined();
  });

  it("rejects too long-lived tokens", async () => {
    const token = await signServiceToken(TOKEN_OPTIONS, {
      sub: "society",
      scopes: ["society.read"],
      exp: Math.floor(Date.now() / 1000) + 7200,
    });
    await expect(resolver.resolve(fakeReq(token))).rejects.toBeInstanceOf(CoreError);
  });

  it("rejects external investor delegation without investorId", async () => {
    const token = await signServiceToken(TOKEN_OPTIONS, {
      sub: "society",
      scopes: ["society.read"],
      exp: Math.floor(Date.now() / 1000) + 60,
      actAs: {
        email: "investor@example.test",
        role: "external_investor",
      },
    });
    await expect(resolver.resolve(fakeReq(token))).rejects.toBeInstanceOf(CoreError);
  });

  it("rejects tokens with the wrong audience", async () => {
    const token = await signServiceToken(
      { ...TOKEN_OPTIONS, audience: "other-audience" },
      {
        sub: "society",
        scopes: ["society.read"],
        exp: Math.floor(Date.now() / 1000) + 60,
      },
    );
    await expect(resolver.resolve(fakeReq(token))).rejects.toBeInstanceOf(CoreError);
  });
});
