# Society V1 — handoff & suivi

Dernière mise à jour : 2026-05-25 (repo `tomcat-society-api`, archi BFF retenue)

Document vivant pour la V1 Society : plateforme web privée (`society.tomcat.eu`), repo
Society séparé, instance Scaleway séparée. **Tomcat Core = SSO + data + permissions.**

Références :

- [society.md](./society.md) — vision produit long terme
- [local-read-model-handoff.md](./local-read-model-handoff.md) — read model Postgres
- [auth-google-mcp.md](./auth-google-mcp.md) — OAuth broker existant (MCP)
- Repo Society : **`tomcat-society-api`** (BFF Next.js + UI dev minimale)

---

## 1. Décision architecture V1

| Choix | Décision |
| --- | --- |
| Repo Society | **`tomcat-society-api`** — BFF Next.js + pages dev |
| Front brandé | Repo séparé plus tard → appelle `/api/*` du BFF (cookies ou CORS) |
| Hébergement | Instance Scaleway dédiée (≠ container Core) |
| Auth | **Centralisée dans Core** (SSO Tomcat) |
| Session navigateur | **Cookie httpOnly** côté Society (iron-session) — tokens Core jamais exposés au JS |
| Équipe Tomcat | Google OAuth `@tomcat.eu` via Core `/oauth/authorize` (PKCE côté BFF) |
| Investisseur | Magic link email (allowlist `society_members`) |
| Tokens Core | OAuth opaque (broker existant, scope `society.read`) |
| Data hot path | Postgres read model, **jamais HubSpot live** |
| V1 post-login | Liste paginée startups |

Society **ne signe pas** de JWT service. Le BFF échange le code OAuth avec Core et garde
access/refresh tokens en session serveur.

### 1.1 Découpage des couches

```text
Navigateur (login, /startups)
        │ cookie session (httpOnly)
        ▼
┌───────────────────────────────────────┐
│  tomcat-society-api (Next.js BFF)     │  PKCE, refresh, proxy /api/*
│  Instance Scaleway séparée            │
└───────────────────────────────────────┘
        │ Authorization: Bearer (server-side only)
        ▼
┌───────────────────────────────────────┐
│  Tomcat Core                          │  SSO, permissions, read model
│  /oauth/*, /society/auth/*, /society/*│
└───────────────────────────────────────┘
        ▼
     Postgres
```

**Pourquoi un BFF (et pas PKCE direct navigateur → Core) ?**

| BFF léger (retenu) | PKCE direct front |
| --- | --- |
| Tokens Core jamais dans le JS client | Bearer en mémoire / sessionStorage |
| Refresh token côté serveur | Refresh à gérer côté client |
| Cookie httpOnly | Exposition XSS plus risquée |
| Front brandé branchable sur `/api/*` sans refaire l'auth | Chaque front refait OAuth |

---

## 2. Flow auth

Le navigateur ne parle qu'au BFF Society. Le BFF parle à Core.

### 2.1 Équipe Tomcat (Google)

```text
Browser → GET /api/auth/google (Society BFF)
       → redirect Core /oauth/authorize?scope=society.read&code_challenge=…
       → Google (@tomcat.eu)
       → Core /oauth/callback/google
       → redirect Society /callback?code=…
       → BFF POST Core /oauth/token (PKCE, server-side)
       → cookie session httpOnly
       → /startups
```

Identité résolue côté Core via table `users` (rôle interne).

### 2.2 Investisseur (magic link)

```text
Browser → POST /api/auth/magic-link (Society BFF)
       → BFF POST Core /society/auth/magic-link { email }
       → (email prod — ou verifyUrl en dev Core)
       → clic lien → Society /auth/verify?token=…
       → BFF POST Core /society/auth/magic-link/complete + PKCE
       → BFF POST Core /oauth/token
       → cookie session httpOnly
       → /startups
```

Identité résolue côté Core via `society_members` (`active = true`) →
`external_investor` + `investorId`.

**Dev sans email :** Core renvoie `verifyUrl` si `SOCIETY_MAGIC_LINK_EXPOSE_IN_RESPONSE=true`.
Le lien pointe vers `{SOCIETY_PUBLIC_URL}/auth/verify?token=…` (Society, pas Core).

### 2.3 Appels data

```text
Browser → GET /api/startups (cookie session)
       → BFF Bearer Core → GET /society/startups?limit&cursor&q
       → JSON paginé + permissions appliquées
```

Core vérifie le token, applique `canSeeStartup` + redaction, répond depuis Postgres.

---

## 3. Sécurité (non négociable)

### 3.1 Core

| Règle | Implémentation |
| --- | --- |
| Allowlist investisseurs | `society_members.active = true` obligatoire |
| Pas d'inscription ouverte | magic link refusé si email inconnu (réponse générique) |
| Token magic link | usage unique, TTL 15 min, hash SHA-256 en DB |
| Rate limit magic link | par IP + par email (Postgres distribué, rule `society.auth.magic_link`) |
| Rate limit BFF Society | `/internal/rate-limit/consume` + rules `society.bff.*` (même Postgres) |
| Scope strict | resolver Society n'accepte que tokens `society.read` |
| MCP isolé | resolver MCP n'accepte que tokens `mcp:tools` |
| CORS prod | `CORS_ALLOWED_ORIGINS=https://society.tomcat.eu` (si appels cross-origin vers Core) |
| Permissions entité | `visibilityTier`, redaction — côté Core uniquement |
| Audit | middleware auth log allow/deny (existant) |

### 3.2 BFF Society (`tomcat-society-api`)

| Règle | Cible prod |
| --- | --- |
| Tokens Core | Session serveur uniquement — **jamais** `localStorage` / JS |
| Cookie session | `HttpOnly`, `Secure`, `SameSite=Lax` (minimum) |
| Refresh | Access token expiré → refresh silencieux avant proxy data |
| Logout | Vider session + idéalement `POST Core /oauth/revoke` |
| CSRF | Vérifier `Origin` / `Referer` sur POST cookie-based |
| CORS front brandé | `SOCIETY_CORS_ORIGINS` si origine ≠ même host que le BFF |
| Secrets | `SESSION_SECRET`, `SOCIETY_OAUTH_CLIENT_ID` — env serveur, pas exposés au client |

---

## 4. État implémentation

### 4.1 Core (`tomcat-core`)

| Élément | Statut | Fichiers / notes |
| --- | --- | --- |
| Migration `society_members` + magic link tokens | ✓ | `pg_009_society_auth.sql` |
| Store CRUD membres | ✓ | `CoreStore` society members |
| Magic link request/consume | ✓ | `src/auth/societyAuth/` |
| OAuth scope `society.read` | ✓ | `McpOAuthService` |
| Resolver identité Society | ✓ | `societyAuth/tokenResolver.ts` |
| Split resolver MCP / Society | ✓ | scope filter sur opaque tokens |
| `GET /society/startups` paginé SQL | ✓ | `src/api/routes/society.ts` |
| Admin `GET/POST /internal/society-members` | ✓ | seed investisseurs test |
| Env config Society auth | ✓ | `.env.example` |
| Email magic link (prod) | ☐ | voir §10 — Resend ; dev sans email OK |

### 4.2 Society BFF (`tomcat-society-api`)

| Élément | Statut | Notes |
| --- | --- | --- |
| Repo initialisé | ✓ | Next.js App Router, `output: standalone`, Dockerfile |
| Session iron-session (httpOnly) | ✓ | tokens Core côté serveur |
| PKCE OAuth Google → Core | ✓ | `/api/auth/google`, `/callback` |
| Magic link proxy | ✓ | `/api/auth/magic-link`, `/auth/verify` |
| Proxy startups paginé | ✓ | `GET /api/startups` → Core `/society/startups` |
| Pages dev minimales | ✓ | `/login`, `/startups` (sans branding) |
| Build / typecheck | ✓ | `npm run build` OK |
| OAuth client enregistré sur Core | ☐ | une fois par env |
| Seed membres pilotes | ☐ | via Core admin API |
| Durcissement cookies / CSRF prod | ☐ | avant deploy Scaleway |
| Front brandé séparé | ☐ | phase 2 — consomme `/api/*` |
| Deploy Scaleway | ☐ | instance séparée de Core |
| Capabilities fine-grained par tier | ☐ | phase 2 |
| Logos / assets | ☐ | phase 2 |

---

## 5. Setup dev local (Core + Society)

### 5.1 Core — variables

```bash
# CORS — autoriser le BFF local si besoin d'appels cross-origin directs
CORS_ALLOWED_ORIGINS=http://localhost:3000

# OAuth broker (déjà requis pour MCP)
GOOGLE_OAUTH_WEB_CLIENT_ID=…
GOOGLE_OAUTH_WEB_CLIENT_SECRET=…
OAUTH_ISSUER_URL=http://localhost:4000   # ou URL Scaleway dev

# Autoriser redirect Society à l'enregistrement client OAuth
OAUTH_ALLOWED_REDIRECT_URI_PREFIXES=…,http://localhost:3000/

# Magic link (dev)
SOCIETY_MAGIC_LINK_EXPOSE_IN_RESPONSE=true
SOCIETY_MAGIC_LINK_VERIFY_BASE_URL=http://localhost:3000/auth/verify
SOCIETY_MAGIC_LINK_TTL_SECONDS=900
SOCIETY_MAGIC_LINK_RATE_LIMIT_PER_MINUTE=10
```

### 5.2 Enregistrer le client OAuth Society (une fois par env)

```bash
curl -X POST "$CORE_URL/oauth/register" \
  -H 'Content-Type: application/json' \
  -d '{
    "client_name": "Society Web",
    "redirect_uris": ["http://localhost:3000/callback"]
  }'
```

Conserver le `client_id` retourné → env Society `SOCIETY_OAUTH_CLIENT_ID`.

Scope à l'authorize : `society.read`.

Prod : ajouter `https://society.tomcat.eu/callback` aux `redirect_uris`.

### 5.3 Society BFF — variables (`.env`)

```bash
SOCIETY_PUBLIC_URL=http://localhost:3000
CORE_API_URL=http://localhost:4000
SOCIETY_OAUTH_CLIENT_ID=<client_id from step 5.2>
SESSION_SECRET=<openssl rand -hex 32>
# Optionnel si front brandé sur autre origine plus tard
# SOCIETY_CORS_ORIGINS=http://localhost:3001
```

```bash
cd tomcat-society-api
cp .env.example .env
npm install && npm run dev
# → http://localhost:3000
```

### 5.4 Seed membre investisseur test (Core)

```bash
curl -X POST "$CORE_URL/internal/society-members" \
  -H "Authorization: Bearer $GOOGLE_ID_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "memberId": "member_test_1",
    "email": "investor@example.com",
    "kind": "society_member",
    "tier": "Investor",
    "investorId": "inv_test_1",
    "active": true
  }'
```

Créer aussi l'`investor_record` via `POST /internal/investors` si besoin.

### 5.5 Test magic link (dev)

Via le BFF :

```bash
curl -X POST "http://localhost:3000/api/auth/magic-link" \
  -H 'Content-Type: application/json' \
  -d '{"email":"investor@example.com"}'
```

Ou direct Core (debug) :

```bash
curl -X POST "$CORE_URL/society/auth/magic-link" \
  -H 'Content-Type: application/json' \
  -d '{"email":"investor@example.com"}'
# → { "sent": true, "verifyUrl": "http://localhost:3000/auth/verify?token=…" }
```

### 5.6 Déploiement staging (Core prod + Society URL temporaire)

**Ordre impératif : auth Core d'abord, Society ensuite.** Society ne marchera pas si Core
n'a pas les bonnes URLs et le client OAuth enregistré.

Fixer deux URLs (sans slash final) :

```text
CORE_URL=https://tomcatcore91c5e290-api.functions.fnc.fr-par.scw.cloud
SOCIETY_URL=https://<ton-container-society>.functions.fnc.fr-par.scw.cloud
```

#### Étape A — Core prod : patch env Society (avant deploy Society)

Dans `tomcat-core/.env` (puis `patch-container-env.sh`) :

```bash
# URL Society = callback OAuth + magic link
SOCIETY_MAGIC_LINK_VERIFY_BASE_URL=https://<SOCIETY_URL>/auth/verify
SOCIETY_MAGIC_LINK_EXPOSE_IN_RESPONSE=false
SOCIETY_MAGIC_LINK_TTL_SECONDS=900
SOCIETY_MAGIC_LINK_RATE_LIMIT_PER_MINUTE=10

# Autoriser l'enregistrement du client OAuth Society
OAUTH_ALLOWED_REDIRECT_URI_PREFIXES=cursor://,https://www.cursor.com/,http://localhost:,https://claude.ai/,https://claude.com/,https://<SOCIETY_URL>/

# Rate limit partagé Core ↔ Society BFF (prod multi-instance)
RATE_LIMIT_STORE=postgres
RATE_LIMIT_SERVICE_KEY=<openssl rand -hex 32>   # même valeur des deux côtés
SOCIETY_BFF_OAUTH_GOOGLE_RATE_LIMIT_PER_MINUTE=30
SOCIETY_BFF_STARTUPS_RATE_LIMIT_PER_MINUTE=120
```

Appliquer sur le container Core :

```bash
cd tomcat-core
./scripts/scaleway/patch-container-env.sh
```

Vérifier les logs Scaleway au boot : `Society auth enabled at /society/auth/*`.
Si `Society magic link disabled` → `SOCIETY_MAGIC_LINK_VERIFY_BASE_URL` manquant.

**Google Cloud Console** (client OAuth Web déjà utilisé par Core) : redirect autorisé

```text
{CORE_URL}/oauth/callback/google
```

(déjà en place si MCP OAuth remote fonctionne)

#### Étape B — Enregistrer le client OAuth prod (une fois)

```bash
curl -s -X POST "$CORE_URL/oauth/register" \
  -H 'Content-Type: application/json' \
  -d "{
    \"client_name\": \"Society Staging\",
    \"redirect_uris\": [\"${SOCIETY_URL}/callback\"]
  }"
```

Noter le `client_id` (`mcp_…`). **Le stocker comme secret**, pas en git.

Si `invalid_redirect_uri` → corriger `OAUTH_ALLOWED_REDIRECT_URI_PREFIXES` étape A.

#### Étape C — Society prod : secrets et env

Pattern identique à Core : `.env.secrets` gitignored → variables chiffrées Scaleway.

**Secrets** (Scaleway `secret-environment-variables`) :

| Variable | Génération | Notes |
| --- | --- | --- |
| `SESSION_SECRET` | `openssl rand -hex 32` | Cookie iron-session ; ne pas changer sans déconnecter tout le monde |
| `SOCIETY_OAUTH_CLIENT_ID` | étape B | Identifie Society auprès de Core |
| `RATE_LIMIT_SERVICE_KEY` | **identique à Core** | Header `X-Rate-Limit-Service-Key` vers Core |

**Public** (Scaleway `environment-variables`) :

| Variable | Exemple | Notes |
| --- | --- | --- |
| `NODE_ENV` | `production` | |
| `SOCIETY_PUBLIC_URL` | `https://…scw.cloud` | **Doit matcher l'URL réelle** (redirect OAuth) |
| `CORE_API_URL` | `https://tomcatcore…scw.cloud` | **= `OAUTH_ISSUER_URL` Core** |
| `PORT` | `3000` | Selon image Docker |

Society **n'a pas** : tokens HubSpot, `SERVICE_TOKEN_SECRET`, clés CRM.

Exemple `tomcat-society-api/.env.secrets` :

```bash
SESSION_SECRET=
SOCIETY_OAUTH_CLIENT_ID=mcp_xxxxxxxx
RATE_LIMIT_SERVICE_KEY=          # copier depuis Core .env
```

Exemple public (deploy script ou console) :

```bash
NODE_ENV=production
SOCIETY_PUBLIC_URL=https://<SOCIETY_URL>
CORE_API_URL=https://tomcatcore91c5e290-api.functions.fnc.fr-par.scw.cloud
```

#### Étape D — Deploy Society + smoke test

```bash
# build + push image Society, deploy container Scaleway
curl "$SOCIETY_URL/api/health"
```

Tests manuels :

1. `GET $SOCIETY_URL/login` → bouton Google
2. Login `@tomcat.eu` → `/startups` (équipe)
3. Seed membre `POST $CORE_URL/internal/society-members` → magic link (pas de verifyUrl en prod ; email Phase 1 Resend)

#### Étape E — Changer d'URL temporaire plus tard

Si `SOCIETY_URL` change :

1. Patch Core : `SOCIETY_MAGIC_LINK_VERIFY_BASE_URL` + `OAUTH_ALLOWED_REDIRECT_URI_PREFIXES`
2. **Nouveau** `POST /oauth/register` avec la nouvelle `{SOCIETY_URL}/callback`
3. Mettre à jour `SOCIETY_OAUTH_CLIENT_ID` + `SOCIETY_PUBLIC_URL` sur Society
4. Redéployer / restart les deux containers

Ne pas réutiliser l'ancien `client_id` si la redirect URI a changé (enregistrer un client neuf ou étendre les URIs via nouvelle registration).

#### Checklist auth solide prod

| # | Item |
| --- | --- |
| 1 | Core : `SOCIETY_MAGIC_LINK_VERIFY_BASE_URL` = URL Society réelle |
| 2 | Core : `SOCIETY_MAGIC_LINK_EXPOSE_IN_RESPONSE=false` |
| 3 | Core : prefix redirect Society dans `OAUTH_ALLOWED_REDIRECT_URI_PREFIXES` |
| 4 | Core : `RATE_LIMIT_SERVICE_KEY` défini (Postgres rate limit) |
| 5 | Client OAuth enregistré, `redirect_uri` exacte `{SOCIETY_URL}/callback` |
| 6 | Society : `SOCIETY_PUBLIC_URL` = même host que redirect |
| 7 | Society : `CORE_API_URL` = `OAUTH_ISSUER_URL` Core |
| 8 | Society : `SESSION_SECRET` ≥ 32 bytes aléatoires |
| 9 | Society : `SOCIETY_OAUTH_CLIENT_ID` en secret Scaleway |
| 10 | Society : `RATE_LIMIT_SERVICE_KEY` = Core |
| 11 | Membres seedés dans `society_members` avant test investisseur |
| 12 | Google Console : `{CORE_URL}/oauth/callback/google` autorisé |

---

## 6. Contrat API

### 6.1 Core (appelé par le BFF)

#### `GET /society/startups`

Query : `limit` (1–100, default 50), `cursor`, `q`, `sector`

```json
{
  "items": [ { "id", "name", "sectors", "stage", "country", "visibilityTier" } ],
  "nextCursor": "hubspot_123",
  "hasMore": true
}
```

Auth : `Authorization: Bearer <access_token>` (scope `society.read`).

#### `POST /society/auth/magic-link`

Body : `{ "email" }` → `{ "sent": true }` (+ `verifyUrl` en dev Core).

#### `POST /society/auth/magic-link/complete`

Body : `{ "token", "clientId", "redirectUri", "codeChallenge", "codeChallengeMethod" }`
→ `{ "code", "redirectUri" }` puis échange `/oauth/token`.

#### OAuth Core

- `GET /oauth/authorize` — Google ou code Society
- `POST /oauth/token` — PKCE + refresh
- `POST /oauth/revoke` — logout (recommandé)

### 6.2 BFF Society (appelé par le navigateur)

| Route BFF | Rôle |
| --- | --- |
| `GET /api/health` | santé BFF |
| `GET /api/auth/me` | snapshot session (email, connecté ou non) |
| `GET /api/auth/google` | démarre OAuth Google via Core |
| `GET /callback` | reçoit code OAuth, pose cookie session |
| `POST /api/auth/magic-link` | proxy magic link Core |
| `GET /auth/verify` | consomme token magic link → session |
| `POST /api/auth/logout` | efface session |
| `GET /api/startups` | proxy paginé Core |

Pages dev : `/login`, `/startups`.

---

## 7. Repo `tomcat-society-api`

BFF Next.js pour Society : session cookie, auth déléguée à Core, proxy `society.read`.

Structure clé :

| Chemin | Rôle |
| --- | --- |
| `src/lib/core-client.ts` | appels Core (OAuth, magic link, startups) |
| `src/lib/session.ts` | iron-session, tokens en session serveur |
| `src/lib/pkce.ts` | PKCE generate / state |
| `src/app/api/` | routes BFF |
| `Dockerfile` | deploy Scaleway (`standalone`) |

**Évolution prévue :**

1. **Maintenant** — BFF + UI dev minimale (même repo)
2. **Phase 2** — front brandé séparé → fetch `/api/*` avec cookies (same-site) ou `SOCIETY_CORS_ORIGINS`
3. **Prod** — `society.tomcat.eu` pointe vers ce container ; Core reste sur son URL API

---

## 8. Prochaines étapes

1. Enregistrer client OAuth sur Core local + `.env` Society
2. Seed 1 membre test + login magic link / Google → `/startups`
3. Seed Jeremy admin + 2–3 membres pilotes (Core)
4. Durcissement BFF prod (cookies, CSRF, revoke) + deploy Scaleway Society
5. DNS `society.tomcat.eu` + CORS Core prod
6. Resend magic link prod quand accès DNS (§10)
7. Phase 2 : front brandé, home agrégé, events, portfolio, logos

---

## 9. Envoi email magic link

### 9.1 Recommandation

| Option | Simplicité dev | Simplicité ops | Verdict V1 |
| --- | --- | --- | --- |
| **Dev : pas d'email** (`SOCIETY_MAGIC_LINK_EXPOSE_IN_RESPONSE`) | ★★★★★ | ★★★★★ | **Maintenant** — déjà implémenté |
| **Resend** (ou Postmark) | ★★★★★ | ★★★★ | **Prod recommandé** |
| **Google Workspace / Gmail API** | ★★ | ★★ | Possible si admin GCP + Workspace |
| **SMTP Gmail perso** | ★★★ | ★ | À éviter |

**Conclusion : Resend pour la prod.** Google OAuth `@tomcat.eu` authentifie l'équipe ; ce n'est pas un service d'envoi transactionnel.

L'envoi email sera branché **côté Core** (`SocietyAuthService.requestMagicLink`) — le BFF ne change pas.

### 9.2 Phases

#### Phase 0 — dev (aucun accès email/DNS)

```bash
# Core
SOCIETY_MAGIC_LINK_EXPOSE_IN_RESPONSE=true
SOCIETY_MAGIC_LINK_VERIFY_BASE_URL=http://localhost:3000/auth/verify
```

Copier `verifyUrl` à la main. **Resend peut attendre.**

#### Phase 1 — prod (DNS `tomcat.eu`)

1. Compte Resend + domaine vérifié (SPF/DKIM)
2. `RESEND_API_KEY` + `SOCIETY_EMAIL_FROM` sur Core (Scaleway secrets)
3. `SOCIETY_MAGIC_LINK_VERIFY_BASE_URL=https://society.tomcat.eu/auth/verify`

#### Resend sans domaine

Magic link vers un investisseur réel → **impossible** sans DNS. Voir tableau détaillé commit précédent §10.3.

### 9.3 Accès à obtenir

| Accès | Bloque quoi |
| --- | --- |
| Admin DNS `tomcat.eu` | Délivrabilité prod Resend |
| Compte Resend | Envoi prod |
| Scaleway Secret Manager | `RESEND_API_KEY` |
| Google Workspace / GCP admin | Option Gmail API (non requis V1) |

**État actuel (2026-05-25) : accès complets non disponibles.** Phase 0 suffit pour dev.

### 9.4 Variables env email (Core, à implémenter)

```bash
SOCIETY_EMAIL_PROVIDER=resend
RESEND_API_KEY=re_…
SOCIETY_EMAIL_FROM=Society <society@tomcat.eu>
```

---

## 10. Journal

| Date | Changement |
| --- | --- |
| 2026-05-25 | Création doc ; impl Core : auth Society, migration, `/society/startups` |
| 2026-05-25 | §9 email : Resend prod ; Phase 0 dev sans accès |
| 2026-05-25 | §5.6 déploiement staging Core prod + Society URL temporaire ; checklist env secrets |
