const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

export type GoogleTokenExchangeOptions = {
  code: string;
  redirectUri: string;
  clientId: string;
  clientSecret: string;
};

export type GoogleTokenExchangeResult = {
  idToken: string;
  accessToken: string | undefined;
};

export const exchangeGoogleAuthorizationCode = async (
  opts: GoogleTokenExchangeOptions,
): Promise<GoogleTokenExchangeResult | undefined> => {
  const body = new URLSearchParams({
    code: opts.code,
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
    redirect_uri: opts.redirectUri,
    grant_type: "authorization_code",
  });

  let response: Response;
  try {
    response = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
  } catch {
    return undefined;
  }

  if (!response.ok) return undefined;
  const json = (await response.json()) as {
    id_token?: string;
    access_token?: string;
  };
  if (!json.id_token) return undefined;
  return {
    idToken: json.id_token,
    accessToken: json.access_token,
  };
};
