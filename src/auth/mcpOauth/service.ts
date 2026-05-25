import { randomUUID, randomBytes } from "node:crypto";
import type {
  McpOAuthClientRecord,
  McpOAuthPendingAuthorize,
  McpOAuthStore,
  McpOAuthTokenRecord,
} from "../../storage/coreStore.js";
import { sha256Hex, verifyPkceS256 } from "./pkce.js";

const PENDING_TTL_SECONDS = 600;
const AUTHORIZATION_CODE_TTL_SECONDS = 60;
const DEFAULT_SCOPE = "mcp:tools";
const SUPPORTED_SCOPES = new Set(["mcp:tools", "society.read"]);

export type McpOAuthServiceOptions = {
  store: McpOAuthStore;
  accessTokenTtlSeconds: number;
  refreshTokenTtlSeconds: number;
};

export type RegisterClientInput = {
  clientName: string | undefined;
  redirectUris: string[];
  grantTypes: string[] | undefined;
};

export type RegisterClientResult = {
  clientId: string;
  clientSecret: string | undefined;
  clientName: string | undefined;
  redirectUris: string[];
  grantTypes: string[];
};

export type TokenIssueResult = {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresInSeconds: number;
  scopes: string;
};

export class McpOAuthService {
  constructor(private readonly opts: McpOAuthServiceOptions) {}

  normalizeScope(scope: string): string {
    const requested = scope.split(/\s+/).filter(Boolean);
    if (requested.length === 0) return DEFAULT_SCOPE;
    const filtered = requested.filter((item) => SUPPORTED_SCOPES.has(item));
    if (filtered.length === 0) {
      throw new Error("invalid_scope");
    }
    return filtered.join(" ");
  }

  async registerClient(input: RegisterClientInput): Promise<RegisterClientResult> {
    const clientId = `mcp_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const grantTypes = input.grantTypes ?? ["authorization_code", "refresh_token"];

    let clientSecret: string | undefined;
    let clientSecretHash: string | undefined;
    let isPublic = true;
    if (grantTypes.includes("client_credentials")) {
      clientSecret = randomBytes(48).toString("base64url");
      clientSecretHash = sha256Hex(clientSecret);
      isPublic = false;
    }

    const record: McpOAuthClientRecord = {
      clientId,
      clientSecretHash,
      clientName: input.clientName,
      redirectUris: input.redirectUris,
      grantTypes,
      isPublic,
    };
    await this.opts.store.createClient(record);

    return {
      clientId,
      clientSecret,
      clientName: input.clientName,
      redirectUris: input.redirectUris,
      grantTypes,
    };
  }

  async getClient(clientId: string): Promise<McpOAuthClientRecord | undefined> {
    return this.opts.store.getClient(clientId);
  }

  async authenticateClient(
    clientId: string,
    clientSecret: string | undefined,
  ): Promise<McpOAuthClientRecord | undefined> {
    const client = await this.opts.store.getClient(clientId);
    if (!client) return undefined;
    if (client.isPublic) return client;
    if (!client.clientSecretHash || !clientSecret) return undefined;
    if (sha256Hex(clientSecret) !== client.clientSecretHash) return undefined;
    return client;
  }

  generateGoogleState(): string {
    return randomBytes(32).toString("base64url");
  }

  async savePendingAuthorize(row: McpOAuthPendingAuthorize): Promise<void> {
    await this.opts.store.savePendingAuthorize({
      ...row,
      ttlSeconds: PENDING_TTL_SECONDS,
    });
  }

  async popPendingAuthorize(
    googleState: string,
  ): Promise<McpOAuthPendingAuthorize | undefined> {
    return this.opts.store.popPendingAuthorize(googleState);
  }

  async issueAuthorizationCode(input: {
    clientId: string;
    principalEmail: string;
    redirectUri: string;
    codeChallenge: string;
    codeChallengeMethod: string;
    scopes: string;
  }): Promise<string> {
    const code = randomBytes(48).toString("base64url");
    await this.opts.store.createAuthorizationCode({
      codeHash: sha256Hex(code),
      clientId: input.clientId,
      principalEmail: input.principalEmail,
      redirectUri: input.redirectUri,
      codeChallenge: input.codeChallenge,
      codeChallengeMethod: input.codeChallengeMethod,
      scopes: input.scopes,
      ttlSeconds: AUTHORIZATION_CODE_TTL_SECONDS,
    });
    return code;
  }

  async exchangeCode(input: {
    code: string;
    clientId: string;
    codeVerifier: string;
    redirectUri: string;
  }): Promise<TokenIssueResult | undefined> {
    const consumed = await this.opts.store.consumeAuthorizationCode(
      sha256Hex(input.code),
    );
    if (!consumed) return undefined;
    if (consumed.clientId !== input.clientId) return undefined;
    if (consumed.redirectUri !== input.redirectUri) return undefined;
    if (consumed.codeChallengeMethod !== "S256") return undefined;
    if (!verifyPkceS256(input.codeVerifier, consumed.codeChallenge)) {
      return undefined;
    }
    return this.issueTokenPair({
      clientId: consumed.clientId,
      principalEmail: consumed.principalEmail,
      scopes: consumed.scopes,
    });
  }

  async refreshTokens(input: {
    refreshToken: string;
    clientId: string;
  }): Promise<TokenIssueResult | undefined> {
    const token = await this.opts.store.findToken(sha256Hex(input.refreshToken));
    if (!token) return undefined;
    if (token.tokenType !== "refresh") return undefined;
    if (token.clientId !== input.clientId) return undefined;

    await this.opts.store.revokeTokensForPair(
      token.clientId,
      token.principalEmail,
    );

    return this.issueTokenPair({
      clientId: token.clientId,
      principalEmail: token.principalEmail,
      scopes: token.scopes,
    });
  }

  async revokeToken(token: string): Promise<void> {
    const record = await this.opts.store.findToken(sha256Hex(token));
    if (!record) return;
    await this.opts.store.revokeTokensForPair(
      record.clientId,
      record.principalEmail,
    );
  }

  async resolveAccessToken(token: string): Promise<
    | { principalEmail: string; clientId: string; scopes: string }
    | undefined
  > {
    const record = await this.opts.store.findToken(sha256Hex(token));
    if (!record || record.tokenType !== "access") return undefined;
    return {
      principalEmail: record.principalEmail,
      clientId: record.clientId,
      scopes: record.scopes,
    };
  }

  private async issueTokenPair(input: {
    clientId: string;
    principalEmail: string;
    scopes: string;
  }): Promise<TokenIssueResult> {
    const accessToken = randomBytes(48).toString("base64url");
    const refreshToken = randomBytes(48).toString("base64url");
    const now = Date.now();

    const accessRow: McpOAuthTokenRecord = {
      tokenHash: sha256Hex(accessToken),
      clientId: input.clientId,
      principalEmail: input.principalEmail,
      tokenType: "access",
      scopes: input.scopes,
      expiresAt: new Date(now + this.opts.accessTokenTtlSeconds * 1000),
    };
    const refreshRow: McpOAuthTokenRecord = {
      tokenHash: sha256Hex(refreshToken),
      clientId: input.clientId,
      principalEmail: input.principalEmail,
      tokenType: "refresh",
      scopes: input.scopes,
      expiresAt: new Date(now + this.opts.refreshTokenTtlSeconds * 1000),
    };

    await this.opts.store.createToken(accessRow);
    await this.opts.store.createToken(refreshRow);

    return {
      accessToken,
      refreshToken,
      accessTokenExpiresInSeconds: this.opts.accessTokenTtlSeconds,
      scopes: input.scopes,
    };
  }
}
