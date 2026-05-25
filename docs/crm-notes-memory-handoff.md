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
| Startups orphelines (activity-only) | +15 via ensure au sync |
| Notes indexables (body ≥ 100 chars) | 2 956 |
| Notes indexées | 2 956 (100 %) |
| Chunks vectoriels | ~5 912 (2 / note : recap + investment_lens) |
| Modèle sémantique | `gpt-5-mini` (structured JSON) |
| Embeddings | `text-embedding-3-small` (1536 dims) |
| Worker | Timer API server (~30 s, batch 20, concurrency 20) |

Vérifier : `npm run crm:index-status`

---

## 3. Architecture

```text
HubSpot (source de vérité)
        │
        ▼  sync activity (webhook / reconcile / backfill)
┌───────────────────────────────────────┐
│  Couche 1 — Read model Postgres       │  startups, notes, deals
│  hubspot.startups = annuaire filtré   │  lifecycle opportunity/customer/…
│  hubspot.activity = notes any company │  ensure startup si absent (option 2)
└───────────────────────────────────────┘
        │
        ▼  worker timer (API server, CRM_MEMORY_INDEX_ENABLED)
┌───────────────────────────────────────┐
│  Couche 2 — Index sémantique          │  knowledge_index_chunks + pgvector
│  note → LLM semantic card → embed     │  recap + investment_lens only
└───────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────┐
│  Couche 3 — MCP                       │  find_similar_cases (embed + pgvector)
└───────────────────────────────────────┘
```

**Important** : le worker tourne sur le **container API** (`src/server.ts`), pas sur `mcp:stdio` local. Le MCP remote lit l'index prod via Postgres.

**Index pipeline** (par note) :

1. LLM extrait une **semantic card** (`recap`, `investmentLens`, meta JSON)
2. Embed **recap** + **investment_lens** (pas le body brut)
3. Stocke dans `knowledge_index_chunks` (migration `pg_008_knowledge_index_vector.sql`)

**Invalidation** : `semantic_index_hash` remis à null + chunks supprimés si `body`, `startup_id` ou `author_email` change. Hash inclut `CRM_MEMORY_SCHEMA_VERSION`.

---

## 4. Tools MCP

| Tool | Rôle |
| --- | --- |
| `find_similar_cases` | **Mémoire sémantique** : cas historiques similaires (company-level) |
| `find_competitive_history` | Peers **même secteur HubSpot** + extraits notes (complément) |
| `read_startup_notes` | Notes d'une boîte (`authorEmail`, `sinceDays`, `minBodyLength`) |
| `summarize_company_activity` | Top facts ranked + pin Élie / M1-M2 |
| `resolve_entity` | Prérequis avant reads ciblés |

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
| `src/services/crmMemory/indexNote.ts` | Index worker batch |
| `src/services/crmMemory/semanticCard.ts` | LLM structured card (index only) |
| `src/prompts/crmMemory/prompts.ts` | Prompt index + golden example Favikon |
| `src/sync/crmMemoryIndexWorker.ts` | Worker scheduler |
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
```

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
| Qualité searchTexts | Claude doit écrire des extraits denses style recap/investment_lens |
| Annuaire vs activity | Notes syncées pour boîtes hors lifecycle funnel ; corrigé par ensure |
| MCP local stdio | Pas de worker index ; utiliser MCP remote ou API prod |
| Cosmétique / tags sectoriels | Peu de notes taguées → préférer searchTexts métier explicites |

---

## 12. Tests

```bash
npm test   # tests/services/similarCases.test.ts, crmMemory.test.ts, ensureHubspotStartup
```

Manuel : queries payroll B2B, Oscar AI profile, note anchor Élie (`84190149041`).

Benchmark query-time (2026-05-25, prod DB, sans HyDE) :

| Path | Latence | Top matches |
| --- | --- | --- |
| `searchTexts` payroll B2B | ~3.1 s | DATA DRIVEN, Noota, Lisy ex Snapkey |
| `query` direct embed | ~1.3 s | CLIKING, Wobee, BPartners artisans |
| `noteId` Favikon | ~1.5 s | Tenors, Ocean Pink UMAY, Citydays |

---

## 13. Résumé

**Le read model + index sémantique sont en prod.** `find_similar_cases` est le tool central pour la mémoire transversale. Prochain pas produit : `prepare_m1_meeting_brief` (Phase C).
