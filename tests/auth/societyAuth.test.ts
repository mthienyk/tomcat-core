import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { McpOAuthService } from "../../src/auth/mcpOauth/service.js";
import { SocietyAuthService } from "../../src/auth/societyAuth/service.js";
import { createSocietyOauthIdentityResolver } from "../../src/auth/societyAuth/tokenResolver.js";
import { createMcpOauthIdentityResolver } from "../../src/auth/mcpOauth/tokenResolver.js";
import type {
  CoreStore,
  McpOAuthStore,
  McpOAuthAuthorizationCode,
  McpOAuthClientRecord,
  McpOAuthPendingAuthorize,
  McpOAuthTokenRecord,
} from "../../src/storage/coreStore.js";
import type { SocietyMember } from "../../src/domain/society.js";
import type { FastifyRequest } from "fastify";

const sha256Hex = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex");

const buildMemoryMcpStore = (): McpOAuthStore => {
  const clients = new Map<string, McpOAuthClientRecord>();
  const codes = new Map<
    string,
    McpOAuthAuthorizationCode & { expiresAt: number; usedAt: number | undefined }
  >();
  const tokens = new Map<
    string,
    McpOAuthTokenRecord & { revokedAt: Date | undefined }
  >();

  return {
    async createClient(client) {
      clients.set(client.clientId, client);
    },
    async getClient(id) {
      return clients.get(id);
    },
    async savePendingAuthorize() {
      throw new Error("not implemented");
    },
    async popPendingAuthorize(): Promise<McpOAuthPendingAuthorize | undefined> {
      return undefined;
    },
    async createAuthorizationCode(row) {
      codes.set(row.codeHash, {
        ...row,
        expiresAt: Date.now() + row.ttlSeconds * 1000,
        usedAt: undefined,
      });
    },
    async consumeAuthorizationCode(hash) {
      const row = codes.get(hash);
      if (!row || row.usedAt !== undefined || row.expiresAt < Date.now()) {
        return undefined;
      }
      row.usedAt = Date.now();
      return row;
    },
    async createToken(row) {
      tokens.set(row.tokenHash, { ...row, revokedAt: undefined });
    },
    async findToken(hash) {
      const row = tokens.get(hash);
      if (!row || row.revokedAt || row.expiresAt.getTime() < Date.now()) {
        return undefined;
      }
      return row;
    },
    async revokeTokensForPair(clientId, principalEmail) {
      for (const [hash, row] of tokens.entries()) {
        if (row.clientId === clientId && row.principalEmail === principalEmail) {
          row.revokedAt = new Date();
          tokens.set(hash, row);
        }
      }
    },
  };
};

const buildMemoryCoreStore = (): CoreStore => {
  const members = new Map<string, SocietyMember>();
  const magicLinks = new Map<string, { email: string; expiresAt: number; consumed: boolean }>();

  const store = {
    async upsertSocietyMember(member: SocietyMember) {
      members.set(member.memberId, member);
    },
    async getSocietyMemberByEmail(email: string) {
      const normalized = email.toLowerCase();
      for (const member of members.values()) {
        if (member.email.toLowerCase() === normalized && member.active) {
          return member;
        }
      }
      return undefined;
    },
    async listSocietyMembers() {
      return [...members.values()];
    },
    async createSocietyMagicLinkToken(email: string, ttlSeconds: number) {
      const token = "magic_test_token";
      magicLinks.set(sha256Hex(token), {
        email: email.toLowerCase(),
        expiresAt: Date.now() + ttlSeconds * 1000,
        consumed: false,
      });
      return token;
    },
    async consumeSocietyMagicLinkToken(token: string) {
      const row = magicLinks.get(sha256Hex(token));
      if (!row || row.consumed || row.expiresAt < Date.now()) return undefined;
      row.consumed = true;
      return row.email;
    },
  };

  return store as unknown as CoreStore;
};

const reqWithBearer = (token: string): FastifyRequest =>
  ({
    headers: { authorization: `Bearer ${token}` },
  }) as FastifyRequest;

describe("SocietyAuthService", () => {
  it("returns generic success for unknown email", async () => {
    const oauth = new McpOAuthService({
      store: buildMemoryMcpStore(),
      accessTokenTtlSeconds: 3600,
      refreshTokenTtlSeconds: 3600,
    });
    const service = new SocietyAuthService({
      store: buildMemoryCoreStore(),
      oauth,
      magicLinkTtlSeconds: 900,
      exposeMagicLinkInResponse: true,
    });

    const result = await service.requestMagicLink(
      "unknown@example.com",
      "http://localhost:3000/auth/verify",
    );
    expect(result.sent).toBe(true);
    expect(result.verifyUrl).toBeUndefined();
  });

  it("issues oauth code after magic link completion", async () => {
    const mcpStore = buildMemoryMcpStore();
    await mcpStore.createClient({
      clientId: "society_test",
      clientSecretHash: undefined,
      clientName: "Society",
      redirectUris: ["http://localhost:3000/callback"],
      grantTypes: ["authorization_code", "refresh_token"],
      isPublic: true,
    });

    const coreStore = buildMemoryCoreStore();
    await coreStore.upsertSocietyMember({
      memberId: "member_1",
      email: "investor@example.com",
      kind: "society_member",
      tier: "Investor",
      investorId: "inv_1",
      active: true,
    });

    const oauth = new McpOAuthService({
      store: mcpStore,
      accessTokenTtlSeconds: 3600,
      refreshTokenTtlSeconds: 3600,
    });
    const service = new SocietyAuthService({
      store: coreStore,
      oauth,
      magicLinkTtlSeconds: 900,
      exposeMagicLinkInResponse: false,
    });

    await service.requestMagicLink(
      "investor@example.com",
      "http://localhost:3000/auth/verify",
    );

    const completed = await service.completeMagicLink({
      token: "magic_test_token",
      clientId: "society_test",
      redirectUri: "http://localhost:3000/callback",
      codeChallenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
      codeChallengeMethod: "S256",
    });

    expect(completed?.redirectUri).toBe("http://localhost:3000/callback");
    expect(completed?.code).toBeTruthy();
  });
});

describe("Society OAuth identity resolvers", () => {
  it("accepts society.read tokens for allowlisted investors", async () => {
    const accessToken = "society_access_token";
    const mcpStore = buildMemoryMcpStore();
    await mcpStore.createToken({
      tokenHash: sha256Hex(accessToken),
      clientId: "society_test",
      principalEmail: "investor@example.com",
      tokenType: "access",
      scopes: "society.read",
      expiresAt: new Date(Date.now() + 60_000),
    });

    const coreStore = buildMemoryCoreStore();
    await coreStore.upsertSocietyMember({
      memberId: "member_1",
      email: "investor@example.com",
      kind: "society_member",
      tier: "Investor",
      investorId: "inv_1",
      active: true,
    });

    const oauth = new McpOAuthService({
      store: mcpStore,
      accessTokenTtlSeconds: 3600,
      refreshTokenTtlSeconds: 3600,
    });

    const societyResolver = createSocietyOauthIdentityResolver({
      service: oauth,
      store: coreStore,
      resolveRole: async () => ({ role: "internal_team", team: undefined }),
      allowedGoogleDomains: ["tomcat.eu"],
    });

    const identity = await societyResolver.resolve!(reqWithBearer(accessToken));
    expect(identity?.role).toBe("external_investor");
    expect(identity?.investorId).toBe("inv_1");
  });

  it("ignores society.read tokens in the MCP resolver", async () => {
    const accessToken = "society_only_token";
    const mcpStore = buildMemoryMcpStore();
    await mcpStore.createToken({
      tokenHash: sha256Hex(accessToken),
      clientId: "society_test",
      principalEmail: "elie.dupredesaintmaur@tomcat.eu",
      tokenType: "access",
      scopes: "society.read",
      expiresAt: new Date(Date.now() + 60_000),
    });

    const oauth = new McpOAuthService({
      store: mcpStore,
      accessTokenTtlSeconds: 3600,
      refreshTokenTtlSeconds: 3600,
    });

    const mcpResolver = createMcpOauthIdentityResolver({
      service: oauth,
      resolveRole: async () => ({ role: "internal_team", team: undefined }),
    });

    const identity = await mcpResolver.resolve!(reqWithBearer(accessToken));
    expect(identity).toBeUndefined();
  });
});

describe("McpOAuthService scopes", () => {
  it("accepts society.read scope", () => {
    const oauth = new McpOAuthService({
      store: buildMemoryMcpStore(),
      accessTokenTtlSeconds: 3600,
      refreshTokenTtlSeconds: 3600,
    });
    expect(oauth.normalizeScope("society.read")).toBe("society.read");
  });
});
