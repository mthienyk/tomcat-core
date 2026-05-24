# Postgres (Scaleway)

Tomcat Core prod utilise **PostgreSQL 16** sur Private Network uniquement (`172.16.0.2:5432`). Seul le container API y accède en permanence.

## Ce qui est stocké

| Dataset | Table(s) principales | Source |
|---|---|---|
| HubSpot startups | `startups`, `sync_runs`, `dataset_freshness` | HubSpot CRM |
| Monday portfolio | `portfolio_companies`, sync metadata | Monday.com |
| Identité équipe | `users` | Google OAuth + admin — see [docs/auth-google-mcp.md](./docs/auth-google-mcp.md) |
| Membres Society / investisseurs | `investor_records`, `investor_portfolio_assignments` | Admin Society / Core |
| Signal Hub | tables signal store | Serper / Unipile (si configurés) |

Modèle Society cible (tiers, capabilities, `society_members`) : [docs/society.md](./docs/society.md).

Données sensibles (tokens CRM, clés LLM) : **env vars chiffrées du container**, pas dans Postgres.

## Accès admin depuis ton Mac

La DB n'est pas joignable directement (IP privée). Deux options :

### Option A — Endpoint public IP-restreint (recommandé, ~2 min)

Active un endpoint load-balancer **uniquement pour ton IP**, sans toucher au endpoint PN du container.

```bash
./scripts/scaleway/init-cli.sh
./scripts/scaleway/setup-db-dev-access.sh   # détecte ton IPv4, pose ACL, crée l'endpoint
./scripts/scaleway/db-psql.sh               # shell psql interactif
./scripts/scaleway/db-psql.sh "SELECT count(*) FROM hubspot_startups;"
```

Variables utiles :

| Variable | Rôle |
|---|---|
| `DB_ADMIN_IPS` | IPs autorisées, ex. `83.159.238.162/32,10.0.0.0/24` (sinon auto-détection) |

Prérequis local (`psql`) :

```bash
brew install libpq
# le script détecte aussi /opt/homebrew/opt/libpq/bin/psql sans link --force
```

Mot de passe : lu depuis `.env.secrets` (`DATABASE_URL`).

**Couper l'accès** quand tu n'en as plus besoin :

```bash
./scripts/scaleway/teardown-db-dev-access.sh
```

### Option B — SSH bastion (Public Gateway)

Garde la DB 100 % privée. Nécessite un [Public Gateway](https://www.scaleway.com/en/docs/public-gateways/how-to/create-a-public-gateway/) sur le même PN + SSH bastion activé dans la console.

```bash
ssh -L 15432:172.16.0.2:5432 bastion@<gateway-ip> -p 61000 -N
psql "postgresql://tomcat_admin@127.0.0.1:15432/tomcat_core?sslmode=require"
```

Restreins les **Allowed IPs** du bastion à ton IP publique dans la console Scaleway.

## Requêtes utiles

```sql
-- État des syncs
SELECT * FROM sync_runs ORDER BY started_at DESC LIMIT 10;

-- Volume HubSpot / Monday
SELECT count(*) FROM startups;
SELECT count(*) FROM portfolio_companies;

-- Fraîcheur (comme /health/readiness)
SELECT dataset, last_sync_at, records_total, healthy FROM dataset_freshness;
```

## Sécurité

- **Prod (container)** : Postgres via PN privé, jamais exposé publiquement.
- **Admin (option A)** : endpoint public temporaire, ACL IPv4 only (Scaleway ne supporte pas IPv6 en ACL RDB). Couper avec `teardown-db-dev-access.sh` après usage.
- **`.env.secrets`** : source de vérité mot de passe DB. Backup chiffré recommandé (1Password).
- Certificat TLS RDB : `scripts/scaleway/.certs/` (gitignored).

## Infra (références)

État persisté dans `scripts/scaleway/.infra-state.env` :

| Clé | Exemple |
|---|---|
| `DB_INSTANCE_ID` | UUID instance RDB |
| `DB_PRIVATE_HOST` | `172.16.0.2` |
| `DB_PUBLIC_HOST` | présent seulement si dev access actif |

Provision initiale : `./scripts/scaleway/provision-infra.sh`
