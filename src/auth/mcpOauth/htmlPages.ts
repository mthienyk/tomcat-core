const escape = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const FONT_LINK =
  "https://fonts.googleapis.com/css2"
  + "?family=JetBrains+Mono:wght@400;500"
  + "&family=Plus+Jakarta+Sans:wght@400;500;600;700"
  + "&display=swap";

const TOMCAT_LOGO = `<svg class="logo" viewBox="0 0 141 34" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="Tomcat" role="img">
<path d="M43.1742 12.7647H38.5573V10.0575H51.1302V12.7647H46.5133V24.4137H43.1742V12.7647Z" fill="currentColor"/>
<path d="M61.774 24.6598C60.2762 24.6598 58.9227 24.3385 57.7135 23.6958C56.5181 23.0532 55.5768 22.1714 54.8897 21.0502C54.2164 19.9154 53.8798 18.6439 53.8798 17.2356C53.8798 15.8273 54.2164 14.5626 54.8897 13.4415C55.5768 12.3066 56.5181 11.4179 57.7135 10.7753C58.9227 10.1327 60.2762 9.8114 61.774 9.8114C63.2717 9.8114 64.6184 10.1327 65.8138 10.7753C67.0093 11.4179 67.9506 12.3066 68.6376 13.4415C69.3247 14.5626 69.6682 15.8273 69.6682 17.2356C69.6682 18.6439 69.3247 19.9154 68.6376 21.0502C67.9506 22.1714 67.0093 23.0532 65.8138 23.6958C64.6184 24.3385 63.2717 24.6598 61.774 24.6598ZM61.774 21.8295C62.6259 21.8295 63.3954 21.6381 64.0825 21.2553C64.7695 20.8588 65.3054 20.3119 65.6902 19.6146C66.0887 18.9173 66.2879 18.1243 66.2879 17.2356C66.2879 16.3469 66.0887 15.5539 65.6902 14.8566C65.3054 14.1593 64.7695 13.6192 64.0825 13.2364C63.3954 12.8399 62.6259 12.6416 61.774 12.6416C60.922 12.6416 60.1525 12.8399 59.4655 13.2364C58.7784 13.6192 58.2357 14.1593 57.8372 14.8566C57.4524 15.5539 57.2601 16.3469 57.2601 17.2356C57.2601 18.1243 57.4524 18.9173 57.8372 19.6146C58.2357 20.3119 58.7784 20.8588 59.4655 21.2553C60.1525 21.6381 60.922 21.8295 61.774 21.8295Z" fill="currentColor"/>
<path d="M87.3683 24.4137L87.3477 15.8L83.1017 22.896H81.5971L77.3717 15.9845V24.4137H74.2388V10.0575H77.0007L82.4009 18.9788L87.7187 10.0575H90.46L90.5012 24.4137H87.3683Z" fill="currentColor"/>
<path d="M102.89 24.6598C101.42 24.6598 100.087 24.3453 98.8917 23.7164C97.71 23.0737 96.7756 22.1919 96.0885 21.0707C95.4152 19.9359 95.0786 18.6575 95.0786 17.2356C95.0786 15.8136 95.4152 14.5421 96.0885 13.4209C96.7756 12.2861 97.71 11.4043 98.8917 10.7753C100.087 10.1327 101.427 9.8114 102.911 9.8114C104.161 9.8114 105.288 10.0302 106.291 10.4677C107.308 10.9052 108.16 11.5341 108.847 12.3545L106.703 14.3233C105.728 13.2022 104.519 12.6416 103.076 12.6416C102.183 12.6416 101.386 12.8399 100.685 13.2364C99.9841 13.6192 99.4345 14.1593 99.036 14.8566C98.6512 15.5539 98.4589 16.3469 98.4589 17.2356C98.4589 18.1243 98.6512 18.9173 99.036 19.6146C99.4345 20.3119 99.9841 20.8588 100.685 21.2553C101.386 21.6381 102.183 21.8295 103.076 21.8295C104.519 21.8295 105.728 21.2621 106.703 20.1273L108.847 22.0962C108.16 22.9302 107.308 23.566 106.291 24.0035C105.274 24.441 104.141 24.6598 102.89 24.6598Z" fill="currentColor"/>
<path d="M122.383 21.3373H115.684L114.407 24.4137H110.985L117.416 10.0575H120.714L127.165 24.4137H123.661L122.383 21.3373ZM121.332 18.8148L119.044 13.3184L116.756 18.8148H121.332Z" fill="currentColor"/>
<path d="M132.987 12.7647H128.37V10.0575H140.943V12.7647H136.326V24.4137H132.987V12.7647Z" fill="currentColor"/>
<ellipse cx="17.0388" cy="17.0303" rx="17.0388" ry="16.9539" fill="currentColor"/>
<mask id="tc-logo-mask" style="mask-type:alpha" maskUnits="userSpaceOnUse" x="0" y="0" width="35" height="34">
<ellipse cx="17.0388" cy="17.0303" rx="17.0388" ry="16.9539" fill="currentColor"/>
</mask>
<g mask="url(#tc-logo-mask)">
<path d="M19.3738 24.3856L35.2418 -2.50082L44.2249 -3.0578L19.3738 24.3856Z" fill="#F57300"/>
<path d="M9.53863 24.3808L28.3008 -5.64008L37.6605 -4.08061L9.53863 24.3808Z" fill="#F57300"/>
</g>
</svg>`;

const baseStyles = `
:root{
  --ink:#182062;--paper:#faf8f4;--paper-2:#f2ede4;
  --orange:#f57300;
  --muted:rgba(24,32,98,.58);--muted-2:rgba(24,32,98,.4);
  --line:rgba(24,32,98,.1);--line-strong:rgba(24,32,98,.16);
  --shadow:0 12px 40px -16px rgba(11,19,45,.14);
  --ease-out:cubic-bezier(.16,1,.3,1);
  --font-sans:"Plus Jakarta Sans",-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;
  --font-mono:"JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,monospace;
}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html,body{min-height:100dvh}
body{
  font-family:var(--font-sans);font-size:16px;line-height:1.5;color:var(--ink);
  background:var(--paper);-webkit-font-smoothing:antialiased;
}
.shell{
  min-height:100dvh;display:flex;align-items:center;justify-content:center;
  padding:32px 24px;
}
.panel{
  width:min(420px,100%);background:#fff;border:1px solid var(--line-strong);
  border-radius:24px;padding:32px 28px 28px;box-shadow:var(--shadow);
  animation:fadeUp 600ms var(--ease-out) both;
}
.brand{margin-bottom:24px;color:var(--ink)}
.brand .logo{height:24px;width:auto;display:block}
.brand-cap{
  display:block;margin-top:10px;font-family:var(--font-mono);
  font-size:10px;font-weight:500;letter-spacing:.14em;
  text-transform:uppercase;color:var(--muted-2);
}
h1{
  margin:0 0 24px;font-size:26px;font-weight:600;letter-spacing:-.03em;
  line-height:1.15;color:var(--ink);
}
.facts{
  display:grid;gap:18px;margin:0 0 24px;padding:0;list-style:none;
}
.fact{display:grid;gap:6px}
.fact-label{
  font-family:var(--font-mono);font-size:10px;font-weight:500;
  letter-spacing:.12em;text-transform:uppercase;color:var(--muted-2);
}
.fact-label::before{content:"· ";color:var(--line-strong)}
.fact-value{font-size:15px;line-height:1.45;color:var(--ink)}
.fact-value.mono{
  font-family:var(--font-mono);font-size:13px;font-weight:500;
  word-break:break-all;
}
.next{
  padding:16px 18px;border-radius:14px;border:1px solid var(--line);
  background:var(--paper-2);
}
.next[role="status"]{outline:none}
.next-title{
  display:flex;align-items:center;gap:10px;
  font-size:15px;font-weight:600;letter-spacing:-.02em;color:var(--ink);
}
.next-live{
  font-family:var(--font-mono);font-size:13px;color:var(--orange);line-height:1;
}
.next-detail{margin-top:6px;font-size:13px;line-height:1.45;color:var(--muted)}
.fallback{
  display:none;margin-top:20px;padding-top:18px;border-top:1px solid var(--line);
}
.fallback.visible{display:block}
.fallback p{margin:0 0 10px;font-size:13px;color:var(--muted)}
.fallback a{
  font-family:var(--font-mono);font-size:13px;font-weight:500;
  color:var(--orange);text-decoration:none;
}
.fallback a:hover{text-decoration:underline;text-underline-offset:2px}
.error-body{margin:0 0 20px;font-size:15px;line-height:1.55;color:var(--muted)}
.error-body strong{color:var(--ink);font-weight:600}
.error-action{
  margin:0 0 20px;padding:14px 16px;border-radius:14px;
  border:1px solid rgba(220,38,38,.28);background:#fdf6f6;
  font-size:14px;line-height:1.5;color:#7f1d1d;
}
.error-code{
  margin-top:20px;font-family:var(--font-mono);font-size:10px;
  letter-spacing:.08em;color:var(--line-strong);
}
@keyframes fadeUp{
  from{opacity:0;transform:translateY(10px)}
  to{opacity:1;transform:translateY(0)}
}
@media (prefers-reduced-motion:reduce){.panel{animation:none}}
`;

const pageShell = (params: {
  title: string;
  productLabel: string;
  body: string;
  redirectScript?: string;
}): string => `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#182062">
<title>Tomcat — ${escape(params.title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONT_LINK}">
<style>${baseStyles}</style>
</head>
<body>
<div class="shell">
  <main class="panel">
    <header class="brand">
      ${TOMCAT_LOGO}
      <span class="brand-cap">${escape(params.productLabel)}</span>
    </header>
    ${params.body}
  </main>
</div>
${params.redirectScript ?? ""}
</body>
</html>`;

export const oauthSuccessPage = (params: {
  redirectUrl: string;
  email: string;
}): string => {
  const safeEmail = escape(params.email);
  const safeUrl = escape(params.redirectUrl);
  const jsUrl = JSON.stringify(params.redirectUrl);
  const body = `
    <h1>Vous êtes connecté</h1>
    <ul class="facts">
      <li class="fact">
        <span class="fact-label">Compte</span>
        <span class="fact-value mono">${safeEmail}</span>
      </li>
      <li class="fact">
        <span class="fact-label">Accès</span>
        <span class="fact-value">Tomcat Core via Cursor</span>
      </li>
    </ul>
    <div class="next" role="status" aria-live="polite">
      <p class="next-title">
        <span class="next-live" aria-hidden="true">●</span>
        Ouverture de Cursor
      </p>
      <p class="next-detail">Redirection automatique en cours.</p>
    </div>
    <div class="fallback" id="fallback">
      <p>Rien ne se passe&nbsp;?</p>
      <a href="${safeUrl}">Continuer vers Cursor</a>
    </div>`;
  const redirectScript = `<script>
setTimeout(function(){window.location.replace(${jsUrl})},300);
setTimeout(function(){
  var el=document.getElementById("fallback");
  if(el){el.classList.add("visible")}
},3000);
</script>`;
  return pageShell({
    title: "Connexion réussie",
    productLabel: "Tomcat Core",
    body,
    redirectScript,
  });
};

export const oauthErrorPage = (params: {
  status: number;
  detail: string;
  reason?: string;
}): string => {
  let title = "Connexion impossible";
  let action = "Fermez cet onglet et relancez la connexion depuis Cursor.";
  let detail = escape(params.detail);

  if (params.reason === "access_revoked") {
    title = "Accès désactivé";
    action =
      "Votre accès Tomcat Core a été révoqué. "
      + "Contactez un administrateur pour le rétablir.";
  } else if (params.reason === "user_not_provisioned") {
    title = "Compte non autorisé";
    action =
      "Seuls les comptes <strong>@tomcat.eu</strong> peuvent se connecter. "
      + "Utilisez votre adresse professionnelle Tomcat.";
  } else if (params.status === 400 && params.detail.includes("state")) {
    title = "Session expirée";
    action =
      "La fenêtre de connexion a expiré. "
      + "Relancez l'authentification depuis Cursor.";
  }

  const htmlBody = `
    <h1>${escape(title)}</h1>
    <p class="error-body">${detail}</p>
    <p class="error-action">${action}</p>
    <p class="error-code" aria-hidden="true">· ref ${params.status} ·</p>`;

  return pageShell({
    title,
    productLabel: "Tomcat Core",
    body: htmlBody,
  });
};
