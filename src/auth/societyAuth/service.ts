import type { CoreStore } from "../../storage/coreStore.js";
import type { McpOAuthService } from "../mcpOauth/service.js";
import { normalizeEmail } from "../email.js";

export type SocietyAuthServiceOptions = {
  store: CoreStore;
  oauth: McpOAuthService;
  magicLinkTtlSeconds: number;
  exposeMagicLinkInResponse: boolean;
};

export type MagicLinkRequestResult = {
  sent: true;
  verifyUrl?: string;
};

export type MagicLinkCompleteResult = {
  code: string;
  redirectUri: string;
};

const isAllowedRedirectUri = (
  uri: string,
  allowedRedirectUris: string[],
): boolean => allowedRedirectUris.includes(uri);

export class SocietyAuthService {
  constructor(private readonly opts: SocietyAuthServiceOptions) {}

  async requestMagicLink(
    email: string,
    verifyBaseUrl: string,
  ): Promise<MagicLinkRequestResult> {
    const normalized = normalizeEmail(email);
    const member = await this.opts.store.getSocietyMemberByEmail(normalized);
    if (!member) {
      return { sent: true };
    }

    const token = await this.opts.store.createSocietyMagicLinkToken(
      normalized,
      this.opts.magicLinkTtlSeconds,
    );

    const result: MagicLinkRequestResult = { sent: true };
    if (this.opts.exposeMagicLinkInResponse) {
      const base = verifyBaseUrl.replace(/\/$/, "");
      result.verifyUrl = `${base}?token=${encodeURIComponent(token)}`;
    }
    return result;
  }

  async completeMagicLink(input: {
    token: string;
    clientId: string;
    redirectUri: string;
    codeChallenge: string;
    codeChallengeMethod: string;
  }): Promise<MagicLinkCompleteResult | undefined> {
    const client = await this.opts.oauth.getClient(input.clientId);
    if (!client) return undefined;
    if (!isAllowedRedirectUri(input.redirectUri, client.redirectUris)) {
      return undefined;
    }
    if (input.codeChallengeMethod !== "S256") return undefined;

    const email = await this.opts.store.consumeSocietyMagicLinkToken(input.token);
    if (!email) return undefined;

    const member = await this.opts.store.getSocietyMemberByEmail(email);
    if (!member) return undefined;

    const scopes = this.opts.oauth.normalizeScope("society.read");
    const code = await this.opts.oauth.issueAuthorizationCode({
      clientId: input.clientId,
      principalEmail: email,
      redirectUri: input.redirectUri,
      codeChallenge: input.codeChallenge,
      codeChallengeMethod: input.codeChallengeMethod,
      scopes,
    });

    return { code, redirectUri: input.redirectUri };
  }
}

export const buildSocietyAuthService = (
  opts: SocietyAuthServiceOptions,
): SocietyAuthService => new SocietyAuthService(opts);
