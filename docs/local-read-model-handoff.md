# Handoff — Read model local (Postgres) : copie HubSpot / Monday / Drive

Dernière mise à jour : 2026-05-24 (validation seed Phase A)

Note de reprise pour le read model Postgres : copie locale HubSpot / Monday / Drive, consommée par MCP et Society. **Seed initial validé** (2026-05-24) ; prochain blocage = sync HubSpot wasteful (voir §7.4).

Documents liés :

- [hubspot-sync-engine.md](./hubspot-sync-engine.md) — queue, webhooks, rate limits HubSpot
- [mcp-work-status.md](./mcp-work-status.md) — état MCP / prod
- [crm-notes-memory-handoff.md](./crm-notes-memory-handoff.md) — use case mémoire CRM (notes Élie, similarité, pgvector)
- [README.md](../README.md) — CoreStore, sync workers, `DATABASE_URL`

---

## 1. But final (north star)

Tomcat a **deux consommateurs** du même capital données, avec des contraintes différentes :

| Consommateur | Usage | Contrainte |
| --- | --- | --- |
| **MCP / agents** (équipe) | Notes similaires, mémoire boîte, board prep, recherche sémantique | Latence + rate limits HubSpot incompatibles avec enchaînements multi-read |
| **Society** (web, ~100 users) | Browse pipeline, fiches startup, portfolio, events | Hot path **doit** répondre en <300 ms ; impossible de frapper HubSpot/Monday à chaque page |

**HubSpot, Monday, Drive restent les sources de vérité.** Postgres Scaleway est le **read model local** : une copie queryable, tenue à jour par sync, sur laquelle on construit tout le reste.

### 1.1 Ce qu'on doit pouvoir faire (et qu'on ne fera pas via API live)

| Capacité | Pourquoi pas l'API source | Pourquoi le cache local |
| --- | --- | --- |
| **Filtrer par attributs** (secteur, stage, pays, statut deal, tier visibility) | Search HubSpot limité (~4 req/s), filtres custom lents, pas de join cross-source | SQL indexé sur tables normalisées |
| **Recherche full-text / sémantique** (« notes M2 similaires sur ce segment », « boîtes vues en 2022 sur la fintech ») | Impossible à l'échelle : N companies × M notes × embedding | `pgvector` sur `knowledge_index_chunks` ; HyDE sur requêtes ambiguës |
| **Agrégats rapides** (timeline boîte, activité récente portfolio, home Society) | Waterfall 5–10 calls HubSpot par user × 100 users = 429 + secondes | 1–3 requêtes Postgres, pagination, projections |
| **Permissions / redaction** (investisseur vs équipe, note confidential) | Re-fetch + re-filter à chaque call | Appliqué une fois à l'écriture sync + garde-fous lecture |
| **Historique stable** pour IA | Contenu HubSpot peut changer entre deux tool calls d'un agent | Fingerprint + chunks versionnés |

**Drive** : priorité basse pour le cache. Métadonnées (board packs, chemins) utiles ; **texte des docs** reste live ou indexé sélectivement (phase 2), pas un mirror complet du Drive.

### 1.2 Périmètre du cache (quoi copier)

Pas une dump byte-for-byte de HubSpot. Un **read model métier** aligné sur `src/domain/entities.ts` :

| Source | Copier en Postgres | Ne pas copier (V1) |
| --- | --- | --- |
| **HubSpot** | Companies filtrées, deals, notes, meetings | Contacts, calls, tasks, propriétés brutes non mappées |
| **Monday** | Portfolio portco, events, signaux (quand boards câblés) | Tout le workspace ops |
| **Drive** | Métadonnées board packs (+ éventuellement index texte ciblé) | Binaires, arborescence complète |

HubSpot investisseurs et companies hors funnel startup : **filtrés à l'ingestion**, pas stockés.

### 1.3 Architecture cible (3 couches)

```text
Sources (HubSpot, Monday, Drive)
        │
        ▼  sync incrémental (webhook + queue + reconcile)
┌───────────────────────────────────────┐
│  Couche 1 — Read model relationnel    │  startups, deals, notes, meetings,
│  (Postgres, CoreStore)                │  portfolio_companies, events
│  → Society hot path, filtres SQL      │
└───────────────────────────────────────┘
        │
        ▼  worker post-sync (fingerprint changé)
┌───────────────────────────────────────┐
│  Couche 2 — Index sémantique          │  knowledge_index_chunks + pgvector
│  → MCP find_similar_notes, RAG Élie   │
└───────────────────────────────────────┘
        │
        ▼  API paginée + permissions
┌───────────────────────────────────────┐
│  Couche 3 — Surfaces                  │  Society (100 users), MCP, /ai/query
└───────────────────────────────────────┘
```

**Principe** : MCP et Society lisent **Postgres d'abord**. Fallback live HubSpot uniquement si dataset pas encore healthy (bootstrap) ou cas edge documenté.

### 1.4 Critères de succès

- Un investisseur Society charge home + browse pipeline **sans appel HubSpot**.
- Élie interroge « notes similaires sur X » **sans scanner tout le CRM**.
- Filtre `sector=fintech AND stage=seed AND deal.status=diligence` en **<100 ms** côté DB.
- Sync maintient le cache **à jour** (webhook + reconcile ; pas de rescan naïf 15 min sur 1 875 companies).
- Permissions Tomcat appliquées **avant** exposition (pas de fuite via cache).

---

## 2. Est-ce la bonne approche ? (sanity check)

**Oui.** Un dev senior reconnaîtrait le pattern immédiatement : **CQRS / read model / materialized cache**. C'est ce que font les produits qui scalent au-delà des wrappers API CRM.

Ce qu'il dirait probablement **en soutien** :

- « Tu ne peux pas servir 100 users web + agents IA sur HubSpot live — rate limits et latence te tueront. »
- « Postgres + sync + pgvector, un seul stack, c'est le bon choix à votre échelle (~2k companies, ~10–20k notes). »
- « Normaliser au domaine plutôt que dump JSON brut : correct pour permissions et Society. »
- « Sync incrémental par entité (queue) > cron full-scan : vous l'avez déjà. »

### Alternatives qu'il pourrait mentionner (et pourquoi on ne les prend pas seules)

| Alternative | Attractif si… | Pourquoi pas suffisant pour Tomcat |
| --- | --- | --- |
| **Tout live via HubSpot API** | 0 infra sync | ❌ 100 users Society + agents = 429, secondes de latence, pas de vector search |
| **ETL managé** (Airbyte, Fivetran → Postgres) | Moins de code sync à maintenir | Tables raw HubSpot, pas le domaine Tomcat ; permissions/redaction à refaire ; Monday/Drive custom anyway |
| **Elasticsearch / OpenSearch seul** | Full-text excellent | Pas de modèle relationnel Society (deals, tiers, scope investisseur) ; double stack |
| **Vector DB externe** (Pinecone, Weaviate) | RAG rapide | Encore besoin d'un store structuré pour filtres attributs ; coût + ops en plus ; pgvector suffit à cette échelle |
| **Data warehouse** (BigQuery, Snowflake) | Analytics BI | Latence et coût inadaptés au hot path web p95 <300 ms |
| **Redis cache devant API** | Simple | Cache vide au cold start ; invalidation cauchemar ; ne résout pas search sémantique ni joins |
| **HubSpot CMS / Operations Hub natif** | Zero dev | Pas Monday/Drive ; pas de logique Tomcat ; lock-in |

**Conclusion** : pas de raccourci magique plus simple qui couvre **Society scalable + filtres attributs + vectorisation + permissions**. Le read model Postgres est le bon centre de gravité.

### Ce qui serait effectivement « plus simple » (optimisations, pas changement de cap)

1. **Ne pas sync tout le parc day 1** — startups + deals d'abord ; notes complètes en overnight ou sur boîtes actives.
2. **Garder Drive live** pour le texte doc — indexer seulement ce qu'Élie/Society consomment (notes CRM, pas tous les xlsx).
3. **Un Postgres + pgvector** — pas de Pinecone tant que <100k chunks.
4. **Option future** : colonne `raw_properties jsonb` sur `startups` pour filtres HubSpot custom sans re-sync connector — additive, pas bloquante.
5. **Table de mapping IDs** (`entity_aliases`) — HubSpot numeric id ↔ nom Monday ↔ Society member ; aujourd'hui résolu par nom, à formaliser.

### Ce qui serait « nimp » (à éviter)

- Rescanner 1 875 companies toutes les 15 min.
- Charger 1 875 startups en mémoire sur chaque home Society (bug actuel `getInvestorHome`).
- Vectoriser avant d'avoir le read model relationnel stable.
- Copier tout Drive (Go de binaires) « au cas où ».
- Utiliser le MCP comme BFF Society — les 100 users passent par HTTP paginé, pas par Claude.

---

## 3. État actuel du code (déjà implémenté)

### 3.1 Infra Postgres

| Élément | Statut |
| --- | --- |
| Instance Scaleway RDB | Provisionnée (`scripts/scaleway/provision-infra.sh`) |
| DB logique `tomcat_core` | Oui |
| `DATABASE_URL` | Dans `.env.secrets` + Secret Manager Scaleway |
| Migrations auto au boot | `runPgMigrations()` dans `src/server.ts` → `pg_000` … `pg_006` |

Migrations clés :

- `pg_002_core.sql` — tables métier + `sync_runs` + `dataset_freshness`
- `pg_005_sync_engine.sql` — `sync_queue`, `sync_cursors`, `hubspot_company_sync_state`, `knowledge_index_chunks` (vide)

### 3.2 Tables read model

| Table | Source | Contenu |
| --- | --- | --- |
| `startups` | HubSpot companies (filtrées) | id = HubSpot company id |
| `deals` | HubSpot | par startup |
| `notes` | HubSpot | corps texte (HTML stripé) |
| `meetings` | HubSpot | |
| `portfolio_companies` | Monday boards (emoji portco) | id = **nom company** (pas HubSpot id) |
| `portfolio_signals` | Monday | **toujours vide** (connector retourne `[]`) |
| `events` | Monday | **toujours vide** |
| `board_packs` | Drive | métadonnées (titre, drive_file_id, mime) |

### 3.3 Workers sync (scheduler)

Fichier : `src/sync/scheduler.ts` — démarre **automatiquement** si `DATABASE_URL` est set.

| Worker | Dataset | Fréquence | Rôle |
| --- | --- | --- | --- |
| `hubspotStartupsWorker` | `hubspot.startups` | 15 min | Rafraîchit le **directory** startups (metadata) ; n'enqueue **pas** l'activity |
| `hubspotActivityBackfillWorker` | `hubspot.activity.backfill` | 15 min | Enqueue activity pour companies sans `hubspot_company_sync_state` |
| `createHubspotActivityQueueWorker` | `hubspot.activity.queue` | **5 s** | Sync notes/deals/meetings par company (rate-limited) |
| `createHubspotActivityReconcileWorker` | `hubspot.activity.reconcile` | **6 h** | Search `hs_lastmodifieddate` → enqueue |
| `mondayPortfolioWorker` | `monday.portfolio` | 15 min | Boards Monday → `portfolio_companies` |
| `mondaySignalsWorker` | `monday.signals` | 15 min | No-op effectif (`[]`) |
| `mondayEventsWorker` | `monday.events` | 15 min | No-op effectif (`[]`) |
| `driveBoardPacksWorker` | `drive.boardPacks` | 15 min | Nécessite `monday.portfolio` déjà peuplé |

Délai au boot : **10 s** (`STARTUP_DELAY_MS`) avant premier cycle.

HubSpot outbound : rate limiter **90 req / 10 s** (`src/sync/rateLimiter.ts`).

### 3.4 Lecture MCP

`src/connectors/storeBacked.ts` :

- Si `dataset_freshness.healthy === true` → lit Postgres
- Sinon → **fallback live** HubSpot / Monday / Drive (transparent pour les services)

TTL cache freshness : 5 s.

### 3.5 Webhook HubSpot (pas requis pour le seed initial)

`POST /webhooks/hubspot` — bloqué sans `HUBSPOT_WEBHOOK_CLIENT_SECRET` (401).

Impact : **pas de sync temps réel**. Le **seed + reconcile + backfill** fonctionnent **sans** webhook.

---

## 4. État du seed (validation Phase A — 2026-05-24)

**Seed initial : fait.** Scaleway prod `/health/readiness` → `status: "ready"`, tous datasets `healthy: true`. MCP lit Postgres via `storeBacked` (plus de fallback live HubSpot sur les list reads).

### 4.1 Counts prod (snapshot 2026-05-24 ~21:30 UTC)

| Dataset / table | Records |
| --- | ---: |
| `hubspot.startups` / `startups` | 1 746 |
| `hubspot.notes` / `notes` | 4 316 |
| `hubspot.deals` / `deals` | 2 264 |
| `hubspot.meetings` / `meetings` | 3 982 |
| `hubspot_company_sync_state` | 1 746 (100 % du parc) |
| `monday.portfolio` / `portfolio_companies` | 8 |
| `drive.boardPacks` / `board_packs` | 823 |
| `monday.signals` / `monday.events` | 0 (attendu, connector no-op) |

Contrôles qualité : 0 notes orphelines (FK `startup_id`), top company Matrice = 52 notes / 47 deals.

### 4.2 Comment le seed s'est déclenché

Pas de script CLI dédié : au **démarrage du container** avec `DATABASE_URL`, le scheduler (`src/sync/scheduler.ts`) lance le backfill automatiquement.

Ordre naturel (doc `hubspot-sync-engine.md` §8) :

```text
HubSpot API
    │
    ├─ hubspot.startups (15 min)     → startups table (directory refresh)
    ├─ hubspot.activity.backfill     → enqueue missing sync_state only
    ├─ hubspot.activity.reconcile    → enqueue modified companies (6 h)
    ├─ webhook                       → enqueue changed companies (push)
    │
    └─ hubspot.activity.queue (5 s)  → deals / notes / meetings per company
```

Estimation backfill initial : ~1 746 companies × ~3–8 API calls → **~15–30 min** à 90 req/10 s (variable selon volume notes/deals).

### 4.3 Seed vs sync stable

| | Seed initial | Sync stable en prod |
| --- | --- | --- |
| Read model peuplé | ✅ | ✅ |
| MCP sur Postgres | ✅ | ✅ |
| Queue HubSpot sous contrôle | ✅ (one-shot) | ✅ deploy prod 2026-05-24 |
| Webhook temps réel | N/A | ❌ secret manquant (phase 2) |

**Conclusion** : objectif « DB instanciée + MCP lit Postgres » **atteint**. Sync stable après **deploy** du fix §7.4.

### 4.4 Branche locale vs prod

| Commit | Contenu | Impact seed |
| --- | --- | --- |
| Prod déployée (sync engine actif) | ≥ `6883d5e` (sync engine + queue) | Seed exécuté sur cette base |
| `f46479f` | Drive : `mime_type` (`pg_006`), fallback live lecture, BP ranking | **Ne remet pas en cause** les 823 board packs ; améliore la lecture |
| `5e6a211` (HEAD local) | MCP `list_portfolio_companies` | Aucun impact sync |

Migration `pg_006_board_packs_mime.sql` déjà appliquée sur Scaleway (colonne `mime_type` présente).

---

## 5. Comment vérifier que le seed a marché

### 5.1 HTTP

```bash
# Public — pas d'auth
curl -s https://<core-api>/health/readiness | jq

# Attendu quand seed OK :
# status: "ready", datasets[].healthy: true, recordsTotal > 0
```

Tant que `status: "syncing"` ou datasets `healthy: false`, MCP utilise encore le fallback live.

### 5.2 Endpoints internes (auth `internal.read`)

- `GET /internal/sync/freshness` — détail par dataset
- `GET /internal/sync/queue/hubspot.activity` — pending / running / dead jobs

### 5.3 SQL direct

```bash
./scripts/scaleway/db-psql.sh   # tunnel + psql si configuré
```

Requêtes utiles :

```sql
select dataset, records_total, healthy, last_sync_at from dataset_freshness order by dataset;
select count(*) from startups;
select count(*) from notes;
select count(*) from deals;
select count(*) from portfolio_companies;
select status, count(*) from sync_queue group by status;
select count(*) from hubspot_company_sync_state;
```

### 5.4 Logs container

Chercher : `sync complete`, `backfill enqueue complete`, `queue batch complete`, `hubspot_webhook_enqueued` (seulement si webhook actif).

---

## 6. Ce qui bloque quoi (matrice)

| Manque | Seed initial | MCP lecture | Fraîcheur continue |
| --- | --- | --- | --- |
| `DATABASE_URL` | ❌ | fallback live only | ❌ |
| `HUBSPOT_API_TOKEN` | ❌ HubSpot | live HubSpot | ❌ |
| Code sync engine **non déployé** | ❌ ou partiel | fallback | ❌ |
| `HUBSPOT_WEBHOOK_CLIENT_SECRET` | ✅ seed OK | ✅ | ⚠️ délai ~6 h max sans webhook |
| `MONDAY_API_TOKEN` | ⚠️ portfolio only | live Monday | ⚠️ |
| Drive SA + `GOOGLE_DRIVE_SHARED_DRIVE_ID` | ⚠️ board_packs only | live Drive docs | ⚠️ |

**Le webhook ne bloque pas le seed.** Il bloque uniquement la **notification push** quand quelqu'un modifie HubSpot.

---

## 7. Défis et écarts vs « copie littérale »

### 7.1 HubSpot

| Défi | Détail |
| --- | --- |
| **Pas de webhook Notes** | Proxy via `company.propertyChange` ; note edit sans toucher company → reconcile 6 h |
| **Rate limits** | ~100 req/10 s burst ; queue + throttle 90/10 s |
| **Mapping, pas dump brut** | Custom properties Tomcat mappées en domain entities ; pas de JSON HubSpot raw en Postgres |
| **Filtrage companies** | Investisseurs exclus ; lifecycle stages startup only |
| **Pas de deletes V1** | Notes supprimées HubSpot restent en Postgres |
| **Contacts / calls / tasks** | **Non sync** — hors scope connector actuel |
| **Cap journalier API** | Private app ~250k/jour ; backfill initial safe, rescan complet répété non |

### 7.2 Monday

| Défi | Détail |
| --- | --- |
| **ID différent de HubSpot** | Monday `portfolio_companies.id` = **nom** ; HubSpot `startups.id` = **numeric id** — jointure via résolution nom (`entityResolution`, hubspot accepte name) |
| **Signaux / events vides** | `listSignals` / `listUpcomingEvents` retournent `[]` — workers tournent mais ne peuplent rien |
| **Champs approximatifs** | `investedAt` = `updated_at` board Monday, pas date investissement réelle |
| **Pas de webhook Monday** | Full resync 15 min seulement |

### 7.3 Drive

| Défi | Détail |
| --- | --- |
| **Pas de cache texte** | `fetchDocumentText` toujours live — volontaire (volume, formats, droits) |
| **Board packs seulement** | Pas l'arbre complet Drive / BP / templates |
| **Dépendance portfolio Monday** | Worker Drive itère `portfolio_companies` — Monday doit passer avant |
| **Coût API** | 1 call list board packs × N portcos every 15 min |

### 7.4 Bugs / dettes connus

#### P0 — Re-enqueue `startup_seed` toutes les 15 min — **corrigé 2026-05-24**

**Symptôme** (avant fix) : `hubspotStartupsWorker` enqueueait un job `startup_seed` pour **chaque** startup à chaque cycle 15 min (~220k calls/jour projetés).

**Fix** :

1. `hubspotStartupsWorker` → **directory sync only** (`runHubspotStartupsDirectorySync`) : upsert startups, zéro enqueue activity.
2. **Backfill** (`enqueueHubspotActivityBackfill`) → seule voie automatique pour le premier sync activity (companies sans `hubspot_company_sync_state`).
3. **Reconcile** (6 h) + **webhook** (phase 2) → delta uniquement.
4. `sync_queue.trigger_context` (`pg_007`) porte le watermark `hubspotModifiedAt` du reconcile ; `syncHubspotCompanyActivity` skip si inchangé.

Fichiers : `src/sync/hubspotStartupsSync.ts`, `src/sync/hubspotActivityEnqueue.ts`, `src/sync/hubspot.ts`.

#### P2 — Outillage admin sync (V2, pas bloquant)

- Pas d'endpoint `POST /internal/sync/run` — `syncScheduler.runNow(dataset)` existe en code ; one-shot possible via shell Node. Action privilégiée → `admin.write` minimum si exposé HTTP plus tard.
- Pas de script npm `sync:seed` — le seed initial a marché sans ; construire quand un cas d'échec concret le réclame (debug, rollback).

#### Corrigé / non applicable

- ~~Monday + Drive n'appellent pas `refreshDatasetFreshness`~~ — **faux positif** : `finishSyncRun()` appelle `refreshFreshnessInternal()` dans `pgCoreStore.ts` pour tous les workers, y compris Monday et Drive.
- ~~Prod sans sync engine~~ — **résolu** : `pg_005` + queue worker actifs, readiness `ready`.
- **`/health/readiness`** exige tous datasets `healthy` — datasets Monday vides (`signals`, `events`) passent en `healthy: true` avec `recordsTotal: 0` après un sync réussi.

---

## 8. Credentials disponibles (2026-05-24)

| Variable | Statut |
| --- | --- |
| `HUBSPOT_API_TOKEN` | ✅ PAT Kevin, appId `38845196`, portail `7237029` |
| `HUBSPOT_WEBHOOK_CLIENT_SECRET` | ❌ à récupérer lundi (Auth tab Private App) |
| `MONDAY_API_TOKEN` | ✅ (si en `.env.secrets`) |
| `DATABASE_URL` | ✅ Scaleway |
| Drive SA JSON | ✅ `.secrets/tomcat-ai-backend-*.json` |
| `GOOGLE_DRIVE_SHARED_DRIVE_ID` | ✅ prod |

Nom affiché Private App « Tomcat-AI-Backend » : **non vérifiable via API** ; app existe (token OK, créée par Kevin).

---

## 9. Plan — prochaines étapes

### Phase A — Validation seed ✅ (2026-05-24)

1. ~~Confirmer sync engine déployé (`pg_005` + queue worker)~~ — fait
2. ~~Valider counts SQL + `/health/readiness`~~ — `ready`, 1 746 startups, activity complète
3. ~~Vérifier MCP lit Postgres~~ — `storeBacked` actif, datasets healthy
4. Identifier bug sync wasteful — fait (§7.4 P0)

### Phase B — Fix sync wasteful ✅ (deploy prod 2026-05-24)

1. ~~Retirer le re-enqueue systématique `startup_seed`~~ — fait
2. Redéployer + surveiller queue (`pending` doit tendre vers 0 et y rester)
3. Vérifier consommation API HubSpot sur 24 h post-deploy

### Phase C — Fraîcheur continue (P1, après secret webhook)

1. Récupérer `HUBSPOT_WEBHOOK_CLIENT_SECRET` (Private App Auth tab)
2. `seed-secrets.sh` + `patch-container-env.sh`
3. Config subscription HubSpot → `POST .../webhooks/hubspot`
4. Valider logs `hubspot_webhook_enqueued`

### Phase D — Élargir le read model (P2)

Décisions produit requises :

- **`raw_properties jsonb`** — YAGNI tant que Society n'a pas de filtre custom HubSpot
- Sync **contacts** associés ?
- **Delete / tombstone** strategy ?
- Drive : indexer métadonnées fichiers BP au-delà board packs ?
- **pgvector** : worker `knowledge_index_chunks` (phase sémantique Élie)
- **Outillage sync** (`sync-seed.mjs`, endpoint admin) — V2 leverage, pas prioritaire

---

## 10. Commandes utiles

```bash
# Tests
npm test && npm run typecheck

# Dev local avec Postgres (DATABASE_URL dans .env)
npm run dev

# Tunnel DB Scaleway
./scripts/scaleway/setup-db-dev-access.sh
./scripts/scaleway/db-psql.sh

# Deploy prod
./scripts/scaleway/build-push.sh
./scripts/scaleway/deploy-container.sh

# Patch env sans rebuild
./scripts/scaleway/patch-container-env.sh
```

Datasets valides pour `syncScheduler.runNow()` (usage dev one-shot, non exposé HTTP) :

- `hubspot.startups`
- `hubspot.activity.backfill`
- `hubspot.activity.queue`
- `hubspot.activity.reconcile`
- `monday.portfolio`
- `monday.signals`
- `monday.events`
- `drive.boardPacks`

Surveiller la queue HubSpot :

```sql
select status, count(*) from sync_queue group by status;
select reason, count(*) from sync_queue where status = 'pending' group by reason;
```

---

## 11. Questions ouvertes

| # | Question | Statut 2026-05-24 |
| --- | --- | --- |
| 1 | Tier seed initial : deals only ou notes full parc ? | **Tranché** : notes + deals + meetings pour tout le parc (~4,3k notes). Ne pas restreindre rétroactivement. |
| 2 | `raw_properties jsonb` sur startups ? | **YAGNI** — tant que Society n'a pas de filtre custom qui le réclame. |
| 3 | Monday portfolio = 8 portcos (Addeus, Aistos, Bloom, Fincome, Kabaun, Kaptcher, Magma, Seedext) | **À confirmer avec Kevin / Audrien (Dealfy)** — live API Monday = exactement 8 boards emoji ; pas une décision technique seule. |
| 4 | Monday events/signaux : quel board, qui câble ? | Ouvert — connector retourne `[]` volontairement. |
| 5 | `entity_aliases` : seed manuel ou inférence ? | Ouvert — résolution par nom fonctionne aujourd'hui. |
| 6 | Ordre phase 2 : vectorisation vs pagination Society ? | Ouvert. |
| 7 | Webhook HubSpot | **Phase 2** — secret manquant, reconcile 6 h suffit en interim. |

---

## 12. Résumé une phrase

**But final** : Postgres comme read model local (filtres SQL + vector search + Society 100 users). **Seed initial validé.** **Sync wasteful corrigé en code** (deploy + vérif API pending). Prochain pas : deploy, webhook lundi, pgvector.
