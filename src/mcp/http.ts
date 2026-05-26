import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { CoreError, Forbidden } from "../errors/index.js";
import { can } from "../permissions/policies.js";
import type { AuthMiddleware } from "../api/middlewareTypes.js";
import type { AgentToolServices } from "../agent/toolRegistry.js";
import type { Auditor } from "../audit/audit.js";
import type { HumanIdentity, Identity } from "../domain/identity.js";
import { authFailureReason, mcpSessionExpiredMessage } from "../auth/authHints.js";
import { buildMcpAgentServer } from "./server.js";

export type McpHttpRouteDeps = {
  services: AgentToolServices;
  auditor: Auditor;
  auth: AuthMiddleware;
  resourceMetadataBaseUrl?: string;
  signalHubEnabled?: boolean;
};

const buildMcpWwwAuthenticate = (
  req: FastifyRequest,
  fallback: string | undefined,
  authError?: CoreError,
): string => {
  const forwardedHost = req.headers["x-forwarded-host"];
  const host = Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost;
  let base: string;
  if (host) {
    const proto = (req.headers["x-forwarded-proto"] as string) ?? "https";
    base = `${proto}://${host}`;
  } else if (fallback) {
    base = fallback.replace(/\/$/, "");
  } else {
    base = "";
  }
  const metadataUrl = base
    ? `${base}/.well-known/oauth-protected-resource`
    : "/.well-known/oauth-protected-resource";

  const reason = authError ? authFailureReason(authError) : undefined;
  if (reason === "access_revoked") {
    const description = encodeURIComponent(authError?.message ?? "Access revoked");
    return `Bearer error="access_denied", error_description="${description}", resource_metadata="${metadataUrl}"`;
  }
  if (reason === "invalid_token") {
    const description = encodeURIComponent(mcpSessionExpiredMessage);
    return `Bearer error="invalid_token", error_description="${description}", resource_metadata="${metadataUrl}"`;
  }

  return `Bearer realm="mcp", resource_metadata="${metadataUrl}"`;
};

const isHumanMcpCaller = (identity: Identity | undefined): identity is HumanIdentity =>
  identity?.kind === "human" && can(identity, "ai.query");

const writeHijackedError = (
  reply: FastifyReply,
  status: number,
  payload: Record<string, unknown>,
): void => {
  if (reply.raw.headersSent) return;
  reply.raw.statusCode = status;
  reply.raw.setHeader("Content-Type", "application/json");
  reply.raw.end(JSON.stringify(payload));
};

const mcpForbiddenMessage = (identity: Identity | undefined): string => {
  if (identity?.kind === "service") {
    return "MCP remote access requires a Google @tomcat.eu account. Service tokens are not supported on /mcp.";
  }
  if (identity?.kind === "human" && !can(identity, "ai.query")) {
    return "MCP remote access requires an internal Tomcat role with ai.query permission.";
  }
  return "MCP remote access requires a signed-in @tomcat.eu Google account.";
};

const requireMcpAccess =
  (auth: AuthMiddleware) =>
  async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    await auth.authenticate(req, reply);
    if (!isHumanMcpCaller(req.identity)) {
      throw Forbidden(mcpForbiddenMessage(req.identity), {
        reason: "mcp_access_denied",
        nextAction:
          req.identity?.kind === "service"
            ? "use_google_bearer_token"
            : "run_npm_auth_token",
      });
    }
  };

export const handleMcpHttpRequest = async (
  deps: McpHttpRouteDeps,
  identity: HumanIdentity,
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> => {
  const transport = new StreamableHTTPServerTransport({
    enableJsonResponse: true,
  });
  const mcpServer = buildMcpAgentServer({
    services: deps.services,
    resolveCaller: async () => identity,
    auditor: deps.auditor,
    signalHubEnabled: deps.signalHubEnabled ?? false,
  });

  reply.hijack();

  try {
    await mcpServer.connect(transport as Transport);
    await transport.handleRequest(req.raw, reply.raw, req.body);
  } catch (error) {
    writeHijackedError(reply, 500, {
      error: {
        code: "INTERNAL",
        message: "MCP request failed.",
        details:
          error instanceof Error ? { reason: error.message } : undefined,
      },
    });
  } finally {
    await mcpServer.close().catch(() => undefined);
    await transport.close().catch(() => undefined);
  }
};

export const registerMcpHttpRoutes = (
  app: FastifyInstance,
  deps: McpHttpRouteDeps,
): void => {
  const preHandler = requireMcpAccess(deps.auth);

  app.all("/mcp", async (req, reply) => {
    if (req.method === "OPTIONS") {
      await reply.status(204).send();
      return;
    }

    reply.header(
      "WWW-Authenticate",
      buildMcpWwwAuthenticate(req, deps.resourceMetadataBaseUrl),
    );

    try {
      await preHandler(req, reply);
    } catch (error) {
      if (
        error instanceof CoreError
        && (error.code === "AUTH_REQUIRED" || error.code === "AUTH_INVALID")
      ) {
        reply.header(
          "WWW-Authenticate",
          buildMcpWwwAuthenticate(req, deps.resourceMetadataBaseUrl, error),
        );
      }
      throw error;
    }
    if (!isHumanMcpCaller(req.identity)) {
      throw Forbidden(mcpForbiddenMessage(req.identity), {
        reason: "mcp_access_denied",
        nextAction: "run_npm_auth_token",
      });
    }
    await handleMcpHttpRequest(deps, req.identity, req, reply);
  });
};
