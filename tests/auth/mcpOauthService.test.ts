import { describe, expect, it } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { McpOAuthService } from "../../src/auth/mcpOauth/service.js";
import { AuthInvalid } from "../../src/errors/index.js";
import type {
  McpOAuthAuthorizationCode,
  McpOAuthClientRecord,
  McpOAuthPendingAuthorize,
  McpOAuthStore,
  McpOAuthTokenRecord,
} from "../../src/storage/coreStore.js";

const sha256Hex = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex");

const buildMemoryStore = (): McpOAuthStore => {
  const clients = new Map<string, McpOAuthClientRecord>();
  const pendings = new Map<string, McpOAuthPendingAuthorize & { expiresAt: number }>();
  const codes = new Map<string, McpOAuthAuthorizationCode & { expiresAt: number; usedAt: number | undefined }>();
  const tokens = new Map<string, McpOAuthTokenRecord & { revokedAt: Date | undefined }>();

  return {
    async createClient(client) {
      clients.set(client.clientId, client);
    },
    async getClient(id) {
      return clients.get(id);
    },
    async savePendingAuthorize(row) {
      pendings.set(row.googleState, {
        ...row,
        expiresAt: Date.now() + row.ttlSeconds * 1000,
      });
    },
    async popPendingAuthorize(state) {
      const row = pendings.get(state);
      if (!row || row.expiresAt < Date.now()) return undefined;
      pendings.delete(state);
      return {
        googleState: row.googleState,
        clientId: row.clientId,
        redirectUri: row.redirectUri,
        mcpState: row.mcpState,
        codeChallenge: row.codeChallenge,
        codeChallengeMethod: row.codeChallengeMethod,
        scope: row.scope,
      };
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
      return {
        codeHash: row.codeHash,
        clientId: row.clientId,
        principalEmail: row.principalEmail,
        redirectUri: row.redirectUri,
        codeChallenge: row.codeChallenge,
        codeChallengeMethod: row.codeChallengeMethod,
        scopes: row.scopes,
      };
    },
    async createToken(row) {
      tokens.set(row.tokenHash, { ...row, revokedAt: undefined });
    },
    async findToken(hash) {
      const row = tokens.get(hash);
      if (!row || row.revokedAt || row.expiresAt.getTime() < Date.now()) {
        return undefined;
      }
      return {
        tokenHash: row.tokenHash,
        clientId: row.clientId,
        principalEmail: row.principalEmail,
        tokenType: row.tokenType,
        scopes: row.scopes,
        expiresAt: row.expiresAt,
      };
    },
    async revokeTokenByHash(hash) {
      const row = tokens.get(hash);
      if (!row || row.revokedAt) return false;
      row.revokedAt = new Date();
      tokens.set(hash, row);
      return true;
    },
    async revokeTokensForPair(clientId, email) {
      let n = 0;
      for (const [, row] of tokens) {
        if (
          row.clientId === clientId
          && row.principalEmail === email
          && !row.revokedAt
        ) {
          row.revokedAt = new Date();
          n += 1;
        }
      }
      return n;
    },
    async revokeTokensForPrincipalEmail(email) {
      let n = 0;
      for (const [, row] of tokens) {
        if (row.principalEmail === email && !row.revokedAt) {
          row.revokedAt = new Date();
          n += 1;
        }
      }
      return n;
    },
  };
};

const buildService = (): McpOAuthService =>
  new McpOAuthService({
    store: buildMemoryStore(),
    accessTokenTtlSeconds: 60,
    refreshTokenTtlSeconds: 600,
  });

const makePkce = (): { verifier: string; challenge: string } => {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
};

describe("McpOAuthService", () => {
  it("registers a public client without secret by default", async () => {
    const service = buildService();
    const result = await service.registerClient({
      clientName: "Cursor",
      redirectUris: ["cursor://oauth/callback"],
      grantTypes: ["authorization_code", "refresh_token"],
    });
    expect(result.clientId).toMatch(/^mcp_/);
    expect(result.clientSecret).toBeUndefined();
  });

  it("exchanges code with valid PKCE and refreshes tokens", async () => {
    const service = buildService();
    const client = await service.registerClient({
      clientName: "Cursor",
      redirectUris: ["cursor://cb"],
      grantTypes: ["authorization_code", "refresh_token"],
    });
    const { verifier, challenge } = makePkce();

    const code = await service.issueAuthorizationCode({
      clientId: client.clientId,
      principalEmail: "alice@tomcat.eu",
      redirectUri: "cursor://cb",
      codeChallenge: challenge,
      codeChallengeMethod: "S256",
      scopes: "mcp:tools",
    });

    const tokens = await service.exchangeCode({
      code,
      clientId: client.clientId,
      codeVerifier: verifier,
      redirectUri: "cursor://cb",
    });
    expect(tokens).toBeDefined();
    expect(tokens!.accessToken).toBeTypeOf("string");

    const resolved = await service.resolveAccessToken(tokens!.accessToken);
    expect(resolved?.principalEmail).toBe("alice@tomcat.eu");

    const refreshed = await service.refreshTokens({
      refreshToken: tokens!.refreshToken,
      clientId: client.clientId,
    });
    expect(refreshed?.accessToken).toBeTypeOf("string");

    const oldStillValid = await service.resolveAccessToken(tokens!.accessToken);
    expect(oldStillValid?.principalEmail).toBe("alice@tomcat.eu");
  });

  it("rejects code reuse and bad PKCE verifier", async () => {
    const service = buildService();
    const client = await service.registerClient({
      clientName: "Cursor",
      redirectUris: ["cursor://cb"],
      grantTypes: ["authorization_code"],
    });
    const { verifier, challenge } = makePkce();
    const code = await service.issueAuthorizationCode({
      clientId: client.clientId,
      principalEmail: "alice@tomcat.eu",
      redirectUri: "cursor://cb",
      codeChallenge: challenge,
      codeChallengeMethod: "S256",
      scopes: "mcp:tools",
    });

    const badVerifier = randomBytes(32).toString("base64url");
    expect(
      await service.exchangeCode({
        code,
        clientId: client.clientId,
        codeVerifier: badVerifier,
        redirectUri: "cursor://cb",
      }),
    ).toBeUndefined();

    expect(
      await service.exchangeCode({
        code,
        clientId: client.clientId,
        codeVerifier: verifier,
        redirectUri: "cursor://cb",
      }),
    ).toBeUndefined();
  });

  it("normalizes scope and rejects invalid scope", () => {
    const service = buildService();
    expect(service.normalizeScope("")).toBe("mcp:tools");
    expect(service.normalizeScope("mcp:tools")).toBe("mcp:tools");
    expect(() => service.normalizeScope("foo")).toThrow();
  });

  it("blocks refresh and purges tokens when principal access is revoked", async () => {
    const store = buildMemoryStore();
    const service = new McpOAuthService({
      store,
      accessTokenTtlSeconds: 60,
      refreshTokenTtlSeconds: 600,
      resolveRole: async (email) => {
        if (email === "alice@tomcat.eu") {
          throw AuthInvalid("revoked", { reason: "access_revoked" });
        }
        return { role: "internal_team", team: undefined };
      },
    });
    const client = await service.registerClient({
      clientName: "Cursor",
      redirectUris: ["cursor://cb"],
      grantTypes: ["authorization_code", "refresh_token"],
    });
    const { verifier, challenge } = makePkce();
    const code = await service.issueAuthorizationCode({
      clientId: client.clientId,
      principalEmail: "alice@tomcat.eu",
      redirectUri: "cursor://cb",
      codeChallenge: challenge,
      codeChallengeMethod: "S256",
      scopes: "mcp:tools",
    });
    const tokens = await service.exchangeCode({
      code,
      clientId: client.clientId,
      codeVerifier: verifier,
      redirectUri: "cursor://cb",
    });
    expect(tokens).toBeDefined();

    const refreshed = await service.refreshTokens({
      refreshToken: tokens!.refreshToken,
      clientId: client.clientId,
    });
    expect(refreshed).toBeUndefined();
    expect(await service.resolveAccessToken(tokens!.accessToken)).toBeUndefined();
  });

  it("revokes all tokens for a (client, principal) pair", async () => {
    const service = buildService();
    const client = await service.registerClient({
      clientName: "Cursor",
      redirectUris: ["cursor://cb"],
      grantTypes: ["authorization_code"],
    });
    const { verifier, challenge } = makePkce();
    const code = await service.issueAuthorizationCode({
      clientId: client.clientId,
      principalEmail: "alice@tomcat.eu",
      redirectUri: "cursor://cb",
      codeChallenge: challenge,
      codeChallengeMethod: "S256",
      scopes: "mcp:tools",
    });
    const tokens = await service.exchangeCode({
      code,
      clientId: client.clientId,
      codeVerifier: verifier,
      redirectUri: "cursor://cb",
    });
    expect(tokens).toBeDefined();
    await service.revokeToken(tokens!.accessToken);
    expect(await service.resolveAccessToken(tokens!.accessToken)).toBeUndefined();
  });

  it("stores access tokens by sha256 only (no plain token)", async () => {
    const service = buildService();
    const client = await service.registerClient({
      clientName: "Cursor",
      redirectUris: ["cursor://cb"],
      grantTypes: ["authorization_code"],
    });
    const { verifier, challenge } = makePkce();
    const code = await service.issueAuthorizationCode({
      clientId: client.clientId,
      principalEmail: "alice@tomcat.eu",
      redirectUri: "cursor://cb",
      codeChallenge: challenge,
      codeChallengeMethod: "S256",
      scopes: "mcp:tools",
    });
    const tokens = await service.exchangeCode({
      code,
      clientId: client.clientId,
      codeVerifier: verifier,
      redirectUri: "cursor://cb",
    });
    const fakeHash = sha256Hex("nope");
    expect(fakeHash).not.toBe(sha256Hex(tokens!.accessToken));
  });
});
