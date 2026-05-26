# Handoff — Mémoire CRM Tomcat (notes HubSpot + MCP)

Dernière mise à jour : 2026-05-25

Note de reprise pour le projet **« capital connaissance »** : faire remonter les bonnes notes HubSpot au bon moment (prep M1/M2, concurrents, prep Kevin), via le MCP et le read model Postgres.

Documents liés :

- [local-read-model-handoff.md](./local-read-model-handoff.md) — infra Postgres, sync HubSpot, pgvector
- [mcp-work-status.md](./mcp-work-status.md) — état tools MCP, prod Scaleway
- [mcp-use-cases.md](./mcp-use-cases.md) — UC-KEV-05, UC-ELI-01 à 06

---

## 1. Contexte

Tomcat accumule des **notes HubSpot** sur le funnel startup (~4 300 notes en read model). Une part importante est produite par **Élie** lors des **M1** : prep, call, **note de synthèse** dans HubSpot.

**Problème résolu (Phase B)** : recherche **sémantique** cross-boîtes via `find_similar_cases`, pas seulement sector matching.

**Priorité produit #1** : rapprocher les notes d'Élie (M1/M2) avec des cas historiques similaires pour prep et mémoire transversale.

---

## 2. État prod (2026-05-25)

| Métrique | Valeur |
| --- | ---: |
| Startups (annuaire funnel) | ~1 746 |
| Notes brutes (read model) | ~4 351 |
| Notes indexables sémantiques (body ≥ 500 chars, non-ops) | ~1 655 |
| Chunks vectoriels (post-curation) | ~3 310 (2 / note : recap + investment_lens) |
| Notes courtes exclues (`skip:short`) | ~2 745 |
| Modèle sémantique | `gpt-5-mini` (structured JSON) |
| Embeddings | `text-embedding-3-small` (1536 dims) |
| Worker | Timer API server (~30 s, batch 20, concurrency 20) + drain post-sync HubSpot |

Vérifier : `npm run crm:index-status`

**Deux couches distinctes** :

| Couche | Contenu | Tools |
| --- | --- | --- |
| Read model brut | Toutes les notes HubSpot sync | `read_startup_notes`, `grep_crm_notes` |
| Index sémantique | Notes longues non-ops, extraits LLM | `find_similar_cases` |

---

## 3. Architecture

```text
HubSpot (source de vérité)
        │
        ▼  sync activity (webhook / reconcile / backfill / queue)
┌───────────────────────────────────────┐
│  Couche 1 — Read model Postgres       │  startups, notes, deals
│  hubspot.startups = annuaire filtré   │  lifecycle opportunity/customer/…
│  hubspot.activity = notes any company │  ensure startup si absent (option 2)
└───────────────────────────────────────┘
        │
        │  upsertNote → invalidation immédiate (chunks supprimés, skip:short ou pending)
        │  post-sync queue → drainCrmMemoryIndex (3 passes max, non bloquant)
        ▼  worker timer (~30 s, filet de sécurité)
┌───────────────────────────────────────┐
│  Couche 2 — Index sémantique          │  knowledge_index_chunks + pgvector
│  note → LLM semantic card → embed     │  recap + investment_lens only
└───────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────┐
│  Couche 3 — MCP                       │  find_similar_cases (vecteur)
│                                       │  grep_crm_notes (keyword, corps brut)
└───────────────────────────────────────┘
```

**Important** : le worker tourne sur le **container API** (`src/server.ts`), pas sur `mcp:stdio` local. Le MCP remote lit l'index prod via Postgres.

**Index pipeline** (par note) :

1. LLM extrait une **semantic card** (`recap`, `investmentLens`, meta JSON)
2. Embed **recap** + **investment_lens** (pas le body brut)
3. Stocke dans `knowledge_index_chunks` (migration `pg_008_knowledge_index_vector.sql`)

**Invalidation à l'upsert** (`planSemanticIndexOnNoteUpsert`) :

| Changement | Action |
| --- | --- |
| `body`, `startup_id` ou `author_email` modifié | chunks supprimés |
| Nouvelle note / note modifiée, body < 500 chars | `skip:short:…` immédiat (pas d'attente worker) |
| Nouvelle note / note modifiée, body ≥ 500 chars | `semantic_index_hash = null` → pending |
| Autres champs (sensitivity, dates…) | hash conservé |

**Priorité worker** : notes récemment sync (`synced_at desc`) en tête de file.

**Post-sync HubSpot** : après chaque batch queue avec notes sync, `drainCrmMemoryIndex` lance jusqu'à 3 passes du worker en arrière-plan (n bloque pas la queue sync).

Hash indexé inclut `CRM_MEMORY_SCHEMA_VERSION`.

---

## 4. Tools MCP

| Tool | Rôle |
| --- | --- |
| `find_similar_cases` | **Mémoire sémantique** : cas historiques similaires (company-level) |
| `grep_crm_notes` | **Recherche keyword** sur corps bruts HubSpot (ILIKE, read model local) |
| `find_competitive_history` | Peers **même secteur HubSpot** + extraits notes (complément) |
| `read_startup_notes` | Notes d'une boîte (`authorEmail`, `sinceDays`, `minBodyLength`) |
| `summarize_company_activity` | Top facts ranked + pin Élie / M1-M2 |
| `resolve_entity` | Prérequis avant reads ciblés |

### `grep_crm_notes`

Recherche **substring** case-insensitive sur les notes brutes (complément du vecteur).

**Inputs** :

- **`query`** (requis) — termes séparés par espaces ; guillemets pour phrases (`"gestion locative" Silae`)
- **`matchMode`** — `all` (défaut, tous les termes) ou `any`
- **`startupId` / `startupName`** — scope une boîte ; omit = tout le portefeuille accessible
- **`authorEmail`, `sinceDays`, `limit`**

**Chaîne typique** : `grep_crm_notes` → `read_startup_notes` sur un hit → `find_similar_cases(noteId=…)` si voisins sémantiques utiles.

**Limites** : pas de stemming/fuzzy ; cherche le corps brut, pas les extraits `recap`/`investment_lens`.

### `find_similar_cases`

**Query-time** (MCP) : Claude rédige `searchTexts` denses → embed → pgvector → evidence. Pas de LLM serveur au query-time.

**Inputs** (au moins un parmi searchTexts / query / noteId) :

- **`searchTexts`** (recommandé) — 1–3 extraits denses style note M1 / investment_lens, rédigés par Claude
- **`query`** — embed direct (fallback)
- **`noteId`** — embed le corps d'une note connue
- **`startupId`** — metadata + exclusion de la boîte courante (pas de recherche auto)

**Filtres** : `authorEmail`, `sector`, `sinceDays`, `chunkKind`, `limit`

**Output** : matches agrégés par startup (`whySimilar`, `soWhat`, `topEvidence` avec noteId + date)

**Chaîne recommandée prep M1/M2** :

```text
resolve_entity
  → (Claude rédige searchTexts denses à partir du deck + contexte)
  → find_similar_cases(searchTexts, startupId, authorEmail=elie@..., sinceDays=1095)
  → read_startup_notes sur top 2 matches
  → find_similar_cases(noteId=..., authorEmail=elie@...) si une note clé ressort
  → find_competitive_history en complément secteur
```

---

## 5. Fichiers clés

| Fichier | Rôle |
| --- | --- |
| `src/services/crmMemory/similarCases.ts` | Query-time : embed + search + agrégation |
| `src/services/crmMemory/grepCrmNotes.ts` | Keyword search MCP (`grep_crm_notes`) |
| `src/services/crmMemory/indexInvalidation.ts` | Plan invalidation à l'upsert note |
| `src/services/crmMemory/indexNote.ts` | Index worker batch |
| `src/services/crmMemory/semanticCard.ts` | LLM structured card (index only) |
| `src/prompts/crmMemory/prompts.ts` | Prompt index + golden example Favikon |
| `src/sync/crmMemoryIndexWorker.ts` | Worker + `drainCrmMemoryIndex` post-sync |
| `src/sync/ensureHubspotStartup.ts` | Ensure startup au activity sync + worker |
| `src/connectors/hubspotCompanyMapping.ts` | Mapping company HubSpot → Startup |
| `src/storage/migrations/pg_008_knowledge_index_vector.sql` | pgvector + semantic_index_hash |
| `scripts/crmMemoryIndexStatus.ts` | `npm run crm:index-status` |
| `scripts/crmMemoryEnsureOrphanStartups.ts` | Backfill startups orphelines |
| `scripts/crmMemoryQueryBenchmark.ts` | `npm run crm:query-benchmark` |

---

## 6. Env prod

```text
CRM_MEMORY_INDEX_ENABLED=true
CRM_MEMORY_INDEX_BATCH_SIZE=20
CRM_MEMORY_INDEX_CONCURRENCY=20
CRM_MEMORY_INDEX_INTERVAL_MS=30000
CRM_MEMORY_SEMANTIC_MODEL=gpt-5-mini
CRM_MEMORY_EMBEDDING_MODEL=text-embedding-3-small
OPENAI_API_KEY=…
```

Local dev : `CRM_MEMORY_INDEX_ENABLED=false` (protège clés perso). Index lu via `DATABASE_URL` prod.

---

## 7. Scripts ops

```bash
npm run crm:index-status
npm run crm:ensure-orphan-startups   # backfill startups manquantes dans annuaire
npm run crm:query-benchmark          # latence searchTexts / query / noteId (prod DB)
npm run crm:purge-ineligible-notes   # purge ops + notes < 500 chars, reset for reindex
npm run crm:reindex-all              # full v3 HyDe + embed (--dry-run, --no-reset, --reset-only)
npm run crm:golden-eval              # nDCG@5 sur golden set → docs/crm-memory-golden-eval-latest.json
```

Golden set canonique : `src/services/crmMemory/goldenSet.ts` (YAML dans `docs/crm-memory-golden-set.yaml` pour review Élie).

Baseline prod (2026-05-25, avant purge index) :

| Métrique | Valeur |
| --- | ---: |
| mean nDCG@5 | 0.47 |
| payroll (Silae/PayFit) | 0.72 |
| proptech (Pinql-style) | 0.27 |
| Favikon note anchor | 0.89 |
| regime anti-pattern | pass (low) |

---

## 8. Phase A — ✅ livré

- `read_startup_notes` : `authorEmail`, `sinceDays`, `minBodyLength`
- `find_competitive_history` : filtre auteur, ranking M1/M2
- `summarize_company_activity` : pin Élie / M1-M2
- Hints MCP (`toolCopy`, `instructions`)

---

## 9. Phase B — ✅ livré

- pgvector + worker + backfill (~2 956 notes)
- `find_similar_cases` + `searchTexts` client-side (embed direct, pas de LLM query-time)
- Ensure startup orphelin (activity sync + worker + script backfill)
- Invalidation index sur edit note / metadata

---

## 10. Phase C — à faire

- **`prepare_m1_meeting_brief`** : orchestration deck + competitive + similar + grille Élie
- **`synthesize_m1_from_transcript`** (P1, gate humain)

---

## 11. Limites connues

| Limite | Détail |
| --- | --- |
| Symétrie d'encodage | `searchTexts` doivent ressembler aux extraits raffinés (`recap` / `investment_lens`), vocabulaire opérationnel |
| Score ≠ qualité | `regimeSignals.scoreLevel` mesure la conformité au régime d'encodage ; inspecter `qualitySignals.noisyTopMatch` |
| Index curation | Notes `ops` et corps `< 500` chars exclus à l'indexation (skip hash) |
| Grep vs sémantique | `grep_crm_notes` cherche le corps brut ; `find_similar_cases` cherche les extraits LLM |
| `authorEmail` | Ne pas filtrer au premier appel sémantique ; filtrer dans `read_startup_notes` ensuite |
| `chunkKind` | `recap` = wedge produit ; `investment_lens` = profil de jugement (cross-secteur possible) |
| Annuaire vs activity | Notes syncées pour boîtes hors lifecycle funnel ; corrigé par ensure |
| MCP local stdio | Pas de worker index ; utiliser MCP remote ou API prod |
| Sector tags | `find_competitive_history` trop grossier pour wedge produit précis |
| Post-sync drain | 3 passes max par batch ; gros volumes restent rattrapés par le timer 30 s |

---

## 12. Tests

```bash
npm test   # indexInvalidation, grepTerms, similarCases, crmMemory, ensureHubspotStartup
```

Manuel post-deploy :

1. `npm run crm:index-status` — vérifier pending / skip:short
2. MCP `grep_crm_notes({ query: "Silae PayFit", matchMode: "any" })`
3. MCP `find_similar_cases` avec searchTexts opérationnels (payroll, proptech)
4. Modifier une note HubSpot → vérifier reindex dans les logs (`crm_memory_index_after_hubspot_sync`)

Benchmark query-time (2026-05-25, prod DB, sans HyDE) :

| Path | Latence | Top matches |
| --- | --- | --- |
| `searchTexts` payroll B2B | ~3.1 s | DATA DRIVEN, Noota, Lisy ex Snapkey |
| `query` direct embed | ~1.3 s | CLIKING, Wobee, BPartners artisans |
| `noteId` Favikon | ~1.5 s | Tenors, Ocean Pink UMAY, Citydays |

---

## 13. Résumé

**Le read model + index sémantique sont en prod.** `find_similar_cases` est le tool central pour la mémoire transversale. Prochain pas produit : `prepare_m1_meeting_brief` (Phase C).
