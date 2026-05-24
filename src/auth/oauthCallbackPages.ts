export type OAuthCallbackContext = "cli" | "browser";

const baseStyles = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    min-height: 100vh;
    display: grid;
    place-items: center;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: #f6f5f2;
    color: #1a1a18;
    padding: 24px;
  }
  .card {
    width: min(420px, 100%);
    background: #fff;
    border: 1px solid #e8e6e1;
    border-radius: 12px;
    padding: 32px 28px;
    text-align: center;
    box-shadow: 0 8px 32px rgba(26, 26, 24, 0.06);
  }
  .mark {
    width: 44px;
    height: 44px;
    margin: 0 auto 20px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    font-size: 20px;
    font-weight: 600;
  }
  .mark.ok { background: #e8f5ec; color: #1f6b3a; }
  .mark.err { background: #fdecea; color: #9b2c2c; }
  .brand {
    font-size: 11px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: #8a8780;
    margin-bottom: 8px;
  }
  h1 {
    font-size: 20px;
    font-weight: 600;
    line-height: 1.3;
    margin-bottom: 10px;
  }
  p {
    font-size: 14px;
    line-height: 1.55;
    color: #5c5954;
  }
  .hint {
    margin-top: 18px;
    padding-top: 18px;
    border-top: 1px solid #eeece7;
    font-size: 13px;
    color: #8a8780;
  }
`;

export const oauthSuccessPage = (context: OAuthCallbackContext = "cli"): string => {
  const subtitle =
    context === "cli"
      ? "You can close this window and return to your terminal."
      : "You can close this window and return to Tomcat.";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Signed in · Tomcat</title>
  <style>${baseStyles}</style>
</head>
<body>
  <main class="card">
    <p class="brand">Tomcat</p>
    <div class="mark ok" aria-hidden="true">✓</div>
    <h1>Signed in successfully</h1>
    <p>${subtitle}</p>
    <p class="hint">This tab can be closed safely.</p>
  </main>
</body>
</html>`;
};

export const oauthErrorPage = (message: string): string => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Sign-in failed · Tomcat</title>
  <style>${baseStyles}</style>
</head>
<body>
  <main class="card">
    <p class="brand">Tomcat</p>
    <div class="mark err" aria-hidden="true">!</div>
    <h1>Sign-in failed</h1>
    <p>${escapeHtml(message)}</p>
    <p class="hint">Close this window and try again from your application.</p>
  </main>
</body>
</html>`;

const escapeHtml = (raw: string): string =>
  raw
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
