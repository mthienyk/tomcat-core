# Handoff — Mémoire CRM Tomcat (notes HubSpot + MCP)

Dernière mise à jour : 2026-05-24

Note de reprise pour le projet **« capital connaissance »** : faire remonter les bonnes notes HubSpot au bon moment (prep M1/M2, concurrents, prep Kevin), via le MCP et le read model Postgres.

Documents liés :

- [local-read-model-handoff.md](./local-read-model-handoff.md) — infra Postgres, sync HubSpot, pgvector (couche 2)
- [mcp-work-status.md](./mcp-work-status.md) — état tools MCP, prod Scaleway
- [mcp-use-cases.md](./mcp-use-cases.md) — UC-KEV-05, UC-ELI-01 à 06 (spec normative)
- Transcript source : `tomcat-audit/data/transcripts/session_factory_2.txt` (réunion Factory avec Élie)

---

## 1. Contexte

Tomcat accumule depuis des années des **notes HubSpot** sur le funnel startup (~4 300 notes en read model, ~11 000 sur le portail complet). Une part importante est produite par **Élie** lors des **M1** (entretien sélection) : prep 45 min, call 1h15, **note de synthèse 45 min** dans HubSpot. Ces notes alimentent l'analyse (two-pager, M2, etc.).

**Problème** : cette mémoire est **enterre dans le CRM**. Kevin et Élie la connaissent partiellement de tête ; la retrouver demande du temps (« aller au fin fond d'HubSpot »). Claude sans MCP ne voit rien ; Claude avec MCP actuel ne fait que du **sector matching**, pas de la **similarité de contenu** ni de filtre auteur.

**Citation use case (transcript Factory 2, Kevin / Élie)** :

> « Je vais voir telle boîte demain… sors-moi les boîtes concurrentes qu'on a vues sur ce segment… j'avais fait une note M1 il y a deux ans sur une boîte concurrente, sors-moi les nuggets. »

> « Sur une boîte concurrente direct, tu avais évalué le marché comme ça — est-ce que tu l'évalues toujours comme ça ? »

**Priorité produit #1** (décision conversation 2026-05-24) : **rapprocher les notes d'Élie (M1/M2) avec des notes similaires sur d'autres boîtes**, pour prep et mémoire transversale.

---

## 2. Objectifs (north star)

| Objectif | Mesure de succès |
| --- | --- |
| **Mémoire boîte** | « Qu'est-ce qu'on sait sur X ? » inclut notes récentes + synthèses M1/M2, avec auteur et date cités |
| **Mémoire segment** | « Boîtes similaires + ce qu'on en a dit » sans scan manuel du CRM |
| **Notes similaires** | « Cette note / cette boîte ressemble à quoi qu'on a déjà vu ? » via recherche sémantique |
| **Hinting Claude** | Le MCP guide les chaînes d'outils ; l'agent n'invente pas de faits CRM |
| **Latence / quotas** | Lectures depuis Postgres (read model), pas N× calls HubSpot live |

**Hors scope immédiat** (même transcript, phases ultérieures) : synthèse post-M1 depuis transcript (`synthesize_m1_from_transcript`), brief corporate Eden Red, digest portefeuille mensuel, board debrief SideExt → Monday.

---

## 3. Personas et use cases

### 3.1 Élie — sélection (M1)

Workflow réel (transcript) :

1. **Prep** (~45 min) : deck, site, profils founders, grille formalisée, debunk (ex-Google, exits, mur de logos…)
2. **Call M1** (~1h15) : transcript SideExt / Gemini
3. **Note HubSpot** (~45 min) : synthèse structurée, ingrédient clé du process

| UC | Exemple query | Chaîne MCP cible |
| --- | --- | --- |
| UC-ELI-01 | « Prep M1 demain sur [Boîte] » | `resolve_entity` → `prepare_m1_meeting_brief` → `find_competitive_history` → deck |
| UC-ELI-02 | « Synthèse M1 depuis ce transcript » | `synthesize_m1_from_transcript` (P1, pas livré) |
| **Mémoire #1** | « Notes M2 d'Élie sur des boîtes proches de [Boîte] » | `find_similar_notes` + filtre auteur (à construire) |

### 3.2 Kevin — sourcing / prep

| UC | Exemple query | Chaîne MCP cible |
| --- | --- | --- |
| UC-KEV-04 | « Qu'est-ce qu'on sait sur [Boîte] ? » | `resolve_entity` → `summarize_company_activity` → `read_startup_notes` |
| UC-KEV-05 | « Compare aux HRTech qu'on a vues » | `resolve_entity` → `find_competitive_history` → `read_startup_notes` sur matches |
| **Mémoire #1** | « Note importante d'Elie hier sur une boîte du segment » | ranking récence + auteur (partiel aujourd'hui) |

### 3.3 Autres (P2)

- Brief corporate (Eden Red, tags HubSpot) — UC-ELI-05
- Digest portefeuille / boards — UC-ELI-03, ELI-06
- Posts LinkedIn depuis signaux CRM — mention transcript, non priorisé

---

## 4. État actuel (2026-05-24)

### 4.1 Données en Postgres (prod)

| Métrique | Valeur | Commentaire |
| --- | ---: | --- |
| Startups (funnel) | 1 746 | Filtre lifecycle + exclusion investisseurs à l'ingestion |
| Notes | 4 316 | Sous-ensemble du portail HubSpot (~11 192 notes totales) |
| Notes Élie | ~683 | `author_email = elie.dupredesaintmaur@tomcat.eu` |
| Notes pattern M1/M2 | ~1 317 | Heuristique regex sur le corps (`\bM[0-4]\b`, exec sum…) |
| `knowledge_index_chunks` | 0 | Table créée (`pg_005`), **non peuplée** |

**Écart HubSpot portal vs DB** : voulu. Seules les companies funnel startup sont syncées. Élargir le périmètre = décision produit.

**Fraîcheur** : reconcile 6 h + backfill à l'ajout ; webhook HubSpot phase 2 (secret manquant). Une note d'hier est en DB si la boîte est dans le funnel et le sync a tourné.

### 4.2 Tools MCP — ce qui existe

| Tool | Rôle | Mémoire notes |
| --- | --- | --- |
| `resolve_entity` | Router nom → ids | Prérequis |
| `summarize_company_activity` | **Default CRM read** : top facts ranked | Récence + boost M1/M2 dans le corps ; `authorEmail` dans le détail des faits |
| `read_startup_notes` | Toutes les notes **d'une** boîte | Complet, trié par date, permissions |
| `find_competitive_history` | Peers **même secteur HubSpot** + extraits notes | Proxy « concurrents vus » — **pas sémantique** |
| `list_company_crm_activity` | Dump notes/deals/meetings | Brut, utile pour timeline |
| `prepare_board_brief` | Prep board portco | Excerpts notes CRM |
| `find_similar_notes` | — | **N'existe pas** |
| `prepare_m1_meeting_brief` | — | **P0 doc, non implémenté** |

**Hinting Claude** : descriptions dans `src/agent/toolCopy.ts`, `nextSuggestedTools` dans les envelopes, instructions MCP dans `src/mcp/instructions.ts`.

**Ranking notes** (`companyActivitySummary.ts`) :

- Boost corps : `exec sum` +80, `M0–M4` +60, `board` +40
- Score récence : jusqu'à +100
- **Pas** de filtre auteur, **pas** de similarité sémantique

**Similarité concurrents** (`competitiveHistory.ts` + `startups.findSimilar`) :

- Intersection des **tags secteur** HubSpot entre startups visibles
- Par match : jusqu'à 3 extraits de notes (400 chars), les plus récentes
- Params : `limit` (max 25), `notesPerMatch` (max 10)

### 4.3 Ce qui marche déjà (exemples)

**Kevin — « Qu'est-ce qu'on sait sur Fabera ? »**

```text
resolve_entity("Fabera")
  → summarize_company_activity(startupId)
  → read_startup_notes(startupId)   # si besoin du détail
```

Notes récentes et synthèses M1 remontent si substantielles et récentes.

**Élie / Kevin — « Concurrents HRTech qu'on a vues »**

```text
resolve_entity("PayFit")   # ou sector seul
  → find_competitive_history(startupId | sector="hr", limit=15, notesPerMatch=5)
  → read_startup_notes(startupId) sur 2–3 matches pertinents
```

Claude synthétise le so-what ; filtre manuellement les notes Élie si besoin.

### 4.4 Gaps (priorisés)

| # | Gap | Impact | Piste |
| --- | --- | --- | --- |
| G1 | Pas de recherche **sémantique** entre notes | Use case #1 bloqué | pgvector + `find_similar_notes` |
| G2 | Pas de filtre **auteur** (`authorEmail`) sur les tools | « Notes d'Élie only » impossible proprement | Params sur `read_startup_notes`, `find_competitive_history`, futur `find_similar_notes` |
| G3 | `find_competitive_history` = secteur only | HRtech mal tagué → matches ratés | Sémantique + secteur en fallback |
| G4 | Extraits = 3 notes récentes / match, pas priorité M1/M2 | Nuggets historiques manquées | Ranker extraits par `noteQualityBoost` + auteur |
| G5 | `prepare_m1_meeting_brief` absent | Prep M1 non orchestrée | Nouveau tool P0 (deck + competitive + grille) |
| G6 | 11k notes portal hors DB | Boîtes hors funnel invisibles | Décision produit élargir sync |
| G7 | Index vectoriel vide | RAG / similar notes impossible | Worker post-sync (voir §6) |

---

## 5. Architecture cible

Trois couches (détail : [local-read-model-handoff.md §1.3](./local-read-model-handoff.md)) :

```text
HubSpot (source de vérité)
        │
        ▼  sync incrémental (reconcile 6h, webhook phase 2)
┌───────────────────────────────────────┐
│  Couche 1 — Read model relationnel    │  startups, notes, deals, meetings
│  (Postgres) — ✅ seed validé          │  → summarize_*, read_startup_notes
└───────────────────────────────────────┘
        │
        ▼  worker post-sync (fingerprint note changé)
┌───────────────────────────────────────┐
│  Couche 2 — Index sémantique          │  knowledge_index_chunks + pgvector
│  — ❌ à construire                    │  → find_similar_notes
└───────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────┐
│  Couche 3 — MCP + Society             │  toolCopy hints, ToolRunEnvelope
└───────────────────────────────────────┘
```

**Principe** : le MCP lit Postgres quand `healthy=true` (`storeBacked.ts`). Fallback live HubSpot au bootstrap seulement.

**Entité note** (contrat) : `src/domain/entities.ts` — `id`, `startupId`, `body`, `authorEmail`, `createdAt`, `sensitivity`, etc.

---

## 6. Roadmap proposée

### Phase A — Quick wins (sans pgvector)

Objectif : améliorer l'existant avec les 4 316 notes déjà en DB.

1. **`read_startup_notes`** : params optionnels `authorEmail`, `sinceDays`, `minBodyLength`
2. **`find_competitive_history`** :
   - `authorEmail` filter sur les extraits
   - tri des extraits par `noteQualityBoost` (M1/M2) puis récence
   - default `notesPerMatch` plus haut pour prep M1 (ex. 5)
3. **`summarize_company_activity`** : fact explicite « dernière note Élie » / « dernière note M1/M2 » si présente
4. **`toolCopy.ts` + `instructions.ts`** : renforcer chaînes prep M1/M2 et obligation de citer date + auteur
5. Tests contract sur UC-KEV-05 avec fixtures notes M1

**Effort estimé** : 1–2 jours. Débloque ~60 % du besoin Kevin, ~40 % du besoin Élie #1.

### Phase B — Index sémantique (use case #1 complet)

Objectif : « cette note / cette boîte ressemble à quoi qu'on a déjà vu ? »

1. Activer **pgvector** sur Scaleway si pas déjà fait (voir `provision-infra.sh`)
2. Worker post-sync :
   - notes dont fingerprint a changé → chunk (~500–800 tokens) → embedding
   - stocker dans `knowledge_index_chunks` (migration `pg_005` existe)
3. Nouveau tool **`find_similar_notes`** :
   - input : `noteId` | `startupId` + query text | query seul
   - filtres : `authorEmail`, `sector`, `since`, `limit`
   - output : matches avec score, excerpt, citation `noteId`, `startupId`
4. Embedding model : à choisir (OpenAI / Voyage / local) — aligner avec stack LLM existante
5. Backfill one-shot sur les 4 316 notes

**Effort estimé** : 3–5 jours. C'est le cœur du use case transcript.

### Phase C — Tools orchestrés (workflow Élie)

1. **`prepare_m1_meeting_brief`** (UC-ELI-01 P0) : deck + site hints + `find_competitive_history` + `find_similar_notes` + structure grille Élie
2. **`synthesize_m1_from_transcript`** (UC-ELI-02 P1) : draft note HubSpot, gate humain obligatoire

### Phase D — Décisions produit ouvertes

- Élargir sync notes au-delà du funnel startup ?
- HyDE pour requêtes ambiguës (« boîtes payroll B2B ») ?
- Indexer texte Drive (decks) dans le même index ou séparé ?

---

## 7. Chaînes MCP cibles (référence pour hints)

### Prep M1 (Élie)

```text
resolve_entity
  → find_latest_deck
  → find_competitive_history(startupId, notesPerMatch=5)
  → find_similar_notes(startupId | noteId, authorEmail=elie@..., limit=10)   # Phase B
  → read_startup_notes(startupId)
  → prepare_m1_meeting_brief   # Phase C
```

### Question Kevin sur une boîte

```text
resolve_entity
  → summarize_company_activity
  → find_competitive_history (si prep ou segment)
  → read_startup_notes (si trou pertinent)
```

### Mémoire transversale (use case #1)

```text
find_similar_notes(query="payroll B2B SaaS churn", authorEmail=elie@..., limit=15)
  → read_startup_notes sur top 3 startupIds
  → find_competitive_history(sector=...) en complément si peu de matches
```

**Règles agent** (à maintenir dans `instructions.ts`) :

- Toujours **citer** `noteId`, auteur, date
- Ne pas publier de note HubSpot sans approbation explicite
- Sur prep M1/M2 : appeler `find_competitive_history` **avant** de conclure sur le segment
- Distinguer note ops courte vs synthèse M1/M2 (longueur + pattern corps)

---

## 8. Fichiers clés (où coder)

| Fichier | Rôle |
| --- | --- |
| `src/services/competitiveHistory.ts` | Logique peers + extraits |
| `src/services/companyActivitySummary.ts` | Ranking facts CRM |
| `src/services/startups.ts` | `listAccessibleNotes`, `findSimilar` |
| `src/connectors/storeBacked.ts` | Lecture notes depuis Postgres |
| `src/connectors/hubspot.ts` | Mapping API → `Note` |
| `src/agent/toolRegistry.ts` | Enregistrement tools |
| `src/agent/toolCopy.ts` | Descriptions / hints Claude |
| `src/mcp/instructions.ts` | Instructions serveur MCP |
| `src/storage/migrations/pg_005_sync_engine.sql` | `knowledge_index_chunks` |
| `docs/mcp-use-cases.md` | UC-KEV-05, UC-ELI-01 |

---

## 9. Validation / tests

**Manuel (MCP local ou remote)** :

1. `resolve_entity("Referly")` → `find_competitive_history` → vérifier matches secteur + extraits
2. `read_startup_notes` sur boîte avec notes Élie connues
3. `summarize_company_activity` → vérifier qu'une note M2 récente remonte dans les top facts

**Automatisé** :

- `tests/mcp/server.test.ts` — envelope `find_competitive_history`
- À ajouter : tests filtre auteur, ranking M1/M2 extraits, `find_similar_notes` (Phase B)

**SQL utile** :

```sql
-- Top auteurs
select author_email, count(*) from notes group by 1 order by 2 desc limit 10;

-- Notes Élie récentes
select s.name, n.created_at, left(n.body, 120)
from notes n join startups s on s.id = n.startup_id
where n.author_email = 'elie.dupredesaintmaur@tomcat.eu'
order by n.created_at desc limit 10;

-- Chunks index (Phase B)
select count(*) from knowledge_index_chunks;
```

---

## 10. Questions ouvertes

| # | Question | Statut |
| --- | --- | --- |
| 1 | Email canonique Élie pour filtre auteur ? | `elie.dupredesaintmaur@tomcat.eu` (683 notes) — confirmer si alias |
| 2 | M2 vs M1 : heuristique corps suffisante ou champ HubSpot dédié ? | Aujourd'hui regex `\bM[0-4]\b` — pas de property HubSpot typée |
| 3 | Modèle embedding pour pgvector ? | Non tranché |
| 4 | Phase A avant B ou parallèle ? | Recommandation : **A puis B** (hints + filtres utiles tout de suite) |
| 5 | Élargir périmètre sync notes (11k portal) ? | Produit — pas bloquant pour use case funnel |
| 6 | `prepare_m1_meeting_brief` : playbook markdown comme BP ? | À spec (grille Élie formalisée hors repo aujourd'hui) |

---

## 11. Résumé une phrase

**Le read model a les notes ; il manque la couche « mémoire intelligente »** (filtres auteur, ranking M1/M2, similarité sémantique) pour que Kevin et Élie retrouvent les nuggets CRM en langage naturel via MCP, comme décrit dans le transcript Factory 2.

**Prochain pas recommandé** : Phase A (filtres + ranking) en parallèle de l'activation pgvector Scaleway, puis Phase B `find_similar_notes`.
