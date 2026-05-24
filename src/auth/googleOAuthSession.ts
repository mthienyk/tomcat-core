import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { OAuth2Client } from "google-auth-library";

export type GoogleOAuthSession = {
  idToken: string;
  refreshToken: string | undefined;
  idTokenExpiresAt: number;
  email: string | undefined;
  updatedAt: string;
};

type InstalledClientJson = {
  installed?: {
    client_id?: string;
    client_secret?: string;
  };
};

const DEFAULT_SESSION_FILE = ".secrets/google-oauth-session.json";
const DEFAULT_CLIENT_FILE = ".secrets/google-oauth-desktop.json";
const LOOPBACK_REDIRECT_URI = "http://localhost:8765/oauth2callback";
const REFRESH_SKEW_SECONDS = 60;

export const sessionFilePath = (): string =>
  resolve(process.cwd(), process.env["GOOGLE_OAUTH_SESSION_FILE"] ?? DEFAULT_SESSION_FILE);

export const loadOAuthClientCredentials = (): { clientId: string; clientSecret: string } => {
  const clientId = process.env["GOOGLE_OAUTH_CLIENT_ID"];
  const secretFromEnv = process.env["GOOGLE_OAUTH_CLIENT_SECRET"];
  const filePath = process.env["GOOGLE_OAUTH_CLIENT_FILE"] ?? DEFAULT_CLIENT_FILE;

  if (filePath) {
    const absolute = resolve(process.cwd(), filePath);
    const raw = JSON.parse(readFileSync(absolute, "utf8")) as InstalledClientJson;
    const installed = raw.installed;
    if (!installed?.client_id || !installed.client_secret) {
      throw new Error(`Invalid OAuth client file: ${absolute}`);
    }
    return { clientId: installed.client_id, clientSecret: installed.client_secret };
  }

  if (clientId && secretFromEnv) {
    return { clientId, clientSecret: secretFromEnv };
  }

  throw new Error(
    "Set GOOGLE_OAUTH_CLIENT_FILE or GOOGLE_OAUTH_CLIENT_ID + GOOGLE_OAUTH_CLIENT_SECRET.",
  );
};

export const decodeJwtExp = (jwt: string): number | undefined => {
  const parts = jwt.split(".");
  if (parts.length !== 3) return undefined;
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1] ?? "", "base64url").toString("utf8"),
    ) as { exp?: unknown };
    return typeof payload.exp === "number" ? payload.exp : undefined;
  } catch {
    return undefined;
  }
};

export const isIdTokenFresh = (
  idToken: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean => {
  const exp = decodeJwtExp(idToken);
  if (exp === undefined) return false;
  return exp - REFRESH_SKEW_SECONDS > nowSeconds;
};

export const loadGoogleOAuthSession = (): GoogleOAuthSession | undefined => {
  try {
    const raw = readFileSync(sessionFilePath(), "utf8");
    const parsed = JSON.parse(raw) as GoogleOAuthSession;
    if (!parsed.idToken) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
};

export const saveGoogleOAuthSession = (session: GoogleOAuthSession): void => {
  const path = sessionFilePath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(session, null, 2)}\n`, { mode: 0o600 });

  const legacyTokenFile =
    process.env["GOOGLE_ID_TOKEN_FILE"] ?? ".secrets/google-id-token";
  const legacyPath = resolve(process.cwd(), legacyTokenFile);
  mkdirSync(dirname(legacyPath), { recursive: true });
  writeFileSync(legacyPath, `${session.idToken}\n`, { mode: 0o600 });
};

export const buildSessionFromTokens = (
  idToken: string,
  refreshToken: string | undefined,
  email?: string,
): GoogleOAuthSession => ({
  idToken,
  refreshToken,
  idTokenExpiresAt: decodeJwtExp(idToken) ?? 0,
  email,
  updatedAt: new Date().toISOString(),
});

export const refreshGoogleIdToken = async (
  session: GoogleOAuthSession,
): Promise<GoogleOAuthSession> => {
  if (!session.refreshToken) {
    throw new Error("No refresh token saved. Run: npm run auth:google");
  }

  const { clientId, clientSecret } = loadOAuthClientCredentials();
  const oauth2 = new OAuth2Client(clientId, clientSecret, LOOPBACK_REDIRECT_URI);
  oauth2.setCredentials({ refresh_token: session.refreshToken });

  let credentials;
  try {
    const response = await oauth2.refreshAccessToken();
    credentials = response.credentials;
  } catch {
    throw new Error(
      "Google session expired or revoked. Run: npm run auth:google",
    );
  }

  const idToken = credentials.id_token;
  if (!idToken) {
    throw new Error(
      "Google refresh did not return an id_token. Run: npm run auth:google",
    );
  }

  return buildSessionFromTokens(
    idToken,
    credentials.refresh_token ?? session.refreshToken,
    session.email,
  );
};

export type GoogleAuthStatus = {
  loggedIn: boolean;
  email: string | undefined;
  idTokenFresh: boolean;
  idTokenExpiresAt: string | undefined;
  hasRefreshToken: boolean;
  sessionPath: string;
};

export const describeGoogleAuthStatus = (): GoogleAuthStatus => {
  const session = loadGoogleOAuthSession();
  const sessionPath = sessionFilePath();
  if (!session) {
    return {
      loggedIn: false,
      email: undefined,
      idTokenFresh: false,
      idTokenExpiresAt: undefined,
      hasRefreshToken: false,
      sessionPath,
    };
  }

  const fresh = isIdTokenFresh(session.idToken);
  return {
    loggedIn: true,
    email: session.email,
    idTokenFresh: fresh,
    idTokenExpiresAt:
      session.idTokenExpiresAt > 0
        ? new Date(session.idTokenExpiresAt * 1000).toISOString()
        : undefined,
    hasRefreshToken: Boolean(session.refreshToken),
    sessionPath,
  };
};

export const clearGoogleOAuthSession = (): void => {
  for (const file of [
    sessionFilePath(),
    resolve(
      process.cwd(),
      process.env["GOOGLE_ID_TOKEN_FILE"] ?? ".secrets/google-id-token",
    ),
  ]) {
    try {
      unlinkSync(file);
    } catch {
      // ignore missing files
    }
  }
};

export const resolveStoredGoogleIdToken = async (): Promise<string> => {
  const legacyFile =
    process.env["GOOGLE_ID_TOKEN_FILE"] ?? ".secrets/google-id-token";
  let session = loadGoogleOAuthSession();

  if (!session) {
    try {
      const legacyToken = readFileSync(resolve(process.cwd(), legacyFile), "utf8").trim();
      if (legacyToken && isIdTokenFresh(legacyToken)) {
        return legacyToken;
      }
    } catch {
      // fall through
    }
    throw new Error(
      "Google auth required. Run: npm run auth:google "
      + "(writes .secrets/google-oauth-session.json).",
    );
  }

  if (isIdTokenFresh(session.idToken)) {
    return session.idToken;
  }

  const refreshed = await refreshGoogleIdToken(session);
  saveGoogleOAuthSession(refreshed);
  return refreshed.idToken;
};
