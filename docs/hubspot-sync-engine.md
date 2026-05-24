# HubSpot sync engine

Dernière mise à jour : 2026-05-24

Document de référence pour la copie locale HubSpot dans Postgres (Scaleway), la fraîcheur des datasets MCP, et la préparation de l'index sémantique.

Complète :

- [README.md](../README.md) — CoreStore et sync workers
- [mcp-work-status.md](./mcp-work-status.md) — état MCP
- [mcp-use-cases.md](./mcp-use-cases.md) — use cases Élie / mémoire Tomcat

---

## 1. Problème

HubSpot est la source de vérité CRM, mais :

| Contrainte | Impact |
| --- | --- |
| Rate limits API (~100 req / 10 s burst, cap journalier partagé) | Impossible de scanner tout le CRM à chaque requête MCP |
| Pas de webhook natif sur Notes / Engagements | Les changements d'activité ne sont pas push en temps réel de façon fine |
| Latence API (~300–500 ms / call) | Les agents MCP enchaînent plusieurs reads → 429 et lenteur |
| Vectorisation | Nécessite une copie locale stable + fingerprints de contenu |

**Objectif** : Postgres Scaleway comme read model, alimenté de façon contrôlée, avec mise à jour rapide après changement HubSpot sans cron naïf toutes les 15 minutes sur tout le parc.

---

## 2. Architecture retenue

```text
HubSpot (source)
      │
      ├─ webhook company.*  ──► POST /webhooks/hubspot ──► sync_queue
      │
      ├─ reconcile (6 h)    ──► search hs_lastmodifieddate ──► sync_queue
      │
      └─ backfill / seed    ──► startups sync ──► sync_queue
                │
                ▼
         sync_queue (Postgres, durable)
                │
                ▼
    queue worker (5 s, batch 3, rate-limited)
                │
                ├─ deals / notes / meetings ──► tables CoreStore
                ├─ hubspot_company_sync_state (fingerprint)
                └─ refresh dataset_freshness (notes, deals, meetings)
                │
                ▼
         MCP tools lisent Postgres (storeBacked)
                │
                ▼
    (phase 2) knowledge_index_chunks ──► embeddings pgvector
```

Trois modes de déclenchement, un seul pipeline d'exécution :

1. **Webhook** — latence faible quand HubSpot pousse un changement company
2. **Queue poll** — consommation rate-limited, reprise sur erreur
3. **Reconcile** — filet de sécurité périodique avec overlap

---

## 3. Dilemmes et choix

### 3.1 Full rescan vs queue incrémentale

| Option | Pour | Contre | Décision |
| --- | --- | --- | --- |
| Rescan toutes les 15 min (V0) | Simple | 429, lent, inutile si rien n'a changé | **Abandonné** |
| Queue par company | Throttled, reprise, webhook-friendly | Plus de tables | **Retenu** |
| HubSpot Search en temps réel à chaque MCP call | Toujours frais | Rate limit Search (4 req/s), latence | **Rejeté** |

### 3.2 Webhook Notes vs proxy company

HubSpot **ne supporte pas** de webhook direct sur les objets Engagement (Notes, Meetings, etc.).

**Choix** : s'abonner aux événements `company.propertyChange` (ex. `hs_lastmodifieddate`, activité récente) et enqueue la company → refetch associations notes/deals/meetings.

| Edge case | Comportement |
| --- | --- |
| Note ajoutée | Détectée via changement company (souvent last activity) |
| Note **modifiée** sans toucher la company | **Peut être manquée** → reconcile 6 h |
| Deal déplacé de stage | `hs_lastmodifieddate` company ou deal → reconcile |
| Company archivée / fusionnée | Reconcile + stale rows restent en base (pas de delete cascade V1) |

### 3.3 Fréquence reconcile

| Option | Décision |
| --- | --- |
| Reconcile toutes les 15 min | Trop agressif sur Search API |
| Reconcile toutes les 6 h + overlap 5 min | **Retenu** (`SYNC_RECONCILE_*`) |
| Pas de reconcile | Trop risqué si webhook raté |

### 3.4 Rate limiting

HubSpot private app : ~100 req / 10 s (burst), cap journalier selon tier ([docs HubSpot](https://developers.hubspot.com/docs/developer-tooling/platform/usage-guidelines)).

**Choix** : sliding window à **90 req / 10 s** (`HUBSPOT_MAX_REQUESTS_PER_10S`), appliqué sur **tous** les calls du connector HubSpot HTTP.

Le HTTP client garde ses retries 429 avec `Retry-After` en plus.

### 3.5 Freshness datasets (bug corrigé)

Le worker V0 écrivait sous `hubspot.activity` mais `storeBacked` lisait `hubspot.notes`, `hubspot.deals`, `hubspot.meetings`.

**Fix** : après chaque batch queue, `refreshDatasetFreshness` sur les trois datasets séparément.

### 3.6 Batch size queue

| batch | Temps approx. par company | Throughput |
| --- | --- | --- |
| 1 | ~3–8 API calls | Lent mais sûr |
| 3 (défaut) | parallèle séquentiel par job | Bon compromis |
| 20 | risque 429 | Rejeté |

Configurable via `SYNC_QUEUE_BATCH_SIZE` (max 20).

### 3.7 Dedup queue

`dedupe_key = hubspot.activity:startup:{companyId}` — une seule job pending/running par company.

Webhook + reconcile + backfill sur la même company → **deduped**, pas de tempête.

### 3.8 Stale jobs

Si un replica crash mid-job, `locked_at` reste set.

**Choix** : `releaseStaleSyncJobs` après 10 min (`SYNC_QUEUE_STALE_JOB_MS`) remet en pending.

### 3.9 Signatures webhook

HubSpot envoie v1 (Private Apps), v2 (workflows) ou v3 (OAuth apps). Le serveur tente :

1. **v3** si `X-HubSpot-Signature-v3` + timestamp (HMAC base64)
2. **v2** si `X-HubSpot-Signature-Version: v2` (SHA256 hex, secret + method + uri + body)
3. **v1** si signature seule (SHA256 hex, secret + body) — **cas Private App standard**

`HUBSPOT_WEBHOOK_PUBLIC_URL` permet de matcher l'URI complète derrière Scaleway si le path seul échoue.

Le body brut est capturé via hook Fastify `preParsing` (pas `JSON.stringify(req.body)`).

Secret = **Client secret** de la Private App HubSpot (`HUBSPOT_WEBHOOK_CLIENT_SECRET`).

| Credential | Format | Usage |
| --- | --- | --- |
| Access token | `pat-na1-...` | `HUBSPOT_API_TOKEN` — API calls |
| Client secret | UUID (`xxxxxxxx-xxxx-...`) | Webhook signature only |

HubSpot → Settings → Integrations → Private Apps → [app] → Auth → **Show secret**.

Ce n'est **pas** le PAT. Si tu mets le PAT dans `HUBSPOT_WEBHOOK_CLIENT_SECRET`, la validation échouera toujours.

Fenêtre timestamp : 5 minutes (replay protection).

**Edge case URI** : proxies Scaleway peuvent réécrire le path → normalisation partielle des encodages URL. Si validation échoue en prod, vérifier que `req.url` correspond à l'URL enregistrée dans HubSpot.

### 3.10 Pas de delete cascade V1

Si une note est supprimée dans HubSpot, la copie Postgres **reste** jusqu'à une stratégie de tombstones (phase 2).

**Pourquoi** : HubSpot ne signale pas toujours les deletes ; éviter de perdre de la matière pour la vectorisation.

---

## 4. Tables

| Table | Rôle |
| --- | --- |
| `notes`, `deals`, `meetings` | Read model CRM (existant) |
| `sync_queue` | Jobs durable par company |
| `sync_cursors` | Watermark reconcile |
| `hubspot_company_sync_state` | Dernier sync, counts, fingerprint notes |
| `knowledge_index_chunks` | Préparation index sémantique (phase 2) |
| `dataset_freshness` | Gate MCP storeBacked |

Migration : `src/storage/migrations/pg_005_sync_engine.sql`

---

## 5. Workers et scheduling

| Worker | Dataset run id | Fréquence |
| --- | --- | --- |
| `hubspotStartupsWorker` | `hubspot.startups` | 15 min |
| `hubspotActivityBackfillWorker` | `hubspot.activity.backfill` | 15 min |
| `createHubspotActivityQueueWorker` | `hubspot.activity.queue` | **5 s** |
| `createHubspotActivityReconcileWorker` | `hubspot.activity.reconcile` | **6 h** |
| Monday / Drive | inchangé | 15 min |

Locks Postgres advisory :

- `SYNC_SCHEDULER_LOCK_KEY` — periodic + reconcile manuel
- `SYNC_QUEUE_LOCK_KEY` — queue processor (séparé pour ne pas bloquer 15 min)

---

## 6. Configuration

```bash
# Rate limit HubSpot outbound
HUBSPOT_MAX_REQUESTS_PER_10S=90

# Queue processor
SYNC_QUEUE_POLL_INTERVAL_MS=5000
SYNC_QUEUE_BATCH_SIZE=3
SYNC_QUEUE_STALE_JOB_MS=600000
SYNC_QUEUE_RETRY_DELAY_MS=60000

# Reconcile safety net
SYNC_RECONCILE_INTERVAL_MS=21600000   # 6 h
SYNC_RECONCILE_LOOKBACK_MS=300000      # 5 min overlap

# Webhook signature (HubSpot app client secret)
HUBSPOT_WEBHOOK_CLIENT_SECRET=
```

Webhook URL prod : `POST https://<core-api>/webhooks/hubspot`

Abonnements HubSpot recommandés :

- `company.propertyChange` → `hs_lastmodifieddate`
- (optionnel) autres propriétés company utiles au dealflow

---

## 7. Observabilité

| Endpoint | Accès | Contenu |
| --- | --- | --- |
| `GET /health/readiness` | public | `dataset_freshness` |
| `GET /internal/sync/freshness` | internal | détail freshness |
| `GET /internal/sync/queue/hubspot.activity` | internal | pending/running/dead |

Logs structurés :

- `hubspot_webhook_enqueued`
- `hubspot_activity_sync_job_failed`
- `sync_queue_stale_jobs_released`
- `queue batch complete`

---

## 8. Backfill initial (premier deploy)

Ordre attendu :

1. Deploy avec `DATABASE_URL` + `HUBSPOT_API_TOKEN`
2. `hubspot.startups` sync → seed queue (`startup_seed`)
3. `hubspot.activity.backfill` → companies sans `hubspot_company_sync_state`
4. Queue worker consomme ~3 companies / 5 s, throttled

Estimation grossière : 500 companies × ~5 calls ≈ 2500 calls → ~4–8 min à 90 req/10s (hors associations volumineuses).

Surveiller `GET /internal/sync/queue/hubspot.activity` jusqu'à `pending ≈ 0`.

---

## 9. Phase 2 — index sémantique

La table `knowledge_index_chunks` est créée mais **non peuplée** dans cette phase.

Prochaines étapes :

1. Worker post-sync : notes dont le fingerprint a changé → chunks → embeddings (`pgvector`, extension déjà tentée dans `pg_000`)
2. Tool MCP `find_similar_notes` sur Postgres local, zéro call HubSpot
3. HyDE branché uniquement sur requêtes ambiguës (voir discussion architecture MCP)

---

## 10. Edge cases checklist

| Cas | Statut V1 |
| --- | --- |
| HubSpot 429 pendant sync | Retry job après 60 s, max 5 attempts → dead |
| Replica shutdown mid-job | Stale release 10 min |
| Webhook duplicate | Dedup queue |
| Company inconnue (pas dans startups) | Sync quand même (notes orphelines possibles) |
| MCP read avant backfill | Fallback live HubSpot si `healthy=false` |
| Note edit sans webhook | Reconcile 6 h max delay |
| Search API indisponible | Reconcile fail, retry au prochain cycle |
| pgvector absent Scaleway | Extension skipped (notice), chunks sans embedding OK |

---

## 11. Références HubSpot

- [API usage guidelines and limits](https://developers.hubspot.com/docs/developer-tooling/platform/usage-guidelines)
- [Validating webhook requests v3](https://developers.hubspot.com/docs/apps/developer-platform/build-apps/authentication/request-validation)
- [Community — webhook on note via Last Activity / company proxy](https://community.hubspot.com/t5/APIs-Integrations/Trigger-webhook-on-adding-note-to-a-company/m-p/833185)
