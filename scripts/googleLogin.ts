import "dotenv/config";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { OAuth2Client } from "google-auth-library";
import {
  buildSessionFromTokens,
  loadGoogleOAuthSession,
  loadOAuthClientCredentials,
  saveGoogleOAuthSession,
} from "../src/auth/googleOAuthSession.js";
import { oauthErrorPage, oauthSuccessPage } from "../src/auth/oauthCallbackPages.js";

const execFileAsync = promisify(execFile);

const SCOPES = ["openid", "email", "profile"];
const LOOPBACK_PORT = 8765;
const REDIRECT_URI = `http://localhost:${LOOPBACK_PORT}/oauth2callback`;

const openBrowser = async (url: string): Promise<void> => {
  if (process.platform === "darwin") {
    await execFileAsync("open", [url]);
    return;
  }
  if (process.platform === "win32") {
    await execFileAsync("cmd", ["/c", "start", "", url]);
    return;
  }
  await execFileAsync("xdg-open", [url]);
};

const waitForAuthCode = (): Promise<string> =>
  new Promise((resolvePromise, reject) => {
    const server = createServer((req, res) => {
      const requestUrl = new URL(req.url ?? "/", `http://localhost:${LOOPBACK_PORT}`);
      if (requestUrl.pathname !== "/oauth2callback") {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      const error = requestUrl.searchParams.get("error");
      if (error) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end(oauthErrorPage(error));
        server.close();
        reject(new Error(error));
        return;
      }

      const code = requestUrl.searchParams.get("code");
      if (!code) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end(oauthErrorPage("Missing authorization code."));
        server.close();
        reject(new Error("Missing authorization code"));
        return;
      }

      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(oauthSuccessPage("cli"));
      server.close();
      resolvePromise(code);
    });

    server.listen(LOOPBACK_PORT, "127.0.0.1");
    server.on("error", reject);
  });

const probeMe = async (coreUrl: string, idToken: string): Promise<void> => {
  const response = await fetch(`${coreUrl.replace(/\/$/, "")}/me`, {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  const body = await response.text();
  process.stderr.write(`\nGET ${coreUrl}/me → HTTP ${response.status}\n${body}\n`);
};

const decodeJwtEmail = (jwt: string): string | undefined => {
  const parts = jwt.split(".");
  if (parts.length !== 3) return undefined;
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1] ?? "", "base64url").toString("utf8"),
    ) as { email?: unknown };
    return typeof payload.email === "string" ? payload.email : undefined;
  } catch {
    return undefined;
  }
};

const main = async (): Promise<void> => {
  const { clientId, clientSecret } = loadOAuthClientCredentials();
  const oauth2 = new OAuth2Client(clientId, clientSecret, REDIRECT_URI);
  const hostedDomain =
    process.env["ALLOWED_GOOGLE_DOMAINS"]?.split(",")[0]?.trim() ?? "tomcat.eu";
  const existingSession = loadGoogleOAuthSession();

  const authUrl = oauth2.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: existingSession?.refreshToken ? "select_account" : "consent",
    redirect_uri: REDIRECT_URI,
    hd: hostedDomain,
  });

  process.stderr.write(
    `Ouvre ton navigateur et connecte-toi avec @${hostedDomain}.\n`
    + "Seuls les comptes Workspace Tomcat peuvent obtenir un token (app Internal).\n\n",
  );

  const codePromise = waitForAuthCode();
  await openBrowser(authUrl);
  const code = await codePromise;

  const { tokens } = await oauth2.getToken({ code, redirect_uri: REDIRECT_URI });
  const idToken = tokens.id_token;
  if (!idToken) {
    throw new Error("Google did not return an id_token.");
  }

  const session = buildSessionFromTokens(
    idToken,
    tokens.refresh_token ?? undefined,
    decodeJwtEmail(idToken),
  );
  saveGoogleOAuthSession(session);

  process.stderr.write(
    "Saved session to .secrets/google-oauth-session.json "
    + `(expires ~${new Date(session.idTokenExpiresAt * 1000).toLocaleTimeString()}).\n`
    + `Refresh token: ${session.refreshToken ? "yes" : "missing — retry login"}\n`,
  );

  const coreUrl = process.env["CORE_URL"];
  if (coreUrl) {
    await probeMe(coreUrl, idToken);
  } else {
    process.stderr.write(
      "\nTip: export CORE_URL=https://tomcatcore91c5e290-api.functions.fnc.fr-par.scw.cloud "
      + "to probe /me automatically.\n",
    );
  }
};

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
