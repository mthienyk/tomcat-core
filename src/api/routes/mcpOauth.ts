import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { BadRequest, CoreError } from "../../errors/index.js";
import type { McpOAuthService } from "../../auth/mcpOauth/service.js";
import { exchangeGoogleAuthorizationCode } from "../../auth/mcpOauth/googleExchange.js";
import { verifyGoogleIdToken } from "../../auth/verifyGoogleIdToken.js";
import type { RoleResolver } from "../../auth/roleResolver.js";
import { authFailureReason } from "../../auth/authHints.js";
import {
  oauthErrorPage,
  oauthSuccessPage,
} from "../../auth/mcpOauth/htmlPages.js";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_SCOPES = "openid email profile";

export type McpOAuthRoutesDeps = {
  service: McpOAuthService;
  resolveRole: RoleResolver;
  googleWebClientId: string;
  googleWebClientSecret: string;
  allowedGoogleDomains: string[];
  issuerUrl: string;
  allowedRedirectUriPrefixes: string[];
  registerRateLimitPerMinute: number;
};

const RegisterBody = z.object({
  client_name: z.string().optional(),
  redirect_uris: z.array(z.string().url()).min(1),
  grant_types: z.array(z.string()).optional(),
  application_type: z.string().optional(),
  token_endpoint_auth_method: z.string().optional(),
});

const TokenFormBody = z.object({
  grant_type: z.string(),
  client_id: z.string().optional(),
  client_secret: z.string().optional(),
  code: z.string().optional(),
  redirect_uri: z.string().optional(),
  code_verifier: z.string().optional(),
  refresh_token: z.string().optional(),
});

const oauthErrorResponse = (
  error: string,
  description: string,
  status = 400,
): { status: number; body: Record<string, string> } => ({
  status,
  body: { error, error_description: description },
});

const callbackUrl = (issuer: string): string =>
  `${issuer.replace(/\/$/, "")}/oauth/callback/google`;

const baseUrlForRequest = (req: FastifyRequest, fallback: string): string => {
  const forwardedHost = req.headers["x-forwarded-host"];
  const host = Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost;
  if (host) {
    const proto = (req.headers["x-forwarded-proto"] as string) ?? "https";
    return `${proto}://${host}`;
  }
  return fallback.replace(/\/$/, "");
};

const validateRedirectPrefix = (
  uri: string,
  allowedPrefixes: string[],
): boolean => {
  if (allowedPrefixes.length === 0) return true;
  return allowedPrefixes.some((prefix) => uri.startsWith(prefix));
};

type RateBucket = { count: number; windowStart: number };
const buildRateLimiter = (limitPerMinute: number) => {
  const buckets = new Map<string, RateBucket>();
  return (ip: string): { allowed: boolean; retryAfter: number } => {
    if (limitPerMinute <= 0) return { allowed: true, retryAfter: 0 };
    const now = Date.now();
    const bucket = buckets.get(ip);
    if (!bucket || now - bucket.windowStart >= 60_000) {
      buckets.set(ip, { count: 1, windowStart: now });
      return { allowed: true, retryAfter: 0 };
    }
    if (bucket.count >= limitPerMinute) {
      const retryAfter = Math.ceil((60_000 - (now - bucket.windowStart)) / 1000);
      return { allowed: false, retryAfter };
    }
    bucket.count += 1;
    return { allowed: true, retryAfter: 0 };
  };
};

const clientIp = (req: FastifyRequest): string => {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0]?.trim() ?? "unknown";
  return req.ip ?? "unknown";
};

export const registerMcpOauthRoutes = (
  app: FastifyInstance,
  deps: McpOAuthRoutesDeps,
): void => {
  const checkRegisterRate = buildRateLimiter(deps.registerRateLimitPerMinute);

  app.get("/.well-known/oauth-authorization-server", async (req, reply) => {
    const base = baseUrlForRequest(req, deps.issuerUrl);
    return reply.send({
      issuer: base,
      authorization_endpoint: `${base}/oauth/authorize`,
      token_endpoint: `${base}/oauth/token`,
      registration_endpoint: `${base}/oauth/register`,
      revocation_endpoint: `${base}/oauth/revoke`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
      scopes_supported: ["mcp:tools"],
      resource: `${base}/mcp`,
    });
  });

  app.get<{ Params: { suffix?: string } }>(
    "/.well-known/oauth-protected-resource/*",
    async (req, reply) => {
      const base = baseUrlForRequest(req, deps.issuerUrl);
      return reply.send({
        resource: `${base}/mcp`,
        authorization_servers: [base],
      });
    },
  );

  app.get("/.well-known/oauth-protected-resource", async (req, reply) => {
    const base = baseUrlForRequest(req, deps.issuerUrl);
    return reply.send({
      resource: `${base}/mcp`,
      authorization_servers: [base],
    });
  });

  app.post("/oauth/register", async (req, reply) => {
    const ip = clientIp(req);
    const rate = checkRegisterRate(ip);
    if (!rate.allowed) {
      return reply
        .status(429)
        .header("Retry-After", String(rate.retryAfter))
        .send({
          error: "rate_limited",
          error_description: "Too many registration requests.",
        });
    }

    const parsed = RegisterBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "invalid_request",
        error_description: "Invalid registration body.",
        details: parsed.error.flatten(),
      });
    }

    for (const uri of parsed.data.redirect_uris) {
      if (!validateRedirectPrefix(uri, deps.allowedRedirectUriPrefixes)) {
        return reply.status(400).send({
          error: "invalid_redirect_uri",
          error_description: `redirect_uri not allowed: ${uri}`,
        });
      }
    }

    const result = await deps.service.registerClient({
      clientName: parsed.data.client_name,
      redirectUris: parsed.data.redirect_uris,
      grantTypes: parsed.data.grant_types,
    });

    const response: Record<string, unknown> = {
      client_id: result.clientId,
      client_name: result.clientName ?? null,
      redirect_uris: result.redirectUris,
      grant_types: result.grantTypes,
      token_endpoint_auth_method: result.clientSecret
        ? "client_secret_post"
        : "none",
    };
    if (result.clientSecret) {
      response["client_secret"] = result.clientSecret;
    }
    return reply.status(201).send(response);
  });

  app.get("/oauth/authorize", async (req, reply) => {
    const query = req.query as Record<string, string | undefined>;
    const responseType = query["response_type"];
    const clientId = query["client_id"];
    const redirectUri = query["redirect_uri"];
    const mcpState = query["state"];
    const codeChallenge = query["code_challenge"];
    const codeChallengeMethod = query["code_challenge_method"] ?? "S256";
    const requestedScope = query["scope"] ?? "";

    if (responseType !== "code") {
      throw BadRequest("Only response_type=code is supported.");
    }
    if (codeChallengeMethod !== "S256") {
      throw BadRequest("Only code_challenge_method=S256 is supported.");
    }
    if (!clientId || !redirectUri || !mcpState || !codeChallenge) {
      throw BadRequest("Missing required authorize parameters.");
    }

    const client = await deps.service.getClient(clientId);
    if (!client) throw BadRequest("Unknown client_id.");
    if (!client.redirectUris.includes(redirectUri)) {
      throw BadRequest("redirect_uri not registered.");
    }

    let scope: string;
    try {
      scope = deps.service.normalizeScope(requestedScope);
    } catch {
      throw BadRequest("invalid_scope");
    }

    const googleState = deps.service.generateGoogleState();
    await deps.service.savePendingAuthorize({
      googleState,
      clientId,
      redirectUri,
      mcpState,
      codeChallenge,
      codeChallengeMethod,
      scope,
    });

    const googleParams = new URLSearchParams({
      client_id: deps.googleWebClientId,
      redirect_uri: callbackUrl(baseUrlForRequest(req, deps.issuerUrl)),
      response_type: "code",
      scope: GOOGLE_SCOPES,
      state: googleState,
      prompt: "select_account",
    });
    if (deps.allowedGoogleDomains.length === 1) {
      const hd = deps.allowedGoogleDomains[0];
      if (hd) googleParams.set("hd", hd);
    }
    return reply.redirect(`${GOOGLE_AUTH_URL}?${googleParams.toString()}`, 302);
  });

  app.get("/oauth/callback/google", async (req, reply) => {
    const query = req.query as Record<string, string | undefined>;
    const code = query["code"];
    const state = query["state"];
    const errorParam = query["error"];

    if (errorParam) {
      return reply
        .status(400)
        .type("text/html; charset=utf-8")
        .send(oauthErrorPage({ status: 400, detail: errorParam }));
    }
    if (!code || !state) {
      return reply
        .status(400)
        .type("text/html; charset=utf-8")
        .send(
          oauthErrorPage({
            status: 400,
            detail: "Missing code or state.",
          }),
        );
    }

    const pending = await deps.service.popPendingAuthorize(state);
    if (!pending) {
      return reply
        .status(400)
        .type("text/html; charset=utf-8")
        .send(
          oauthErrorPage({
            status: 400,
            detail: "Invalid or expired state.",
          }),
        );
    }

    const callback = callbackUrl(baseUrlForRequest(req, deps.issuerUrl));
    const tokenResponse = await exchangeGoogleAuthorizationCode({
      code,
      redirectUri: callback,
      clientId: deps.googleWebClientId,
      clientSecret: deps.googleWebClientSecret,
    });
    if (!tokenResponse) {
      return reply
        .status(502)
        .type("text/html; charset=utf-8")
        .send(
          oauthErrorPage({
            status: 502,
            detail: "Google token exchange failed.",
          }),
        );
    }

    let identity;
    try {
      identity = await verifyGoogleIdToken(
        {
          clientId: deps.googleWebClientId,
          allowedDomains: deps.allowedGoogleDomains,
          resolveRole: deps.resolveRole,
        },
        tokenResponse.idToken,
      );
    } catch (error) {
      const reason = authFailureReason(error);
      const message =
        error instanceof CoreError ? error.message : "Google identity rejected.";
      const status = error instanceof CoreError ? error.status : 401;
      return reply
        .status(status)
        .type("text/html; charset=utf-8")
        .send(
          oauthErrorPage({
            status,
            detail: message,
            ...(reason ? { reason } : {}),
          }),
        );
    }

    const mcpCode = await deps.service.issueAuthorizationCode({
      clientId: pending.clientId,
      principalEmail: identity.email,
      redirectUri: pending.redirectUri,
      codeChallenge: pending.codeChallenge,
      codeChallengeMethod: pending.codeChallengeMethod,
      scopes: pending.scope,
    });

    const target = new URL(pending.redirectUri);
    target.searchParams.set("code", mcpCode);
    target.searchParams.set("state", pending.mcpState);
    target.searchParams.set(
      "iss",
      baseUrlForRequest(req, deps.issuerUrl).replace(/\/$/, ""),
    );

    return reply
      .status(200)
      .type("text/html; charset=utf-8")
      .send(
        oauthSuccessPage({
          redirectUrl: target.toString(),
          email: identity.email,
        }),
      );
  });

  app.post("/oauth/token", async (req, reply) => {
    const contentType = req.headers["content-type"] ?? "";
    let raw: unknown;
    if (typeof contentType === "string" && contentType.includes("application/x-www-form-urlencoded")) {
      raw = req.body;
    } else if (typeof contentType === "string" && contentType.includes("application/json")) {
      raw = req.body;
    } else {
      const err = oauthErrorResponse(
        "invalid_request",
        "Content-Type must be form-urlencoded or JSON.",
      );
      return reply.status(err.status).send(err.body);
    }

    const parsed = TokenFormBody.safeParse(raw);
    if (!parsed.success) {
      const err = oauthErrorResponse(
        "invalid_request",
        "Invalid token request body.",
      );
      return reply.status(err.status).send(err.body);
    }
    const data = parsed.data;
    const clientId = data.client_id;
    if (!clientId) {
      const err = oauthErrorResponse(
        "invalid_client",
        "client_id is required.",
        401,
      );
      return reply.status(err.status).send(err.body);
    }

    const client = await deps.service.authenticateClient(
      clientId,
      data.client_secret,
    );
    if (!client) {
      const err = oauthErrorResponse(
        "invalid_client",
        "Unknown client credentials.",
        401,
      );
      return reply.status(err.status).send(err.body);
    }

    if (data.grant_type === "authorization_code") {
      if (!data.code || !data.redirect_uri || !data.code_verifier) {
        const err = oauthErrorResponse(
          "invalid_request",
          "Missing required params.",
        );
        return reply.status(err.status).send(err.body);
      }
      const tokens = await deps.service.exchangeCode({
        code: data.code,
        clientId,
        codeVerifier: data.code_verifier,
        redirectUri: data.redirect_uri,
      });
      if (!tokens) {
        const err = oauthErrorResponse(
          "invalid_grant",
          "Invalid or expired authorization code.",
        );
        return reply.status(err.status).send(err.body);
      }
      return reply.send({
        access_token: tokens.accessToken,
        token_type: "bearer",
        expires_in: tokens.accessTokenExpiresInSeconds,
        refresh_token: tokens.refreshToken,
        scope: tokens.scopes,
      });
    }

    if (data.grant_type === "refresh_token") {
      if (!data.refresh_token) {
        const err = oauthErrorResponse(
          "invalid_request",
          "Missing refresh_token.",
        );
        return reply.status(err.status).send(err.body);
      }
      const tokens = await deps.service.refreshTokens({
        refreshToken: data.refresh_token,
        clientId,
      });
      if (!tokens) {
        const err = oauthErrorResponse(
          "invalid_grant",
          "Invalid or expired refresh token.",
        );
        return reply.status(err.status).send(err.body);
      }
      return reply.send({
        access_token: tokens.accessToken,
        token_type: "bearer",
        expires_in: tokens.accessTokenExpiresInSeconds,
        refresh_token: tokens.refreshToken,
        scope: tokens.scopes,
      });
    }

    const err = oauthErrorResponse(
      "unsupported_grant_type",
      `Unsupported: ${data.grant_type}`,
    );
    return reply.status(err.status).send(err.body);
  });

  app.post("/oauth/revoke", async (req, reply) => {
    const body = req.body as Record<string, unknown> | undefined;
    const token = typeof body?.["token"] === "string" ? (body["token"] as string) : "";
    if (!token) return reply.status(400).send({ error: "invalid_request" });
    await deps.service.revokeToken(token);
    return reply.send({});
  });
};
