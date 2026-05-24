# MCP Tomcat — note de reprise

Dernière mise à jour : 2026-05-24 (post test live)

Document de handoff pour reprendre le travail sur le MCP Tomcat Core. Spec normative : [mcp-use-cases.md](./mcp-use-cases.md).

> **Pivot conception 2026-05-24** : les outils MCP retournent des **mini-livrables** (briefs synthétiques ranked) plutôt que de la donnée brute. Le LLM choisit le tool et rédige la réponse finale ; le service Tomcat fait le ranking, le scoring et la synthèse. Voir [Leçons live](#leçons-du-test-live-2026-05-24) ci-dessous.

---

## Ce qu'on fait

Construire un **MCP opinionné** pour Tomcat : des tools orientés tâches (pas des wrappers API), consommables par Claude Desktop, Cursor, Society, et futurs clients investisseurs.

Deux surfaces prévues :

| Surface | Auth | Tools |
|---------|------|-------|
| **Internal** (stdio aujourd'hui) | Google OAuth local (`npm run auth:google`) | 25 tools complets |
| **Investor** (HTTP, futur) | OAuth + rôle DB | Sous-ensemble filtré |

Principe clé : **resolve first** (`resolve_entity`) avant les reads ciblés. Outputs structurés via `ToolRunEnvelope` quand migré.

---

## Ce qui est fait (Phase 0)

### Infrastructure MCP

- [x] `scripts/mcpServer.ts` — entry stdio avec Signal Hub bootstrap
- [x] `src/mcp/server.ts` — registration des 25 tools, erreurs structurées, audit
- [x] `src/mcp/instructions.ts` — instructions orchestrateur (MCP `instructions`)
- [x] `src/mcp/toolMeta.ts` — `formatToolDescription()` (WHEN TO USE, LIMITATIONS, etc.)
- [x] `src/agent/toolCopy.ts` — descriptions structurées pour les 25 tools
- [x] `src/agent/toolRegistry.ts` — registry unique (HTTP agent + MCP)
- [x] `src/domain/mcpToolOutput.ts` — `ToolRunEnvelope`, `wrapToolOutput`, warning codes
- [x] `src/services/signalHub/bootstrap.ts` — wiring partagé HTTP + MCP

### Tools livrés (25)

**CRM / portfolio**

- `search_startups`, `read_startup_notes`, `read_startup_deals`, `read_startup_meetings`
- `list_portfolio_signals`, `build_board_prep_context`, `prepare_board_brief`
- `generate_portfolio_signal_digest`
- `resolve_entity`, `list_company_crm_activity`
- `list_company_documents`, `read_company_document_excerpt`
- `list_portfolio_context`, `build_company_360_context`
- `find_competitive_history` (Phase 0)
- `resolve_company_drive_folder` (Phase 1 P0 #1)
- `generate_portfolio_signal_digest` (Phase 1 P0 #3)

**Signal Hub (LinkedIn via Unipile)**

- `signal_hub_list_watched`, `signal_hub_add_watched`, `signal_hub_set_priority`
- `signal_hub_recent_signals`, `signal_hub_search_signals`, `signal_hub_resolve_entity`
- `signal_hub_list_accounts`, `signal_hub_request_refresh`
- `signal_hub_freeze_account` (approval-required, bloqué sur MCP)

### Enveloppes ToolRunEnvelope

Seuls ces tools retournent déjà l'enveloppe complète :

- `build_board_prep_context`
- `find_competitive_history`
- `resolve_company_drive_folder`
- `prepare_board_brief`
- `generate_portfolio_signal_digest`

Les 20 autres renvoient encore des payloads bruts (migration progressive).

### Tests (203 passing)

| Fichier | Couverture |
|---------|------------|
| `tests/mcp/server.test.ts` | Contrat MCP, auth, enveloppes, validation |
| `tests/agent/toolRegistry.test.ts` | Sync enum/registry/copy, strict Zod |
| `tests/services/boardBrief.test.ts` | Brief actionnable, checklist, warnings |
| `tests/services/portfolioSignalDigest.test.ts` | Digest multi-sources, warnings, suggestions |
| `tests/domain/mcpToolOutput.test.ts` | `wrapToolOutput` |
| `tests/agent/toolBenchmark.test.ts` | Corpus 62 questions + mapping registry |

Commandes :

```bash
npm test
npm run typecheck
npm run mcp:stdio
```

### Fixes récents (2026-05-24)

- [x] **Consolidation board prep** — `boardBrief.ts` source unique ; HTTP `/internal/briefs/board-prep` et `build_board_prep_context` (deprecated) projettent depuis le même orchestrateur ; suppression de `briefs.ts`
- [x] **`prepare_board_brief`** — service `boardBrief.ts`, brief actionnable (checklist, open questions, multi-sources), tests service + MCP
- [x] **`resolve_company_drive_folder`** — service `companyDriveFolder.ts`, extension connecteur Drive (folders + path), ToolRunEnvelope, tests service + MCP
- [x] **`generate_portfolio_signal_digest` hardening** — mapping LinkedIn, notes CRM, quiet companies, troncature par activité ; digest = Signal Hub + HubSpot (Monday = référentiel portco seulement)
- [x] `boardPrepEnvelope` — plus de faux `MONDAY_SIGNALS_EMPTY` quand des citations HubSpot/Drive existent sans signaux Monday
- [x] Test `startupId` inconnu + `sector` → fallback sector, pas de `REFERENCE_NOT_FOUND`
- [x] `docs/tool-benchmark/registry-mapping.json` — mapping aspirational → tools registry (85 noms)
- [x] Test benchmark : tout `candidateTool` du corpus a une entrée dans le mapping

---

## Leçons du test live (2026-05-24)

Batterie de tests sur Wenabi/KOMEET, hello RSE, Apollo, Ioga via le MCP stdio en conditions réelles (HubSpot + Drive prod, Monday vide, Signal Hub sans clés).

### Ce qui marche

- `resolve_entity` retourne les bons candidats HubSpot avec `needsClarification` propre
- `find_competitive_history` (3 peers climate vs Wenabi, extraits de notes)
- `resolve_company_drive_folder` (folder `KOMEET (ex WENABI)` retrouvé)
- `read_startup_*` et `list_company_crm_activity` (notes M1/M2, deals invested 150k€, 40+ meetings)
- Validations Zod (erreurs claires) et approval-required (`signal_hub_freeze_account` → 403)

### Frictions identifiées

| Friction | Impact | Cause |
|----------|--------|-------|
| `prepare_board_brief` / `build_board_prep_context` → 404 | Tools les plus utiles bloqués | Monday non peuplé, exigé comme prérequis |
| HubSpot 429 `secondly limit` sous charge | Échecs aléatoires en parallèle | Pas de cache, chaque tool tape l'API |
| 4 reads CRM enchaînés pour répondre « tout sur X » | Latence, coût tokens | Tools = wrappers endpoint, pas réponses métier |
| `read_company_document_excerpt` sur PDF → message binaire | L'agent perd un tour | Pas de filtrage en amont |
| `resolve_entity("KOMEET")` → 0 candidat | Linkage perdu à chaque session | Pas d'alias store persistant |
| `list_company_documents` retourne 5 PDFs juridiques | Bruit, l'agent doit deviner | Pas de ranking par pertinence |
| 40 meetings retournés dans `list_company_crm_activity` | Verbosité, tokens gaspillés | Pas de cap intelligent |

## Pivot conception (révision Phase 1)

Cinq règles qui prennent le pas sur la roadmap initiale :

1. **Pas de blocage sur dépendance secondaire** — Monday est une enrichissement, pas un prérequis. `prepare_board_brief` doit dégrader gracieusement sans Monday (CRM + Drive + Signal Hub suffisent).
2. **CoreStore-first** — toutes les lectures HubSpot/Monday/Drive passent par Postgres en priorité (sync workers déjà en place). API live seulement en fallback ou pour données fraîches identifiées.
3. **Un tool = une intention** — préférer un mini-livrable synthétique à 4 wrappers CRUD que l'orchestrateur recombine.
4. **Linkage persistant** — table `entity_aliases` qui apprend KOMEET=Wenabi et survit aux sessions.
5. **Drive pré-filtré et rangé** — par défaut on n'expose que les fichiers text-extractables, classés par pertinence métier (board pack > deck > BP > juridique).

## Ce qui reste à faire

### Phase 1 — Quick wins (cette semaine)

Ordonné par ratio impact/effort, à attaquer avant tout nouveau tool.

| # | Action | Pourquoi | Impact |
|---|--------|----------|--------|
| 1 | `prepare_board_brief` sans Monday | Débloque le tool principal pour 100% des portcos | Critique |
| 2 | Cache CoreStore + LRU 60s sur HubSpot reads | Élimine les 429 sous charge | Critique |
| 3 | `list_company_documents` : filtrer binaires par défaut, ranking pertinence | Drive utilisable en un seul appel | Élevé |
| 4 | Cap intelligent meetings/notes (top-N ranked, pas chronologique) | Économie tokens, plus de signal | Élevé |

### Phase 1bis — Nouveaux tools P0 (semaine suivante)

| Tool | Remplace | Apport |
|------|----------|--------|
| `summarize_company_activity` | `read_startup_notes` + `read_startup_deals` + `read_startup_meetings` + `list_company_crm_activity` | Brief CRM synthétique top 10-15 facts ranked ; 1 appel au lieu de 4 |
| `find_latest_deck` | (nouveau) | Retourne le deck le plus récent, déjà text-extracted, prêt à lire |
| `whats_new_for_me` | (nouveau) | Daily digest du caller : ses deals, meetings à venir, portcos qu'il owne. Crée l'usage quotidien |
| `prepare_m1_meeting_brief` | (déjà au plan) | Pré-M1, après quick wins |

### Phase 1ter — Linkage et alias store

| Action | Détail |
|--------|--------|
| Migration Postgres `entity_aliases` | `(canonical_id, alias_name, source, confidence, created_by, created_at)` |
| Populate initial | Cas connus : KOMEET=Wenabi, dérivés de fusions Vendredi, etc. |
| Intégration `resolve_entity` | Lookup alias + sources matchées + `confidence` 0-1 par candidat |
| Apprentissage | API `confirm_entity_match` (call humain via UI plus tard) pour persister |

### Tools à retirer ou fusionner (clean-up surface)

| Tool | Action | Raison |
|------|--------|--------|
| `build_board_prep_context` | Supprimer de la surface MCP | Doublon `prepare_board_brief` déjà consolidé en interne |
| `list_portfolio_signals` | Fusionner dans `list_portfolio_context` | Cas particulier du second |
| `build_company_360_context` | À repenser ou tuer | Aujourd'hui c'est un `prepare_board_brief` en moins bien |
| `read_startup_notes`, `read_startup_deals`, `read_startup_meetings`, `list_company_crm_activity` | Déprécier au profit de `summarize_company_activity` | 4 wrappers → 1 mini-livrable |

Cible : **25 → ~16 tools**, plus clairs, plus opinionated.

### Phase 2 (inchangée)

Voir [mcp-use-cases.md §10](./mcp-use-cases.md) : mutations contrôlées, MCP HTTP investisseur, observabilité.

### Dette technique connue

| Sujet | Priorité | Notes |
|-------|----------|-------|
| Duplication board prep (`briefs.ts` vs `boardBrief.ts`) | — | ✅ Consolidé 2026-05-24 |
| `nextSuggestedTools` vers tools non implémentés | Basse | ✅ Retiré (ex. `run_m2_financial_analysis`) |
| **HubSpot rate limit (429)** | **Critique** | **Quick win #2 ci-dessus** |
| **Board brief bloqué sans Monday** | **Critique** | **Quick win #1 ci-dessus** |
| **Linkage HubSpot ↔ Monday ↔ Drive par nom** | **Élevée** | **Phase 1ter : alias store** |
| Migrer les 19 tools restants vers `ToolRunEnvelope` | Moyenne | Spec §13 ; certains seront retirés (cf. clean-up) |
| Similarité `find_competitive_history` sector-only | Basse | Documenté ; pas sémantique |
| Mutations (write HubSpot, update Monday) | Phase 2+ | Approval-required |
| Connecteur Investors stub | Phase 3 | Surface investisseur incomplète |
| Tests intégration connecteurs réels | Basse | Tout mocké aujourd'hui |
| MCP HTTP remote (prod) | Phase 2 | stdio = dev local seulement |
| Validation Zod double couche (SDK vs handler) | Basse | Messages d'erreur non uniformes |

### Phase 2–4 (aperçu)

Voir [mcp-use-cases.md §10](./mcp-use-cases.md) :

- Phase 2 : mutations contrôlées, async runs, investor MCP HTTP
- Phase 3 : Dealfy, thesis scoring, committee prep
- Phase 4 : observabilité, benchmark automatisé, Tasks extension MCP

---

## Fichiers clés

```
src/agent/toolRegistry.ts       # Registry + handlers
src/agent/toolCopy.ts           # Descriptions LLM
src/mcp/server.ts               # MCP server builder
src/mcp/instructions.ts         # Server instructions
scripts/mcpServer.ts            # stdio entry
src/services/competitiveHistory.ts
src/services/companyDriveFolder.ts
src/services/boardBrief.ts
src/services/portfolioSignalDigest.ts
src/domain/mcpToolOutput.ts
docs/mcp-use-cases.md           # Spec normative
docs/tool-benchmark/
  questions.json                # 62 questions benchmark
  registry-mapping.json         # Mapping aspirational → registry
```

---

## Reprendre le travail

1. Lire cette note + [mcp-use-cases.md §3.5](./mcp-use-cases.md) (principes révisés)
2. `npm test && npm run typecheck` pour valider l'état
3. Quick wins en ordre : board brief sans Monday → cache HubSpot → Drive filtré/ranked → cap meetings
4. Puis `summarize_company_activity` et `find_latest_deck`
5. Mettre à jour cette note en fin de session

---

## Décisions d'architecture (ne pas casser)

- **Un registry, deux surfaces** — pas de duplication tool definitions
- **Domain entities = contrat** — mapper les APIs externes vers `src/domain/entities.ts`
- **Pas de keyword classifier** — LLM + prompt pour catégoriser
- **Approval-required** — refus MCP, exécution HTTP API seulement
- **Async externe** — `signal_hub_request_refresh` retourne `{ jobId }`, jamais d'appel sync Unipile depuis un tool
- **CoreStore-first** (post 2026-05-24) — lectures via Postgres ; API live en fallback uniquement
- **Mini-livrables > wrappers** (post 2026-05-24) — un tool répond à une intention métier, pas à un endpoint
- **Dégradation gracieuse** (post 2026-05-24) — une dépendance manquante donne un `warning`, pas un `404`
