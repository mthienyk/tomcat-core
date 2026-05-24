import "dotenv/config";
import { decodeJwtExp, resolveStoredGoogleIdToken } from "../src/auth/googleOAuthSession.js";
import { loadConfig } from "../src/config/env.js";

const formatExpiry = (token: string): string => {
  const exp = decodeJwtExp(token);
  if (exp === undefined) return "unknown";
  return new Date(exp * 1000).toLocaleString();
};

const main = async (): Promise<void> => {
  const config = loadConfig();
  if (!config.auth.googleOAuthClientId) {
    process.stderr.write(
      "GOOGLE_OAUTH_CLIENT_ID is not set. Remote MCP requires Google auth.\n",
    );
    process.exit(1);
  }

  const token = await resolveStoredGoogleIdToken();
  const coreUrl =
    process.env["CORE_URL"]?.trim()
    ?? "https://tomcatcore91c5e290-api.functions.fnc.fr-par.scw.cloud";
  const expiresAt = formatExpiry(token);

  process.stdout.write(`${token}\n\n`);
  process.stdout.write(
    [
      `Token expires: ${expiresAt}`,
      "",
      "Remote MCP (Scaleway) uses a static Bearer in Cursor. When it expires:",
      "  1. npm run auth:token",
      "  2. Update Authorization in ~/.cursor/mcp.json",
      "",
      "Local stdio MCP refreshes automatically from .secrets/ (no manual step).",
      "",
      "Cursor ~/.cursor/mcp.json remote snippet:",
      "{",
      '  "mcpServers": {',
      '    "tomcat-core-remote": {',
      `      "url": "${coreUrl}/mcp",`,
      '      "headers": {',
      `        "Authorization": "Bearer ${token}"`,
      "      }",
      "    }",
      "  }",
      "}",
    ].join("\n"),
  );
};

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\nRun: npm run auth:google\n`);
  process.exit(1);
});
