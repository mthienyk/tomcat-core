const escape = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const baseStyles = `
*{margin:0;padding:0;box-sizing:border-box}
body{
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
  background:#f6f5f1;color:#1a1a1a;
  display:flex;align-items:center;justify-content:center;
  min-height:100vh;padding:2rem;
}
.card{
  background:#fff;border-radius:14px;padding:2.5rem;
  max-width:480px;width:100%;
  box-shadow:0 4px 28px rgba(0,0,0,.06);
  text-align:center;
}
.icon{
  width:48px;height:48px;margin:0 auto 1.25rem;
  border-radius:50%;
  display:flex;align-items:center;justify-content:center;
  font-size:1.4rem;
}
h1{font-size:1.2rem;margin-bottom:.5rem;font-weight:600;letter-spacing:-.01em}
.sub{color:#555;margin-bottom:1.5rem;font-size:.95rem;line-height:1.55}
.note{margin-top:1.25rem;font-size:.8rem;color:#888;line-height:1.5}
a{color:#1a73e8;text-decoration:none}
a:hover{text-decoration:underline}
`;

export const oauthSuccessPage = (params: {
  redirectUrl: string;
  email: string;
}): string => {
  const safeName = escape(params.email);
  const safeUrl = escape(params.redirectUrl);
  const jsUrl = JSON.stringify(params.redirectUrl);
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>Tomcat Core — Connexion réussie</title>
<style>${baseStyles}
.icon{background:#e7f4ec;color:#1e7e34}
</style>
</head>
<body>
<div class="card">
  <div class="icon">&#10003;</div>
  <h1>Connexion réussie</h1>
  <p class="sub">
    Bienvenue, <strong>${safeName}</strong>.<br>
    Retour vers Cursor en cours.
  </p>
  <p class="note">
    Vous pouvez fermer cet onglet.<br>
    <a href="${safeUrl}" id="fallback" style="display:none">
      Cliquez ici si rien ne se passe.
    </a>
  </p>
</div>
<script>
setTimeout(function(){window.location.replace(${jsUrl})},300);
setTimeout(function(){
  var el=document.getElementById("fallback");
  if(el){el.style.display="inline"}
},3000);
</script>
</body>
</html>`;
};

export const oauthErrorPage = (params: {
  status: number;
  detail: string;
  reason?: string;
}): string => {
  let title = "Connexion refusée";
  let body = escape(params.detail);
  if (params.reason === "access_revoked") {
    title = "Accès révoqué";
    body =
      "Votre accès Tomcat Core a été désactivé. "
      + "Contactez un administrateur pour le réactiver.";
  } else if (params.reason === "user_not_provisioned") {
    title = "Compte non autorisé";
    body =
      "Votre compte Google a été reconnu mais n'est pas autorisé. "
      + "Seuls les comptes <strong>@tomcat.eu</strong> sont acceptés.";
  } else if (params.status === 400 && params.detail.includes("state")) {
    title = "Session expirée";
    body =
      "Votre demande de connexion a expiré. "
      + "Relancez la connexion depuis Cursor.";
  }
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>Tomcat Core — ${escape(title)}</title>
<style>${baseStyles}
.icon{background:#fdecea;color:#c62828}
h1{color:#c62828}
</style>
</head>
<body>
<div class="card">
  <div class="icon">&#10007;</div>
  <h1>${escape(title)}</h1>
  <p class="sub">${body}</p>
  <p class="note">Vous pouvez fermer cet onglet.</p>
</div>
</body>
</html>`;
};
