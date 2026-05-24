import "dotenv/config";
import {
  describeGoogleAuthStatus,
  isIdTokenFresh,
  loadGoogleOAuthSession,
} from "../src/auth/googleOAuthSession.js";

const main = (): void => {
  const status = describeGoogleAuthStatus();
  if (!status.loggedIn) {
    process.stderr.write(
      "Google session: not signed in.\n"
      + "Run: npm run auth:google\n",
    );
    process.exit(1);
  }

  const session = loadGoogleOAuthSession();
  const lines = [
    "Google session: signed in",
    `  email: ${status.email ?? "(unknown)"}`,
    `  id token: ${status.idTokenFresh ? "fresh" : "expired (stdio MCP will refresh automatically)"}`,
    `  expires: ${status.idTokenExpiresAt ?? "unknown"}`,
    `  refresh token: ${status.hasRefreshToken ? "yes" : "no — run npm run auth:google"}`,
    `  file: ${status.sessionPath}`,
    "  remote MCP: run npm run auth:token when Cursor Bearer expires (~1h)",
  ];
  process.stdout.write(`${lines.join("\n")}\n`);

  if (session && !status.hasRefreshToken) {
    process.exit(1);
  }
  if (session && !isIdTokenFresh(session.idToken) && !status.hasRefreshToken) {
    process.exit(1);
  }
};

main();
