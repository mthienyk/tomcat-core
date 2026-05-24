import { OAuth2Client, type TokenPayload } from "google-auth-library";
import { AuthInvalid, CoreError } from "../errors/index.js";
import type { HumanIdentity, Role } from "../domain/identity.js";
import type { RoleResolver } from "./roleResolver.js";

export type GoogleResolverOptions = {
  clientId: string;
  allowedDomains: string[];
  resolveRole: RoleResolver;
};

export type VerifyGoogleIdTokenOptions = GoogleResolverOptions;

const assertVerifiedEmail = (payload: TokenPayload | undefined): TokenPayload => {
  if (!payload?.email || !payload.email_verified) {
    throw AuthInvalid("Google ID token missing verified email");
  }
  return payload;
};

export const verifyGoogleIdToken = async (
  opts: VerifyGoogleIdTokenOptions,
  idToken: string,
): Promise<HumanIdentity> => {
  const client = new OAuth2Client(opts.clientId);
  let payload: TokenPayload;
  try {
    const ticket = await client.verifyIdToken({
      idToken,
      audience: opts.clientId,
    });
    payload = assertVerifiedEmail(ticket.getPayload());
  } catch (error) {
    if (error instanceof CoreError) throw error;
    throw AuthInvalid("Invalid Google ID token");
  }

  const email = payload.email as string;
  const domain = email.split("@")[1] ?? "";
  if (!opts.allowedDomains.includes(domain)) {
    throw AuthInvalid(`Domain "${domain}" is not allowed`);
  }

  if (opts.allowedDomains.length === 1) {
    const requiredHostedDomain = opts.allowedDomains[0];
    if (payload.hd !== requiredHostedDomain) {
      throw AuthInvalid(
        `Account must be a Google Workspace user @${requiredHostedDomain}`,
      );
    }
  } else if (
    typeof payload.hd === "string" &&
    payload.hd.length > 0 &&
    !opts.allowedDomains.includes(payload.hd)
  ) {
    throw AuthInvalid(`Hosted domain "${payload.hd}" is not allowed`);
  }

  const { role, team } = await opts.resolveRole(email);
  return {
    kind: "human",
    email,
    domain,
    role: role as Role,
    team,
    investorId: undefined,
  };
};
